import { and, eq } from "drizzle-orm";
import db, { potMembers, users } from "@/db";
import { PotError } from "./pots.errors";
import { countAdmins, getMemberRole } from "./pot-authorization";
import { UpdateMemberRoleInput } from "./pots.schema";

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
   */
  async leave(potId: string, userId: string) {
    return this.remove(potId, userId);
  },

  /** Blocks demoting the last admin — a pot must always keep at least one. */
  async updateRole(potId: string, targetUserId: string, input: UpdateMemberRoleInput) {
    const currentRole = await getMemberRole(potId, targetUserId);
    if (!currentRole) {
      throw new PotError("User is not a member of this pot", 404);
    }

    if (currentRole === "admin" && input.role === "member") {
      const adminCount = await countAdmins(potId);
      if (adminCount <= 1) {
        throw new PotError("Cannot demote the last admin — assign another admin first", 409);
      }
    }

    const [updated] = await db
      .update(potMembers)
      .set({ role: input.role })
      .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, targetUserId)))
      .returning();

    return updated;
  },

  /** Blocks removing the last admin — a pot must always keep at least one. */
  async remove(potId: string, targetUserId: string) {
    const currentRole = await getMemberRole(potId, targetUserId);
    if (!currentRole) {
      throw new PotError("User is not a member of this pot", 404);
    }

    if (currentRole === "admin") {
      const adminCount = await countAdmins(potId);
      if (adminCount <= 1) {
        throw new PotError("Cannot remove the last admin — assign another admin first", 409);
      }
    }

    await db
      .delete(potMembers)
      .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, targetUserId)));
  },
};
