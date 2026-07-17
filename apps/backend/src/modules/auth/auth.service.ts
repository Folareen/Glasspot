import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import db, { otpCodes, users } from "@/db";
import { hashPassword, verifyPassword } from "@/lib/hash";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@/lib/otp";
import { hashToken, signRefreshToken, verifyRefreshTokenSignature } from "@/lib/tokens";
import { sendMail } from "@/lib/mailer";
import { otpEmail } from "@/lib/otp-email";
import { verifyAccountDetails } from "@/integrations/nomba/verify-account-details";
import { AuthError, RateLimitError } from "./auth.errors";
import { RegisterInput, ResetPasswordInput } from "./auth.schema";
import { PendingMembersService } from "@/modules/pots/pending-members.service";
import type { UpdateRefundProfileInput } from "@/modules/me/me.schema";

type OtpPurposeValue = "signup_verification" | "login" | "password_reset";

// A fixed, valid-shaped "salt:hash" string used only to keep login's scrypt cost identical whether
// or not the email is registered — never a real credential, never checked against anything.
// Without this, `login()` returning immediately on `!user` (skipping verifyPassword's scrypt call
// entirely) makes a nonexistent-email response measurably faster than a wrong-password response,
// letting an attacker enumerate registered emails by timing alone.
const DUMMY_PASSWORD_HASH = hashPassword("dummy-password-for-constant-time-login-checks");

// A function the controller hands in that wraps request.jwt.sign — keeps
// this service free of any Fastify request/reply coupling.
type SignFn = (payload: object) => string;

// ---- tunables ----
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;

/** Returns the expiry timestamp for a freshly issued OTP, OTP_TTL_MINUTES from now. */
function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

/** Throws a RateLimitError if this user+purpose has requested a code within the resend cooldown, or exceeded the hourly cap. */
async function assertOtpNotRateLimited(userId: string, purpose: OtpPurposeValue) {
  const [latest] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (latest) {
    const secondsSinceLast = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new RateLimitError(
        "Please wait before requesting another code",
        Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)
      );
    }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCodes = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.purpose, purpose),
        gte(otpCodes.createdAt, oneHourAgo)
      )
    );

  if (recentCodes.length >= OTP_MAX_PER_HOUR) {
    throw new RateLimitError("Too many codes requested. Try again later.", 60 * 60);
  }
}

/** Human-readable purpose text for the OTP email body. */
function otpPurposeLabel(purpose: OtpPurposeValue): string {
  switch (purpose) {
    case "signup_verification":
      return "verify your email";
    case "login":
      return "log in";
    case "password_reset":
      return "reset your password";
  }
}

/** Generates a code, stores its hash, emails the raw code to the user, and returns it — only the hash is ever persisted. */
async function createOtp(userId: string, email: string, purpose: OtpPurposeValue) {
  await assertOtpNotRateLimited(userId, purpose);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);

  await db.insert(otpCodes).values({
    userId,
    purpose,
    codeHash,
    expiresAt: otpExpiry(),
  });

  const { subject, text, html } = otpEmail({
    code,
    intro: `Use this code to ${otpPurposeLabel(purpose)}.`,
    ttlMinutes: OTP_TTL_MINUTES,
  });
  await sendMail({ to: email, subject, text, html });

  return code;
}

/** Validates `code` against the newest unconsumed OTP for this user+purpose, marking it consumed on success or bumping its attempt count and throwing on failure. */
async function verifyOtp(userId: string, purpose: OtpPurposeValue, code: string) {
  const [otp] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.purpose, purpose),
        isNull(otpCodes.consumedAt)
      )
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!otp) {
    throw new AuthError("No active code found. Request a new one.", 400);
  }

  if (otp.expiresAt.getTime() < Date.now()) {
    throw new AuthError("Code has expired. Request a new one.", 400);
  }

  if (otp.attemptCount >= otp.maxAttempts) {
    throw new AuthError("Too many incorrect attempts. Request a new code.", 429);
  }

  const isValid = verifyOtpCode(code, otp.codeHash);

  if (!isValid) {
    await db
      .update(otpCodes)
      .set({ attemptCount: otp.attemptCount + 1 })
      .where(eq(otpCodes.id, otp.id));
    throw new AuthError("Incorrect code", 400);
  }

  await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));
}

