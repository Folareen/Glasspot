import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import db, { actionOtpCodes, users } from "@/db";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@/lib/otp";
import { sendMail } from "@/lib/mailer";
import { otpEmail } from "@/lib/otp-email";
import { PotError } from "./pots.errors";

type ActionOtpAction = "trigger_payout" | "trigger_refund";

// ---- tunables (mirrors auth.service.ts's OTP tunables) ----
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

/** Deterministically stringifies context with object keys sorted, so the same logical context hashes the same way regardless of the parsed body's key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hashes the action + the exact request context (destination/amount, if any) it was requested for, so a code can't be replayed against a retry with different parameters. */
export function hashActionContext(context: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(context ?? null)).digest("hex");
}

function actionLabel(action: ActionOtpAction): string {
  switch (action) {
    case "trigger_payout":
      return "trigger this payout";
    case "trigger_refund":
      return "trigger this refund";
  }
}

export const ActionOtpService = {
  /** Generates a code bound to {userId, action, potId, contextHash}, emails it to the admin, and rate-limits per user+action+pot to stop code-spamming. */
  async request(userId: string, action: ActionOtpAction, potId: string, context: unknown): Promise<void> {
    const [admin] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!admin) {
      throw new PotError("User not found", 404);
    }

    const [latest] = await db
      .select()
      .from(actionOtpCodes)
      .where(
        and(eq(actionOtpCodes.userId, userId), eq(actionOtpCodes.action, action), eq(actionOtpCodes.potId, potId))
      )
      .orderBy(desc(actionOtpCodes.createdAt))
      .limit(1);

    if (latest) {
      const secondsSinceLast = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        throw new PotError(
          `Please wait before requesting another code`,
          429
        );
      }
    }

    const code = generateOtpCode();
    const codeHash = hashOtpCode(code);
    const contextHash = hashActionContext(context);

    await db.insert(actionOtpCodes).values({
      userId,
      action,
      potId,
      contextHash,
      codeHash,
      expiresAt: otpExpiry(),
    });

    const { subject, text, html } = otpEmail({
      code,
      intro: `Use this code to ${actionLabel(action)}.`,
      ttlMinutes: OTP_TTL_MINUTES,
    });
    await sendMail({ to: admin.email, subject, text, html });
  },

  /**
   * Validates `code` against the newest unconsumed action-OTP for {userId, action, potId}, also
   * requiring context to hash to the contextHash it was issued for; marks it consumed (recording
   * `idempotencyKey`) on success, else bumps attempt count and throws.
   *
   * If there's no unconsumed code but the most recently consumed one for {userId, action, potId}
   * was consumed by this exact `idempotencyKey`, this is a retry of a request that already passed
   * verification (e.g. the enqueue step after this call threw a transient error and the caller's
   * withIdempotencyKey wrapper is re-running fn() from scratch) — return normally instead of
   * demanding a code the client already used and can't get back.
   */
  async verify(
    userId: string,
    action: ActionOtpAction,
    potId: string,
    context: unknown,
    code: string,
    idempotencyKey?: string
  ): Promise<void> {
    const [otp] = await db
      .select()
      .from(actionOtpCodes)
      .where(
        and(
          eq(actionOtpCodes.userId, userId),
          eq(actionOtpCodes.action, action),
          eq(actionOtpCodes.potId, potId),
          isNull(actionOtpCodes.consumedAt)
        )
      )
      .orderBy(desc(actionOtpCodes.createdAt))
      .limit(1);

    if (!otp) {
      if (idempotencyKey) {
        const [lastConsumed] = await db
          .select()
          .from(actionOtpCodes)
          .where(
            and(eq(actionOtpCodes.userId, userId), eq(actionOtpCodes.action, action), eq(actionOtpCodes.potId, potId))
          )
          .orderBy(desc(actionOtpCodes.createdAt))
          .limit(1);
        if (lastConsumed?.consumedByIdempotencyKey === idempotencyKey) {
          return;
        }
      }
      throw new PotError("No active confirmation code found. Request a new one.", 400);
    }

    if (otp.expiresAt.getTime() < Date.now()) {
      throw new PotError("Confirmation code has expired. Request a new one.", 400);
    }

    if (otp.attemptCount >= otp.maxAttempts) {
      throw new PotError("Too many incorrect attempts. Request a new code.", 429);
    }

    const contextHash = hashActionContext(context);
    const isValid = contextHash === otp.contextHash && verifyOtpCode(code, otp.codeHash);

    if (!isValid) {
      await db
        .update(actionOtpCodes)
        .set({ attemptCount: otp.attemptCount + 1 })
        .where(eq(actionOtpCodes.id, otp.id));
      throw new PotError("Incorrect confirmation code", 400);
    }

    await db
      .update(actionOtpCodes)
      .set({ consumedAt: new Date(), consumedByIdempotencyKey: idempotencyKey })
      .where(eq(actionOtpCodes.id, otp.id));
  },
};
