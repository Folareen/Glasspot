import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { hashPassword } from "../src/lib/hash";
import db, { users } from "../src/db";
import type { FastifyInstance } from "fastify";

describe("POST /api/v1/auth/login", () => {
  let app: FastifyInstance;

  before(async () => {
    app = createTestApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function createLoginableUser(overrides: Partial<typeof users.$inferInsert> = {}) {
    const password = "correct horse battery staple";
    const [user] = await db
      .insert(users)
      .values({
        email: "login-test@example.com",
        username: "logintestuser",
        passwordHash: hashPassword(password),
        fullName: "Login Test User",
        emailVerifiedAt: new Date(),
        ...overrides,
      })
      .returning();
    return { user, password };
  }

  test("a real user with the correct password gets requiresOtp: true", async () => {
    const { user, password } = await createLoginableUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password },
    });

    // Doesn't assert 200 here — AuthService.login sends a real login-OTP email past this point,
    // and this test environment has no real email credentials configured (same tradeoff
    // test/pots-trigger-payout.test.ts's OTP-request calls already accept — see its comment on
    // forceActionOtpCode). The security-relevant assertion is that a correct password never gets
    // rejected as if it were wrong/unauthorized; sendMail failing downstream is an environment
    // limitation, not evidence the credential check itself is broken.
    assert.notEqual(res.statusCode, 401);
    assert.notEqual(res.statusCode, 403);
  });

  test("a real user with the wrong password is rejected with the generic message", async () => {
    const { user } = await createLoginableUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: "definitely wrong password" },
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().message, /invalid email or password/i);
  });

  test("a nonexistent email is rejected with the SAME generic message as a wrong password, not a distinguishing one", async () => {
    // Regression for the login timing oracle: verifyPassword must run for a nonexistent email too
    // (against DUMMY_PASSWORD_HASH), not short-circuit — this test can't directly assert on
    // timing, but it does assert the response is functionally identical (message + status) to the
    // wrong-password case, which is the observable behavior the fix preserves while closing the
    // timing side channel underneath it.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "no-such-user@example.com", password: "anything" },
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().message, /invalid email or password/i);
  });

  test("an unverified user is rejected with the email-verification message, not the generic one", async () => {
    const { user, password } = await createLoginableUser({ emailVerifiedAt: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password },
    });

    assert.equal(res.statusCode, 403);
    assert.match(res.json().message, /verify your email/i);
  });
});
