import { and, eq } from "drizzle-orm";
import db, { potMembers, users } from "@/db";
import { PotError } from "./pots.errors";
import { assertMembershipIsOpen, countAdmins, getMemberRole, getPotOrThrow } from "./pot-authorization";
import { UpdateMemberRoleInput } from "./pots.schema";
import { sendMail } from "@/lib/mailer";
import { removedFromPotEmail } from "@/lib/removed-from-pot-email";

export const PotMembersService = {
  /** Returns every member row for potId, joined with the member's public profile (fullName/username/email) so the frontend can render a member list without a separate lookup; callers are responsible for checking pot visibility first (see getViewablePotOrThrow). */
  async list(potId: string) {
    return db
      .select({
        id: potMembers.id,
        potId: potMembers.potId,
        userId: potMembers.userId,
        role: potMembers.role,
        addedByUserId: potMembers.addedByUserId,
        joinedAt: potMembers.joinedAt,
        fullName: users.fullName,
        username: users.username,
        email: users.email,
      })
      .from(potMembers)
      .innerJoin(users, eq(users.id, potMembers.userId))
      .where(eq(potMembers.potId, potId));
  },

  // Adding a member is now PendingMembersService.create (email-addressed,
  // see pots.schema.ts's addMemberSchema comment) — this service only
  // manages rows that already exist in pot_members.

  /**
   * A member leaving of their own accord — same last-admin protection as remove() below (an
   * admin can't leave if they're the only one; they must promote someone else first), but no
   * assertIsAdmin check at the controller level since this is self-service, not admin-managed.
   * notify: false — they already know they left, no need to email them about it.
   */
  async leave(potId: string, userId: string) {
    return this.remove(potId, userId, { notify: false });
  },

  /** Blocks demoting the last admin — a pot must always keep at least one. */
  async updateRole(potId: string, targetUserId: string, input: UpdateMemberRoleInput) {
    assertMembershipIsOpen(await getPotOrThrow(potId));

    const currentRole = await getMemberRole(potId, targetUserId);
    if (!currentRole) {
      throw new PotError("User is not a member of this pot", 404);
    }

    if (currentRole === "admin" && input.role === "member") {
      const adminCount = await countAdmins(potId);
      if (adminCount <= 1) {
        throw new PotError("Cannot demote the last admin. Assign another admin first", 409);
      }
    }

    await db
      .update(potMembers)
      .set({ role: input.role })
      .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, targetUserId)));

    // Re-fetch joined with users (fullName/username/email) — memberResponseSchema requires them,
    // same shape as list() above, but a plain .update().returning() only has potMembers' own
    // columns and would fail response serialization (see this method's own regression: the route
    // 500'd here because of exactly that missing join).
    const [updated] = await db
      .select({
        id: potMembers.id,
        potId: potMembers.potId,
        userId: potMembers.userId,
        role: potMembers.role,
        addedByUserId: potMembers.addedByUserId,
        joinedAt: potMembers.joinedAt,
        fullName: users.fullName,
        username: users.username,
        email: users.email,
      })
      .from(potMembers)
      .innerJoin(users, eq(users.id, potMembers.userId))
      .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, targetUserId)));

    return updated;
  },

  /** Blocks removing the last admin — a pot must always keep at least one. notify (default true) emails the removed member; leave() above turns this off since they already know. */
  async remove(potId: string, targetUserId: string, options: { notify?: boolean } = {}) {
    const pot = await getPotOrThrow(potId);
    assertMembershipIsOpen(pot);

    const currentRole = await getMemberRole(potId, targetUserId);
    if (!currentRole) {
      throw new PotError("User is not a member of this pot", 404);
    }

    if (currentRole === "admin") {
      const adminCount = await countAdmins(potId);
      if (adminCount <= 1) {
        throw new PotError("Cannot remove the last admin. Assign another admin first", 409);
      }
    }

    const [removedUser] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    await db
      .delete(potMembers)
      .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, targetUserId)));

    if (options.notify !== false && removedUser) {
      await sendMail({ to: removedUser.email, ...removedFromPotEmail({ potTitle: pot.title }) });
    }
  },
};
