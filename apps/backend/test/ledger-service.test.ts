import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resetDb, closeDb } from "./helpers/db";
// import { resetDb, closeDb } from "../helpers/db";
import db, { transactions } from "../src/db";
import { AccountsService } from "../src/modules/ledger/accounts.service";
import { LedgerService } from "../src/modules/ledger/ledger.service";
import { LedgerError, UnbalancedTransactionError } from "../src/modules/ledger/ledger.errors";
import { createTestUser, createTestPot } from "./helpers/factories";

test("LedgerService", async (t) => {
  t.after(async () => {
    await closeDb();
  });

  t.beforeEach(async () => {
    await resetDb();
  });

  await t.test("postTransaction posts balanced debit/credit entries and updates both balances", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    const reference = `test_${randomUUID()}`;
    const transaction = await LedgerService.postTransaction({
      type: "funding",
      reference,
      amount: 100_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amount: 100_000n },
        { accountId: potAccount.id, direction: "credit", amount: 100_000n },
      ],
    });

    assert.equal(transaction.status, "completed");
    assert.equal(transaction.reference, reference);

    // pot is credit-normal: a credit entry increases its balance.
    assert.equal(await LedgerService.getBalance(potAccount.id), 100_000n);
    // platform_float is debit-normal: a debit entry increases its balance too.
    assert.equal(await LedgerService.getBalance(platformFloat.id), 100_000n);
  });

  await t.test("rejects an unbalanced set of entries and posts nothing", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    await assert.rejects(
      () =>
        LedgerService.postTransaction({
          type: "funding",
          reference: `test_${randomUUID()}`,
          amount: 100_000n,
          entries: [
            { accountId: platformFloat.id, direction: "debit", amount: 100_000n },
            { accountId: potAccount.id, direction: "credit", amount: 99_000n }, // mismatched
          ],
        }),
      UnbalancedTransactionError
    );

    assert.equal(await LedgerService.getBalance(potAccount.id), 0n);
    assert.equal(await LedgerService.getBalance(platformFloat.id), 0n);
  });

  await t.test("rejects a zero or negative entry amount", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    await assert.rejects(
      () =>
        LedgerService.postTransaction({
          type: "funding",
          reference: `test_${randomUUID()}`,
          amount: 0n,
          entries: [
            { accountId: platformFloat.id, direction: "debit", amount: 0n },
            { accountId: potAccount.id, direction: "credit", amount: 0n },
          ],
        }),
      LedgerError
    );
  });

  await t.test("rejects entries with no items", async () => {
    await assert.rejects(
      () => LedgerService.postTransaction({ type: "funding", reference: `test_${randomUUID()}`, amount: 0n, entries: [] }),
      LedgerError
    );
  });

  await t.test("rejects an entry referencing a nonexistent account", async () => {
    await assert.rejects(() =>
      LedgerService.postTransaction({
        type: "funding",
        reference: `test_${randomUUID()}`,
        amount: 1000n,
        entries: [
          { accountId: randomUUID(), direction: "debit", amount: 1000n },
          { accountId: randomUUID(), direction: "credit", amount: 1000n },
        ],
      })
    );
  });

  await t.test("is idempotent by reference: a repeat call returns the original transaction and does not double-post", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const reference = `test_${randomUUID()}`;
    const input = {
      type: "funding" as const,
      reference,
      amount: 50_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit" as const, amount: 50_000n },
        { accountId: potAccount.id, direction: "credit" as const, amount: 50_000n },
      ],
    };

    const first = await LedgerService.postTransaction(input);
    const second = await LedgerService.postTransaction(input);

    assert.equal(first.id, second.id);
    // Balance reflects ONE posting, not two, despite two calls.
    assert.equal(await LedgerService.getBalance(potAccount.id), 50_000n);
  });

  await t.test("concurrent postTransaction calls with the same reference converge on one transaction and one posting", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");
    const reference = `test_concurrent_${randomUUID()}`;
    const input = {
      type: "funding" as const,
      reference,
      amount: 25_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit" as const, amount: 25_000n },
        { accountId: potAccount.id, direction: "credit" as const, amount: 25_000n },
      ],
    };

    // Simulates two racing callers (e.g. a redelivered webhook processed
    // twice in parallel) — the unique constraint on transactions.reference
    // is what actually prevents a double-post; this just proves both
    // calls resolve successfully to the SAME row rather than one throwing
    // an unhandled duplicate-key error to its caller.
    const [a, b] = await Promise.all([LedgerService.postTransaction(input), LedgerService.postTransaction(input)]);

    assert.equal(a.id, b.id);
    assert.equal(await LedgerService.getBalance(potAccount.id), 25_000n);
  });

  await t.test("getBalance returns 0n for an account with no postings yet", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    assert.equal(await LedgerService.getBalance(potAccount.id), 0n);
  });

  await t.test("reverseTransaction flips every entry's direction and nets the balance back to zero", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    const original = await LedgerService.postTransaction({
      type: "contribution",
      reference: `test_${randomUUID()}`,
      amount: 70_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amount: 70_000n },
        { accountId: potAccount.id, direction: "credit", amount: 70_000n },
      ],
    });

    const reversal = await LedgerService.reverseTransaction(original.id, `test_reversal_${randomUUID()}`);

    assert.equal(reversal.type, "reversal");
    assert.equal(await LedgerService.getBalance(potAccount.id), 0n);
    assert.equal(await LedgerService.getBalance(platformFloat.id), 0n);
  });

  await t.test("reverseTransaction marks the original transaction 'reversed'", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);
    const potAccount = await AccountsService.getOrCreatePotAccount(pot.id);
    const platformFloat = await AccountsService.getOrCreateSystemAccount("platform_float");

    const original = await LedgerService.postTransaction({
      type: "contribution",
      reference: `test_${randomUUID()}`,
      amount: 10_000n,
      entries: [
        { accountId: platformFloat.id, direction: "debit", amount: 10_000n },
        { accountId: potAccount.id, direction: "credit", amount: 10_000n },
      ],
    });

    await LedgerService.reverseTransaction(original.id, `test_reversal_${randomUUID()}`);

    const [updated] = await db.select().from(transactions).where(eq(transactions.id, original.id));
    assert.equal(updated.status, "reversed");
  });

  await t.test("reverseTransaction throws for a nonexistent transaction id", async () => {
    await assert.rejects(() => LedgerService.reverseTransaction(randomUUID(), `test_${randomUUID()}`), LedgerError);
  });

  await t.test("markCompleted throws for a nonexistent transaction id", async () => {
    await assert.rejects(() => LedgerService.markCompleted(randomUUID()), LedgerError);
  });
});