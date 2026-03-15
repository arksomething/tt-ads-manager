import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { handlers } = await import("@/auth");

  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const { handlers } = await import("@/auth");

  return handlers.POST(request);
}
