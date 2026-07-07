import { NextRequest, NextResponse } from "next/server";

// Gates every (app)/* route by session-cookie presence only — it can't verify the JWT itself at
// the edge without pulling in a JWT library for this thin check. That's fine: every real request
// still goes through the catch-all proxy (app/api/[...path]/route.ts), which attaches the token
// server-side and gets a real 401 from the backend if it's invalid/expired, refreshing or
// rejecting from there. This middleware only prevents an obviously-logged-out visitor from
// rendering a protected page at all.
//
// /pots/[id] itself is deliberately excluded: a pot can be public, and an anonymous visitor
// needs to open it (and contribute) without a session — see contributions.service.ts's
// optionalAuthenticate. Only /pots/new and /pots/[id]/edit (creation/admin-only) stay gated,
// matched explicitly rather than via a blanket "/pots" prefix.
const PROTECTED_PREFIXES = ["/home", "/discover", "/activity", "/profile"];

function isProtectedPotRoute(pathname: string) {
  if (pathname === "/pots/new") return true;
  return /^\/pots\/[^/]+\/edit(\/|$)/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected =
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || isProtectedPotRoute(pathname);
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
