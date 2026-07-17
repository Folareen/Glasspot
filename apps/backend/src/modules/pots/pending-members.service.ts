import { and, eq } from "drizzle-orm";
import db, { potPendingMembers, potMembers, pots, users } from "@/db";
import { PotError } from "./pots.errors";
import { assertMembershipIsOpen, getMemberRole } from "./pot-authorization";
import { AddMemberInput } from "./pots.schema";
import { sendMail } from "@/lib/mailer";
import { addedToPotEmail } from "@/lib/added-to-pot-email";

/** Normalizes an email the same way for lookup/storage — users.email has no DB-level case-folding (see users.ts). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PendingMembersService = {
  /**
   * Adds a member by email (admin-only) — not an invite the recipient can accept or decline,
   * they're already added. If the email already belongs to a verified user, they're inserted
   * into pot_members immediately and this returns that member row (and emails them the pot
   * link). Otherwise a pot_pending_members row is created and emailed the same way; it resolves
   * into real membership automatically via AuthService.verifyEmail (activateForEmail below) once
   * that person signs up and verifies this exact email — no further action from them needed.
   */
  async create(potId: string, addedByUserId: string, input: AddMemberInput) {
    const email = normalizeEmail(input.email);
    const role = input.role ?? "member";

    const [pot] = await db.select().from(pots).where(eq(pots.id, potId)).limit(1);
    if (!pot) {
      throw new PotError("Pot not found", 404);
    }
    assertMembershipIsOpen(pot);

    const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });

    if (existingUser && existingUser.emailVerifiedAt) {
      const alreadyMember = await getMemberRole(potId, existingUser.id);
      if (alreadyMember) {
        throw new PotError("User is already a member of this pot", 409);
      }

      const [member] = await db
        .insert(potMembers)
        .values({ potId, userId: existingUser.id, role, addedByUserId })
        .returning();

      await sendMail({ to: email, ...addedToPotEmail({ potTitle: pot.title, potId }) });

      return {
        kind: "member" as const,
        member: {
          ...member,
          fullName: existingUser.fullName,
          username: existingUser.username,
          email: existingUser.email,
        },
      };
    }

    const existingPending = await db.query.potPendingMembers.findFirst({
      where: (p, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(p.potId, potId), eqOp(p.email, email), eqOp(p.status, "pending")),
    });
    if (existingPending) {
      throw new PotError("This email is already pending for this pot", 409);
    }

    const [pending] = await db
      .insert(potPendingMembers)
      .values({ potId, email, role, addedByUserId })
      .returning();

    await sendMail({ to: email, ...addedToPotEmail({ potTitle: pot.title, potId }) });

    return { kind: "pending" as const, pending };
  },

  /** Lists every pending-member row (any status) for potId — admin-only, callers check authorization first. */
  async list(potId: string) {
    return db.select().from(potPendingMembers).where(eq(potPendingMembers.potId, potId));
  },

  /** Removes a still-pending row (admin-only) — a no-op guard against removing one already joined/removed. */
  async remove(potId: string, pendingId: string) {
    const [pot] = await db.select().from(pots).where(eq(pots.id, potId)).limit(1);
    if (!pot) {
      throw new PotError("Pot not found", 404);
    }
    assertMembershipIsOpen(pot);

    const pending = await db.query.potPendingMembers.findFirst({
      where: and(eq(potPendingMembers.id, pendingId), eq(potPendingMembers.potId, potId)),
    });
    if (!pending) {
      throw new PotError("Pending member not found", 404);
    }
    if (pending.status !== "pending") {
      throw new PotError("Only a pending row can be removed", 409);
    }

    await db.update(potPendingMembers).set({ status: "removed" }).where(eq(potPendingMembers.id, pendingId));
  },

  /**
   * Called from AuthService.verifyEmail right after emailVerifiedAt is
   * set — turns every still-pending row addressed to this email into a
   * real pot_members row, marking each row 'joined'. Runs after
   * verification (not at registration) so a pending row is never linked to
   * an unconfirmed email — see auth.service.ts's verifyEmail comment.
   */
  async activateForEmail(userId: string, email: string) {
    const normalized = normalizeEmail(email);
    const pending = await db.query.potPendingMembers.findMany({
      where: (p, { and: andOp, eq: eqOp }) => andOp(eqOp(p.email, normalized), eqOp(p.status, "pending")),
    });

    for (const row of pending) {
      const alreadyMember = await getMemberRole(row.potId, userId);
      if (!alreadyMember) {
        await db.insert(potMembers).values({
          potId: row.potId,
          userId,
          role: row.role,
          addedByUserId: row.addedByUserId,
        });
      }

      await db
        .update(potPendingMembers)
        .set({ status: "joined", joinedUserId: userId, joinedAt: new Date() })
        .where(eq(potPendingMembers.id, row.id));
    }
  },
};
