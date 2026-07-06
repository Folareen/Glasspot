import { and, eq } from "drizzle-orm";
import db, { potInvites, potMembers, users } from "@/db";
import { PotError } from "./pots.errors";
import { getMemberRole } from "./pot-authorization";
import { AddMemberInput } from "./pots.schema";

/** Normalizes an email the same way for lookup/storage — users.email has no DB-level case-folding (see users.ts). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PotInvitesService = {
  /**
   * Adds a member by email (admin-invite only). If the email already
   * belongs to a verified user, they're inserted into pot_members
   * immediately and this returns that member row. Otherwise a pending
   * pot_invites row is created, later resolved into real membership by
   * AuthService.verifyEmail (activateForEmail below) once that person
   * signs up and verifies this exact email.
   */
  async create(potId: string, invitedByUserId: string, input: AddMemberInput) {
    const email = normalizeEmail(input.email);
    const role = input.role ?? "member";

    const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });

    if (existingUser && existingUser.emailVerifiedAt) {
      const alreadyMember = await getMemberRole(potId, existingUser.id);
      if (alreadyMember) {
        throw new PotError("User is already a member of this pot", 409);
      }

      const [member] = await db
        .insert(potMembers)
        .values({ potId, userId: existingUser.id, role, invitedByUserId })
        .returning();

      return { kind: "member" as const, member };
    }

    const existingPending = await db.query.potInvites.findFirst({
      where: (i, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(i.potId, potId), eqOp(i.email, email), eqOp(i.status, "pending")),
    });
    if (existingPending) {
      throw new PotError("This email already has a pending invite to this pot", 409);
    }

    const [invite] = await db
      .insert(potInvites)
      .values({ potId, email, role, invitedByUserId })
      .returning();

    return { kind: "invite" as const, invite };
  },

  /** Lists every invite (any status) for potId — admin-only, callers check authorization first. */
  async list(potId: string) {
    return db.select().from(potInvites).where(eq(potInvites.potId, potId));
  },

  /** Cancels a still-pending invite (admin-only) — a no-op guard against cancelling one already accepted/cancelled. */
  async cancel(potId: string, inviteId: string) {
    const invite = await db.query.potInvites.findFirst({
      where: and(eq(potInvites.id, inviteId), eq(potInvites.potId, potId)),
    });
    if (!invite) {
      throw new PotError("Invite not found", 404);
    }
    if (invite.status !== "pending") {
      throw new PotError("Only a pending invite can be cancelled", 409);
    }

    await db.update(potInvites).set({ status: "cancelled" }).where(eq(potInvites.id, inviteId));
  },

  /**
   * Called from AuthService.verifyEmail right after emailVerifiedAt is
   * set — turns every still-pending invite addressed to this email into a
   * real pot_members row, marking each invite 'accepted'. Runs after
   * verification (not at registration) so an invite is never linked to an
   * unconfirmed email — see auth.service.ts's verifyEmail comment.
   */
  async activateForEmail(userId: string, email: string) {
    const normalized = normalizeEmail(email);
    const pending = await db.query.potInvites.findMany({
      where: (i, { and: andOp, eq: eqOp }) => andOp(eqOp(i.email, normalized), eqOp(i.status, "pending")),
    });

    for (const invite of pending) {
      const alreadyMember = await getMemberRole(invite.potId, userId);
      if (!alreadyMember) {
        await db.insert(potMembers).values({
          potId: invite.potId,
          userId,
          role: invite.role,
          invitedByUserId: invite.invitedByUserId,
        });
      }

      await db
        .update(potInvites)
        .set({ status: "accepted", acceptedUserId: userId, acceptedAt: new Date() })
        .where(eq(potInvites.id, invite.id));
    }
  },
};
