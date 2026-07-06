import test from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { createAuthenticatedUser, createTestPot, addTestMember } from "./helpers/factories";

test("pot member role/removal", async (t) => {
  const app = createTestApp();
  await app.ready();

  t.after(async () => {
    await app.close();
    await closeDb();
  });

  t.beforeEach(async () => {
    await resetDb();
  });

  await t.test("PATCH .../members/:userId demotes a member when another admin remains", async () => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const { user: otherAdmin } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);
    await addTestMember(pot.id, otherAdmin.id, "admin");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}/members/${otherAdmin.id}`,
      headers: { authorization: authHeader },
      payload: { role: "member" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().role, "member");
  });

  await t.test("PATCH .../members/:userId refuses to demote the last remaining admin", async () => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id); // admin is the sole admin

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}/members/${admin.id}`,
      headers: { authorization: authHeader },
      payload: { role: "member" },
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /last admin/i);
  });

  await t.test("DELETE .../members/:userId refuses to remove the last remaining admin", async () => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/pots/${pot.id}/members/${admin.id}`,
      headers: { authorization: authHeader },
    });

    assert.equal(response.statusCode, 409);
  });

  await t.test("DELETE .../members/:userId removes a plain member freely", async () => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const { user: member } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);
    await addTestMember(pot.id, member.id, "member");

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/pots/${pot.id}/members/${member.id}`,
      headers: { authorization: authHeader },
    });

    assert.equal(response.statusCode, 200);

    // Confirm it's actually gone, not just a 200 with no effect.
    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/pots/${pot.id}/members`,
    });
    const memberIds = listResponse.json().map((m: { userId: string }) => m.userId);
    assert.ok(!memberIds.includes(member.id));
  });

  await t.test("404s when target user is not a member of the pot", async () => {
    const { user: admin, authHeader } = await createAuthenticatedUser(app);
    const { user: stranger } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/pots/${pot.id}/members/${stranger.id}`,
      headers: { authorization: authHeader },
    });

    assert.equal(response.statusCode, 404);
  });

  await t.test("non-admin cannot change roles", async () => {
    const { user: admin } = await createAuthenticatedUser(app);
    const { user: member, authHeader: memberAuth } = await createAuthenticatedUser(app);
    const { user: otherMember } = await createAuthenticatedUser(app);
    const pot = await createTestPot(admin.id);
    await addTestMember(pot.id, member.id, "member");
    await addTestMember(pot.id, otherMember.id, "member");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/pots/${pot.id}/members/${otherMember.id}`,
      headers: { authorization: memberAuth },
      payload: { role: "admin" },
    });

    assert.equal(response.statusCode, 403);
  });
});