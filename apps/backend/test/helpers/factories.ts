import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
// Side-effect import only: @fastify/jwt's own .d.ts declares
// `interface FastifyInstance { jwt: JWT }` via `declare module "fastify"`,
// but that augmentation is only registered in a file's compilation unit if
// something in the file actually imports the package. jwt.ts gets this for
// free because it imports `fjwt` directly; this file doesn't otherwise
// touch @fastify/jwt, so without this line `app.jwt` below type-errors as
// missing even though it exists at runtime.
import "@fastify/jwt";
import db, {
  users,
  pots,
  potMembers,
  contributions,
  contributionPayments,
  actionOtpCodes,
  type Pot,
  type User,
} from "../../src/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AccountsService } from "../../src/modules/ledger/accounts.service";
import { LedgerService } from "../../src/modules/ledger/ledger.service";
import { hashOtpCode } from "../../src/lib/otp";
import { hashActionContext } from "../../src/modules/pots/action-otp.service";

/**
 * Inserts a user row directly (bypassing AuthService.register/verifyEmail
 * entirely — see conversation notes on why: guarded routes only trust
 * request.user.sub, never re-fetch/validate the user). passwordHash is a
 * throwaway value; no test should ever log in through /auth with this
 * user, only via a directly-signed JWT (see signAccessToken below).
 */
export async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<User> {
  const unique = randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      email: `test-${unique}@example.com`,
      username: `testuser-${unique}`,
      passwordHash: "not-a-real-hash",
      fullName: "Test User",
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  return user;
}

/** Signs an access token for userId using the app's own JWT instance — same `{ sub: userId }` payload shape as AuthService.issueTokenPair, so `server.authenticate` accepts it identically. */
export function signAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId });
}

