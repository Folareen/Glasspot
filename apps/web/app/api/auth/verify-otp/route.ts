import { NextRequest, NextResponse } from "next/server";
import { backendClient } from "@/lib/server/backend-client";
import { setSessionCookies } from "@/lib/server/session";

// Proxies POST /auth/login/verify-otp — the second step of login, after password success. On
// success, sets the session cookies here (first-party on this domain) instead of returning the
// tokens to the browser — see lib/server/session.ts.
export async function POST(request: NextRequest) {
  const body = await request.text();
  const response = await backendClient.post("/auth/login/verify-otp", body, {
    headers: { "content-type": "application/json" },
  });
  if (response.status === 200) {
    const { accessToken, refreshToken } = response.data as { accessToken: string; refreshToken: string };
    await setSessionCookies(accessToken, refreshToken);
  }
  return NextResponse.json(response.data, { status: response.status });
}
