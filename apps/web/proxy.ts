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

// Entry pages only — /login/verify and /signup/verify are excluded even though they're nested
// under these prefixes, since they're mid-flow (no session cookie exists yet when they first
// render; the cookie is set server-side by verify-otp/verify-email only once the code is
// submitted, at which point OtpVerifyForm itself navigates away).
const GUEST_ONLY_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password"];

function isProtectedPotRoute(pathname: string) {
  if (pathname === "/pots/new") return true;
  return /^\/pots\/[^/]+\/edit(\/|$)/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("glasspot_at") || request.cookies.has("glasspot_rt");

  if (hasSession && GUEST_ONLY_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  const isProtected =
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || isProtectedPotRoute(pathname);
  if (!isProtected) return NextResponse.next();

  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/discover/:path*",
    "/activity/:path*",
    "/pots/:path*",
    "/profile/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ],
};
