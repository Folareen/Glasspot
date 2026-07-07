import { NextRequest, NextResponse } from "next/server";

// Gates every (app)/* route by session-cookie presence only — it can't verify the JWT itself at
// the edge without pulling in a JWT library for this thin check. That's fine: every real request
// still goes through the catch-all proxy (app/api/[...path]/route.ts), which attaches the token
// server-side and gets a real 401 from the backend if it's invalid/expired, refreshing or
// rejecting from there. This middleware only prevents an obviously-logged-out visitor from
// rendering a protected page at all.
const PROTECTED_PREFIXES = ["/home", "/discover", "/activity", "/pots", "/profile"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.has("glasspot_at") || request.cookies.has("glasspot_rt");
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/home/:path*", "/discover/:path*", "/activity/:path*", "/pots/:path*", "/profile/:path*"],
};
