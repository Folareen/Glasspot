import { NextRequest, NextResponse } from "next/server";
import { backendClient } from "@/lib/server/backend-client";
import { getSessionTokens, refreshSession } from "@/lib/server/session";

// Catch-all BFF proxy for every backend call except the auth flows that mint/rotate the session
// cookie itself (those live under app/api/auth/*, since they need to set cookies on the response
// rather than just forward one through). The browser only ever calls same-origin /api/<path>;
// this handler reads the httpOnly access-token cookie, forwards the request to the real backend
// with it as a Bearer header, and on a 401 (expired access token) transparently refreshes once
// and retries — see docs/system-rules.md's auth section and lib/server/session.ts.
//
// Forwards the Idempotency-Key header through untouched when present (see
// docs/system-rules.md's idempotency rule) so contribute/payout/refund calls stay safe to retry.

const FORWARDED_REQUEST_HEADERS = ["idempotency-key", "content-type"];

async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  const { accessToken } = await getSessionTokens();
  const targetPath = `/${path.join("/")}${request.nextUrl.search}`;
  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;

  const buildHeaders = (token?: string) => {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  let response = await backendClient.request({
    url: targetPath,
    method,
    data: body,
    headers: buildHeaders(accessToken),
  });

  if (response.status === 401 && accessToken) {
    const { refreshToken } = await getSessionTokens();
    const newAccessToken = refreshToken ? await refreshSession(refreshToken) : null;
    if (newAccessToken) {
      response = await backendClient.request({
        url: targetPath,
        method,
        data: body,
        headers: buildHeaders(newAccessToken),
      });
    }
  }

  const responseHeaders = new Headers();
  const retryAfter = response.headers["retry-after"];
  if (retryAfter) responseHeaders.set("Retry-After", String(retryAfter));

  return NextResponse.json(response.data, { status: response.status, headers: responseHeaders });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path);
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path);
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path);
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path);
}
