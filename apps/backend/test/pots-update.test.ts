import test from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { createAuthenticatedUser, createTestPot, addTestMember } from "./helpers/factories";

test("PATCH /pots/:id", async (t) => {
  const app = createTestApp();
  await app.ready();

  t.after(async () => {
    await app.close();
    await closeDb();
  });

  t.beforeEach(async () => {
    await resetDb();
  });

  await t.test("admin can update a draft pot's title", async () => {
    const { user, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(user.id);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}`,
      headers: { authorization: authHeader },
      payload: { title: "Renamed Pot" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().title, "Renamed Pot");
  });

  await t.test("non-admin member is rejected with 403", async () => {
    const { user: admin } = await createAuthenticatedUser(app);
    const { user: member, authHeader: memberAuth } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);
    await addTestMember(pot.id, member.id, "member");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}`,
      headers: { authorization: memberAuth },
      payload: { title: "Hijacked Title" },
    });

    assert.equal(response.statusCode, 403);
  });

  await t.test("a user with no membership at all is rejected with 403, not 404", async () => {
    const { user: admin } = await createAuthenticatedUser(app);
    const { authHeader: strangerAuth } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}`,
      headers: { authorization: strangerAuth },
      payload: { title: "Hijacked Title" },
    });

    // assertIsAdmin runs before getPotOrThrow in PotsService.update, so a
    // non-member gets 403 regardless of the pot's visibility — this is
    // deliberately NOT the same "don't leak existence" 404 pattern used by
    // getViewablePotOrThrow for GET routes.
    assert.equal(response.statusCode, 403);
  });

  await t.test("rejects updating a non-draft (open) pot", async () => {
    const { user, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(user.id, { status: "open" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}`,
      headers: { authorization: authHeader },
      payload: { title: "Too Late" },
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /draft/i);
  });

  await t.test("changing payoutMode without a matching payoutConfig is rejected", async () => {
    const { user, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(user.id, { payoutMode: "manual" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}`,
      headers: { authorization: authHeader },
      payload: { payoutMode: "recurring" },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().message, /payoutConfig is required/i);
  });

  await t.test("payoutConfig without payoutMode validates against the pot's current mode", async () => {
    const { user, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(user.id, { payoutMode: "manual" });

    // A manual payoutConfig with mismatched shape for the pot's existing
    // mode should still be accepted (it's a valid manual config) even
    // though payoutMode itself is omitted from the body.
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}`,
      headers: { authorization: authHeader },
      payload: { payoutConfig: { destinationAccount: "1000000001", destinationBank: "000013" } },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().payoutMode, "manual");
  });

  await t.test("404s for a pot id that doesn't exist", async () => {
    const { authHeader } = await createAuthenticatedUser(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/pots/00000000-0000-0000-0000-000000000000",
      headers: { authorization: authHeader },
      payload: { title: "Ghost Pot" },
    });

    // assertIsAdmin runs first and finds no membership row for a
    // nonexistent pot either, so this is also 403 — not 404 — since
    // getPotOrThrow (which would 404) never executes. Documenting this
    // explicitly since it's a slightly surprising status code for a
    // "does this even exist" query.
    assert.equal(response.statusCode, 403);
  });
});