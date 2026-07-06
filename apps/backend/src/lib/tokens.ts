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

/** Signs a refresh token as a small JWT carrying {sub, jti}; the signature lets /auth/refresh cheaply identify the user via `sub` before the real reuse check — comparing hash(jti) against users.refreshTokenHash. */
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

/** Verifies only the JWT's signature and exp claim — proves the token was issued by us and unexpired, NOT that it's the current token for the user; reuse detection is a separate check against refreshTokenHash in AuthService.refresh. */
export function verifyRefreshTokenSignature(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;
}

/** Hashes a token/jti with SHA-256 for storage as the user's refreshTokenHash. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}