/** Convenience: creates a user + a valid bearer token in one call. */
export async function createAuthenticatedUser(
  app: FastifyInstance,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<{ user: User; accessToken: string; authHeader: string }> {
  const user = await createTestUser(overrides);
  const accessToken = signAccessToken(app, user.id);
  return { user, accessToken, authHeader: `Bearer ${accessToken}` };
}

/**
 * Inserts a pot + its creator-as-admin membership directly, skipping
 * PotsService.create (and therefore skipping insertPayoutConfig's Nomba
 * verifyAccountDetails calls) — use this for tests where the pot's
 * existence/state is a precondition, not the thing under test. Defaults to
 * a 'manual' pot with no fixed destination and 'draft' status, since
 * that's the cheapest valid combination (no payout config row required —
 * see insertPayoutConfig's manual case).
 */
export async function createTestPot(
  creatorId: string,
  overrides: Partial<typeof pots.$inferInsert> = {}
): Promise<Pot> {
  const unique = randomUUID();
  const [pot] = await db
    .insert(pots)
    .values({
      creatorId,
      title: "Test Pot",
      potType: "public",
      payoutMode: "manual",
      refundType: "admin",
      shareSlug: `test-slug-${unique}`,
      ...overrides,
    })
    .returning();

  await db.insert(potMembers).values({ potId: pot.id, userId: creatorId, role: "admin" });

  return pot;
}

/** Adds an existing user to an existing pot with the given role, without going through PotInvitesService. */
export async function addTestMember(potId: string, userId: string, role: "admin" | "member" = "member") {
  const [member] = await db.insert(potMembers).values({ potId, userId, role }).returning();
  return member;
}

/**
 * Directly credits a pot's ledger balance by `amountKobo`, bypassing the
 * entire contribution/funding flow — for tests where a funded pot is a
 * precondition (payout/refund/close tests), not the thing under test.
 * Posts a real balanced transaction (platform_float debit / pot credit)
 * via LedgerService, exactly mirroring confirmFunding's own entries, so
 * getBalance() reflects it identically to a real contribution.
 */
export async function seedPotBalance(potId: string, amountKobo: bigint): Promise<void> {
  const potAccount = await AccountsService.getOrCreatePotAccount(potId);
  const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
  await LedgerService.postTransaction({
    type: "funding",
    reference: `test_seed_${potId}_${randomUUID()}`,
    entries: [
      { accountId: platformFloat.id, direction: "debit", amount: amountKobo },
      { accountId: potAccount.id, direction: "credit", amount: amountKobo },
    ],
  });
}

/**
 * Inserts a 'funded' contribution row directly (bypassing
 * ContributionsService.create's Nomba virtual-account issuance) — for
 * tests of confirmFunding/reverseFunding/refund fan-out math where an
 * already-funded contribution is the precondition. Does NOT post any
 * ledger entries itself — callers that need the pot's balance to reflect
 * this contribution should also call seedPotBalance, since in production
 * confirmFunding is what posts the ledger transaction.
 */
export async function createFundedContribution(
  potId: string,
  overrides: Partial<typeof contributions.$inferInsert> = {}
): Promise<typeof contributions.$inferSelect> {
  const unique = randomUUID();
  const [contribution] = await db
    .insert(contributions)
    .values({
      potId,
      virtualAccountRef: `test_va_${unique}`,
      virtualAccountNumber: `900000${unique.slice(0, 4)}`,
      expectedAmount: 100000n,
      status: "funded",
      fundedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  return contribution;
}

/** Inserts a contribution_payments row for an existing contribution — the underlying inbound transfer(s) a funded contribution is built from, needed by postContributorsRefund's no-refund-account fallback path. */
export async function createContributionPayment(
  contributionId: string,
  overrides: Partial<typeof contributionPayments.$inferInsert> = {}
) {
  const unique = randomUUID();
  const [payment] = await db
    .insert(contributionPayments)
    .values({
      contributionId,
      nombaTransactionId: `test_nomba_tx_${unique}`,
      amount: 100000n,
      senderAccountNumber: "1000000001",
      senderBankCode: "000013",
      senderName: "Test Sender",
      ...overrides,
    })
    .returning();
  return payment;
}

/**
 * Overwrites the most recent unconsumed action-OTP row for
 * {userId, action, potId} so it validates against `code`, using the app's
 * own real hashOtpCode/hashActionContext — not a mock.
 *
 * WHY THIS EXISTS INSTEAD OF MOCKING generateOtpCode: action-otp.service.ts
 * imports generateOtpCode/sendMail as static ES module bindings, which are
 * linked once, the first time that module is evaluated — which happens
 * inside createTestApp()'s eager route-tree import, in `before()`, before
 * any per-test mock is ever installed. t.mock.module cannot retroactively
 * repoint a binding a module already linked; it only affects specifiers
 * resolved AFTER the mock call. So trying to mock the OTP code here would
 * silently do nothing, while the real generateOtpCode still runs and the
 * real sendMail still attempts a real network call.
 *
 * This sidesteps the problem entirely: call the real POST .../otp endpoint
 * first (ignore its response — ActionOtpService.request inserts the OTP
 * row into the DB BEFORE it attempts to send the email, so the row exists
 * regardless of whether that send succeeds or the response status), then
 * overwrite that row's hash here with a value YOU choose, computed via the
 * real hashing functions. No mocking, no ESM linking problem, no real
 * email ever needs to succeed.
 */
export async function forceActionOtpCode(
  userId: string,
  action: "trigger_payout" | "trigger_refund",
  potId: string,
  context: unknown,
  code: string
): Promise<void> {
  const [latest] = await db
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

  if (!latest) {
    throw new Error(
      "forceActionOtpCode: no unconsumed OTP row found for this user/action/pot — " +
        "did you call the real POST .../otp endpoint first?"
    );
  }

  await db
    .update(actionOtpCodes)
    .set({ codeHash: hashOtpCode(code), contextHash: hashActionContext(context) })
    .where(eq(actionOtpCodes.id, latest.id));
}