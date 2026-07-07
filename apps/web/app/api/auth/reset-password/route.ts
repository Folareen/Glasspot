import { NextRequest, NextResponse } from "next/server";
import { backendClient } from "@/lib/server/backend-client";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const response = await backendClient.post("/auth/reset-password", body, {
    headers: { "content-type": "application/json" },
  });
  return NextResponse.json(response.data, { status: response.status });
}
