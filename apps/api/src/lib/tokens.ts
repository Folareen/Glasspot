import crypto from "crypto";
import jwt from "jsonwebtoken";
import env from "@/config/env";

const REFRESH_TOKEN_SECRET = env.REFRESH_TOKEN_SECRET as string;
const REFRESH_TOKEN_TTL_DAYS = 30;

if (!REFRESH_TOKEN_SECRET) {
  throw new Error("REFRESH_TOKEN_SECRET env var is required");
}

export interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // unique id for this specific token instance, rotated every refresh
}

/**
 * Signs a refresh token as a small JWT carrying {sub, jti}. The JWT
 * signature is what lets /auth/refresh cheaply identify *which* user
 * presented a token (via `sub`) before doing the real check — comparing
 * hash(jti) against users.refreshTokenHash — which is what actually
 * proves it's the current, non-reused token for that session.
 */
export function signRefreshToken(userId: string): {
  token: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, jti }, REFRESH_TOKEN_SECRET, {
    expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
  });
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, jti, expiresAt };
}

/**
 * Verifies the JWT's signature and exp claim only. This proves the token
 * was issued by us and hasn't expired — it does NOT prove it's the
 * *current* token for the user. That's a separate check against
 * refreshTokenHash (see AuthService.refresh), which is where reuse
 * detection actually happens.
 */
export function verifyRefreshTokenSignature(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;
}

/** Hashes a token/jti with SHA-256 for storage as the user's refreshTokenHash. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}