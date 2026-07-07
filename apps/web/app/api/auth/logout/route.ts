import { NextResponse } from "next/server";
import { backendClient } from "@/lib/server/backend-client";
import { clearSessionCookies, getSessionTokens } from "@/lib/server/session";

// Revokes the session backend-side (best-effort) and always clears the local cookies regardless
// of whether the backend call succeeds — an already-expired/invalid access token shouldn't strand
// the user unable to log out client-side.
export async function POST() {
  const { accessToken } = await getSessionTokens();
  if (accessToken) {
    await backendClient.post(
      "/auth/logout",
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  }
  await clearSessionCookies();
  return NextResponse.json({ message: "Logged out" }, { status: 200 });
}
