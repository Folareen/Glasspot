import { and, eq } from "drizzle-orm";
import db, { potMembers, users } from "@glasspot/db";
import { PotError } from "./pots.errors";
import { countAdmins, getMemberRole } from "./pot-authorization";
import { AddMemberInput, UpdateMemberRoleInput } from "./pots.schema";

export const PotMembersService = {
  /** Returns every member row for potId; callers are responsible for checking pot visibility first (see getViewablePotOrThrow). */
  async list(potId: string) {
    return db.select().from(potMembers).where(eq(potMembers.potId, potId));
  },

  /** Admin-invite only — see product decision: no self-join via share link in this MVP. */
  async add(potId: string, invitedByUserId: string, input: AddMemberInput) {
    const existing = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
    if (!existing) {
      throw new PotError("User not found", 404);
    }

    const alreadyMember = await getMemberRole(potId, input.userId);
    if (alreadyMember) {
      throw new PotError("User is already a member of this pot", 409);
    }

    const [member] = await db
      .insert(potMembers)
      .values({
        potId,
        userId: input.userId,
        role: input.role,
        invitedByUserId,
      })
      .returning();

    return member;
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
