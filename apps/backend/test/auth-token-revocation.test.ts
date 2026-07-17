import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "./helpers/app";
import { resetDb, closeDb } from "./helpers/db";
import { createTestUser, signAccessToken } from "./helpers/factories";
import { AuthService } from "../src/modules/auth/auth.service";
import { hashOtpCode } from "../src/lib/otp";
import db, { otpCodes, users } from "../src/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/** Inserts an unconsumed OTP row directly, bypassing email delivery, so an AuthService flow's verifyOtp precondition is satisfiable in a test. */
async function insertOtp(userId: string, purpose: "login" | "password_reset", code: string) {
  await db.insert(otpCodes).values({
    userId,
    purpose,
    codeHash: hashOtpCode(code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
}

describe("access-token revocation via tokenVersion", () => {
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

  test("a freshly issued access token is accepted on a protected route", async () => {
    const user = await createTestUser();
    const accessToken = signAccessToken(app, user.id, user.tokenVersion);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    assert.equal(response.statusCode, 200);
  });

  test("logout invalidates a still-unexpired access token immediately", async () => {
    const user = await createTestUser();
    const accessToken = signAccessToken(app, user.id, user.tokenVersion);

    await AuthService.logout(user.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    assert.equal(response.statusCode, 401);
  });

  test("resetting the password invalidates every access token issued before the reset", async () => {
    const user = await createTestUser();
    const accessToken = signAccessToken(app, user.id, user.tokenVersion);
    const code = "654321";
    await insertOtp(user.id, "password_reset", code);

    await AuthService.resetPassword({ email: user.email, code, newPassword: "a-new-password-123" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    assert.equal(response.statusCode, 401);
  });

  test("refresh-token reuse detection invalidates the access token issued during the most recent legitimate rotation", async () => {
    const user = await createTestUser({ emailVerifiedAt: new Date() });
    const sign = (payload: object) => app.jwt.sign(payload);
    const code = "111222";
    await insertOtp(user.id, "login", code);

    const first = await AuthService.verifyLoginOtp(user.email, code, sign);
    const second = await AuthService.refresh(first.refreshToken, sign);

    // Presenting the now-stale first refresh token again is a reuse — the whole session,
    // including the access token issued during the legitimate rotation above, must die.
    await assert.rejects(() => AuthService.refresh(first.refreshToken, sign));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${second.accessToken}` },
    });

    assert.equal(response.statusCode, 401);
  });

  test("a token signed with a stale tokenVersion is rejected even though its signature is valid", async () => {
    const user = await createTestUser();
    // Simulates a token issued before some later revocation bumped tokenVersion — signed with the
    // user's ORIGINAL tokenVersion, while the DB's current value has since moved on.
    const staleAccessToken = signAccessToken(app, user.id, user.tokenVersion);
    await db.update(users).set({ tokenVersion: user.tokenVersion + 1 }).where(eq(users.id, user.id));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${staleAccessToken}` },
    });

    assert.equal(response.statusCode, 401);
  });
});
