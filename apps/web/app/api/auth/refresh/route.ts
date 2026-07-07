import { NextResponse } from "next/server";
import { getSessionTokens, refreshSession } from "@/lib/server/session";

// Lets a client component proactively refresh the session (e.g. after landing on a page with no
// valid access token cookie) without needing to know the backend's refresh contract — the actual
// refresh + cookie rotation is lib/server/session.ts's refreshSession, shared with the catch-all
// proxy's own transparent-401-retry path.
export async function POST() {
  const { refreshToken } = await getSessionTokens();
  if (!refreshToken) {
    return NextResponse.json({ message: "No session to refresh" }, { status: 401 });
  }
  const accessToken = await refreshSession(refreshToken);
  if (!accessToken) {
    return NextResponse.json({ message: "Session expired" }, { status: 401 });
  }
  return NextResponse.json({ message: "Session refreshed" }, { status: 200 });
}