/** Projects a full user row down to the safe subset of fields returned in API responses, stripping passwordHash/refreshTokenHash and other internal columns. */
function toPublicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
  };
}

/** Issues a fresh access+refresh token pair for userId, persisting hash(jti) as the new refreshTokenHash so any previously issued refresh token is invalidated. tokenVersion is embedded in the access token so a later revocation (logout/reset/reuse) can invalidate it before its 15-minute expiry — see users.ts's tokenVersion comment. */
async function issueTokenPair(userId: string, tokenVersion: number, sign: SignFn) {
  const { token: refreshToken, jti, expiresAt } = signRefreshToken(userId);

  await db
    .update(users)
    .set({
      refreshTokenHash: hashToken(jti),
      refreshTokenExpiresAt: expiresAt,
    })
    .where(eq(users.id, userId));

  const accessToken = sign({ sub: userId, tokenVersion });

  return { accessToken, refreshToken };
}

export const AuthService = {
  /** Creates a new user (rejecting a duplicate email or username), sends a signup-verification OTP, and returns the new userId + email. */
  async register(input: RegisterInput) {
    const existing = await db.query.users.findFirst({
      where: (u, { or, eq: eqOp }) => or(eqOp(u.email, input.email), eqOp(u.username, input.username)),
    });
    if (existing) {
      throw new AuthError("Email or username already in use", 409);
    }

    const passwordHash = hashPassword(input.password);

    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        username: input.username,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone,
      })
      .returning();

    await createOtp(user.id, user.email, "signup_verification");

    return { userId: user.id, email: user.email };
  },

  /** Issues a new OTP for the given email + purpose; resolves silently (no error) if the email doesn't match a user, or (for signup_verification) if it's already verified — same generic outcome either way so callers can't use this to enumerate accounts or distinguish a verified account from an unknown one. */
  async resendOtp(email: string, purpose: OtpPurposeValue) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      // Don't reveal whether the email exists — caller always gets a
      // generic "if the account exists" success response.
      return;
    }
    if (purpose === "signup_verification" && user.emailVerifiedAt) {
      // Same silent no-op as the unknown-email case above — a distinct error here would let a
      // caller distinguish "exists and already verified" from "doesn't exist."
      return;
    }
    await createOtp(user.id, user.email, purpose);
  },

  /** Confirms the signup-verification code, marks the email verified, issues a token pair (verification doubles as login), and activates any pending pot invites addressed to this email. */
  async verifyEmail(email: string, code: string, sign: SignFn) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user || user.emailVerifiedAt) {
      // Same generic message for "no such account" and "already verified" — a distinct message
      // for the latter would let a caller enumerate which emails are registered and verified.
      throw new AuthError("Invalid email or code", 400);
    }

    await verifyOtp(user.id, "signup_verification", code);

    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    await PendingMembersService.activateForEmail(user.id, user.email);

    const tokens = await issueTokenPair(user.id, user.tokenVersion, sign);
    return { ...tokens, user: toPublicUser(user) };
  },

  /** Verifies email/password and, on success, sends a login OTP — does not itself issue tokens; that only happens after verifyLoginOtp. */
  async login(email: string, password: string) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    // Always run the scrypt comparison, even for a nonexistent email — comparing against
    // DUMMY_PASSWORD_HASH when there's no real user keeps this call's cost identical to the
    // real-user path, so response timing can't be used to enumerate which emails are registered.
    const isValid = verifyPassword({ candidatePassword: password, hash: user?.passwordHash ?? DUMMY_PASSWORD_HASH });
    if (!user || !isValid) {
      throw new AuthError("Invalid email or password", 401);
    }

    if (!user.emailVerifiedAt) {
      throw new AuthError("Please verify your email before logging in", 403);
    }

    await createOtp(user.id, user.email, "login");

    return { userId: user.id };
  },

  /** Confirms the login OTP for this email and, on success, issues a fresh token pair, completing the two-step login flow. */
  async verifyLoginOtp(email: string, code: string, sign: SignFn) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      throw new AuthError("Invalid email or code", 400);
    }

    await verifyOtp(user.id, "login", code);

    const tokens = await issueTokenPair(user.id, user.tokenVersion, sign);
    return { ...tokens, user: toPublicUser(user) };
  },

  /** Exchanges a valid, still-current refresh token for a new token pair; revokes the session outright if the presented token doesn't match the one on file (reuse of an already-rotated token). */
  async refresh(presentedToken: string, sign: SignFn) {
    let payload;
    try {
      payload = verifyRefreshTokenSignature(presentedToken);
    } catch {
      throw new AuthError("Invalid or expired refresh token", 401);
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new AuthError("Session no longer valid", 401);
    }

    if (user.refreshTokenExpiresAt.getTime() < Date.now()) {
      throw new AuthError("Session expired, please log in again", 401);
    }

    const presentedHash = hashToken(payload.jti);

    if (presentedHash !== user.refreshTokenHash) {
      // Reuse detected: someone presented a refresh token that doesn't
      // match what's currently on file for this user (e.g. an old,
      // already-rotated-away token). Kill the session immediately rather
      // than silently rejecting — this is the signal a token was stolen.
      // tokenVersion bump also invalidates any access token already issued (see users.ts).
      await db
        .update(users)
        .set({ refreshTokenHash: null, refreshTokenExpiresAt: null, tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, user.id));
      throw new AuthError("Refresh token reuse detected, session revoked", 401);
    }

    return issueTokenPair(user.id, user.tokenVersion, sign);
  },

  /** Clears the stored refresh token hash and bumps tokenVersion, immediately invalidating both the current session's refresh token and any access token already issued (see users.ts's tokenVersion comment). */
  async logout(userId: string) {
    await db
      .update(users)
      .set({ refreshTokenHash: null, refreshTokenExpiresAt: null, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId));
  },

  /** Sets userId's default refund destination for a refundType='admin' pot, confirming the account via verifyAccountDetails() first. */
  async updateRefundProfile(userId: string, input: UpdateRefundProfileInput) {
    await verifyAccountDetails(input.accountNumber, input.bankCode);

    const [user] = await db
      .update(users)
      .set({ defaultRefundAccount: input.accountNumber, defaultRefundBank: input.bankCode, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    return { defaultRefundAccount: user.defaultRefundAccount, defaultRefundBank: user.defaultRefundBank };
  },

  /** Returns userId's own profile, including defaultRefundAccount/defaultRefundBank (previously write-only via updateRefundProfile). Throws AuthError(404) if the user no longer exists (e.g. deleted between JWT issue and this call). */
  async getProfile(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new AuthError("User not found", 404);
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      phone: user.phone,
      defaultRefundAccount: user.defaultRefundAccount,
      defaultRefundBank: user.defaultRefundBank,
    };
  },

  /** Issues a password_reset OTP for the given email; resolves silently (no error) if the email doesn't match a user, so callers can't use this to enumerate accounts — same shape as resendOtp. */
  async forgotPassword(email: string) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      return;
    }
    await createOtp(user.id, user.email, "password_reset");
  },

  /** Confirms the password_reset code, sets the new password hash, and revokes any existing session (clears refreshTokenHash, bumps tokenVersion) so every device — including one holding a still-live access token — is forced to log in again with the new password. */
  async resetPassword(input: ResetPasswordInput) {
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user) {
      throw new AuthError("Invalid email or code", 400);
    }

    await verifyOtp(user.id, "password_reset", input.code);

    const passwordHash = hashPassword(input.newPassword);

    await db
      .update(users)
      .set({
        passwordHash,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  },
};