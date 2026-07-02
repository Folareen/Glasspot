import { and, eq } from "drizzle-orm";
import db, { pots, potMembers, type Pot } from "@glasspot/db";
import { PotError, PotNotFoundError } from "./pots.errors";

/**
 * Loads a pot and enforces private-pot visibility in one place: a
 * non-member requesting a private pot gets the same 404 as a pot that
 * doesn't exist at all, so existence of private pots is never leaked.
 * userId is the requester if authenticated, undefined if anonymous.
 */
export async function getViewablePotOrThrow(potId: string, userId: string | undefined): Promise<Pot> {
  const [pot] = await db.select().from(pots).where(eq(pots.id, potId)).limit(1);
  if (!pot) {
    throw new PotNotFoundError();
  }

  if (pot.potType === "private") {
    if (!userId || !(await isMember(potId, userId))) {
      throw new PotNotFoundError();
    }
  }

  return pot;
}

/** Same as getViewablePotOrThrow, but does not enforce visibility — for admin-gated actions that already assertIsAdmin right after. */
export async function getPotOrThrow(potId: string): Promise<Pot> {
  const [pot] = await db.select().from(pots).where(eq(pots.id, potId)).limit(1);
  if (!pot) {
    throw new PotNotFoundError();
  }
  return pot;
}

/** Returns whether userId belongs to potId, regardless of role. */
export async function isMember(potId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: potMembers.id })
    .from(potMembers)
    .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, userId)))
    .limit(1);
  return !!row;
}

/** Returns userId's role on potId ('admin' | 'member'), or null if they aren't a member. */
export async function getMemberRole(potId: string, userId: string): Promise<"admin" | "member" | null> {
  const [row] = await db
    .select({ role: potMembers.role })
    .from(potMembers)
    .where(and(eq(potMembers.potId, potId), eq(potMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/**
 * Throws unless userId holds the 'admin' role on this pot. This is the
 * only authority check in the system — there is no separate 'creator'
 * privilege (see pot-members.ts schema comment).
 */
export async function assertIsAdmin(potId: string, userId: string | undefined): Promise<void> {
  if (!userId) {
    throw new PotError("Authentication required", 401);
  }
  const role = await getMemberRole(potId, userId);
  if (role !== "admin") {
    throw new PotError("Only a pot admin can perform this action", 403);
  }
}

/** Returns the number of members holding the 'admin' role on potId. */
export async function countAdmins(potId: string): Promise<number> {
  const rows = await db
    .select({ id: potMembers.id })
    .from(potMembers)
    .where(and(eq(potMembers.potId, potId), eq(potMembers.role, "admin")));
  return rows.length;
}
