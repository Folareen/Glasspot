import test from "node:test";
import assert from "node:assert/strict";

import { resetDb, closeDb } from "./helpers/db";
import { AccountsService } from "../src/modules/ledger/accounts.service";
import { createTestUser, createTestPot } from "./helpers/factories";

test("AccountsService", async (t) => {
  t.after(async () => {
    await closeDb();
  });

  t.beforeEach(async () => {
    await resetDb();
  });

  await t.test("getOrCreatePotAccount is idempotent — returns the same account on repeat calls", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);

    const first = await AccountsService.getOrCreatePotAccount(pot.id);
    const second = await AccountsService.getOrCreatePotAccount(pot.id);

    assert.equal(first.id, second.id);
    assert.equal(first.normalBalance, "credit");
    assert.equal(first.ownerType, "pot");
  });

  await t.test("getOrCreatePotAccount survives concurrent first-use calls without creating two rows", async () => {
    const user = await createTestUser();
    const pot = await createTestPot(user.id);

    const [a, b] = await Promise.all([
      AccountsService.getOrCreatePotAccount(pot.id),
      AccountsService.getOrCreatePotAccount(pot.id),
    ]);

    assert.equal(a.id, b.id);
  });

  await t.test("getOrCreateSystemAccount creates a debit-normal platform_float account with no ownerId", async () => {
    const account = await AccountsService.getOrCreateSystemAccount("platform_float");
    assert.equal(account.normalBalance, "debit");
    assert.equal(account.ownerId, null);
  });

  await t.test("getOrCreateSystemAccount creates a credit-normal platform_revenue account", async () => {
    const account = await AccountsService.getOrCreateSystemAccount("platform_revenue");
    assert.equal(account.normalBalance, "credit");
  });

  await t.test("getOrCreateSystemAccount is a single row per ownerType across the whole system", async () => {
    const first = await AccountsService.getOrCreateSystemAccount("suspense");
    const second = await AccountsService.getOrCreateSystemAccount("suspense");
    assert.equal(first.id, second.id);
  });

  await t.test("pot accounts and system accounts never collide even if IDs coincidentally overlap in ownerType-less lookups", async () => {
    const user = await createTestUser();
    const potA = await createTestPot(user.id);
    const potB = await createTestPot(user.id);

    const accountA = await AccountsService.getOrCreatePotAccount(potA.id);
    const accountB = await AccountsService.getOrCreatePotAccount(potB.id);

    assert.notEqual(accountA.id, accountB.id);
  });
});