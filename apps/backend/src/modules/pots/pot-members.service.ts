import { and, eq } from "drizzle-orm";
import db, { potMembers } from "@/db";
import { PotError } from "./pots.errors";
import { countAdmins, getMemberRole } from "./pot-authorization";
import { UpdateMemberRoleInput } from "./pots.schema";

export const PotMembersService = {
  /** Returns every member row for potId; callers are responsible for checking pot visibility first (see getViewablePotOrThrow). */
  async list(potId: string) {
    return db.select().from(potMembers).where(eq(potMembers.potId, potId));
  },

  // Adding a member is now PotInvitesService.create (email-addressed, see
  // pots.schema.ts's addMemberSchema comment) — this service only manages
  // rows that already exist in pot_members.

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
