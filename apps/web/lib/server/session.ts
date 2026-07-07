import { cookies } from "next/headers";
import { backendClient } from "./backend-client";

// First-party httpOnly cookies on the Vercel domain, set only by Route Handlers under app/api/ —
// never readable by client-side JS. This is the BFF pattern: the browser only ever talks to
// same-origin /api/* routes; only the Next.js server talks to the Railway API directly. See
// docs/frontend-rules.md and the auth section of docs/system-rules.md for why a cookie set
// directly by the (cross-site) backend would be unreliable (Safari ITP etc blocks third-party
// cookies even with SameSite=None).
const ACCESS_TOKEN_COOKIE = "glasspot_at";
const REFRESH_TOKEN_COOKIE = "glasspot_rt";

// Matches the backend's real token lifetimes (apps/backend/src/lib/plugins/jwt.ts's 15m access
// token, lib/tokens.ts's 30-day refresh token) so the cookie never outlives the JWT it holds.
const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function setSessionCookies(accessToken: string, refreshToken: string): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_TOKEN_COOKIE);
  store.delete(REFRESH_TOKEN_COOKIE);
}

export async function getSessionTokens(): Promise<{ accessToken?: string; refreshToken?: string }> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: store.get(REFRESH_TOKEN_COOKIE)?.value,
  };
}

/** Calls POST /auth/refresh with the given refresh token and, on success, both stores the rotated pair as this response's cookies and returns the new access token for the caller to retry its own request with. Returns null on failure (refresh token expired/revoked) — the caller should treat that as "not authenticated" rather than retry further. */
export async function refreshSession(refreshToken: string): Promise<string | null> {
  const response = await backendClient.post("/auth/refresh", { refreshToken });
  if (response.status !== 200) {
    await clearSessionCookies();
    return null;
  }
  const { accessToken, refreshToken: newRefreshToken } = response.data as {
    accessToken: string;
    refreshToken: string;
  };
  await setSessionCookies(accessToken, newRefreshToken);
  return accessToken;
}
