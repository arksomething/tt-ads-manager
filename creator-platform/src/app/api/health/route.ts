import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "gotall-creator-platform",
      // This endpoint proves only that the deployed web process can answer.
      // Integration readiness is derived from authenticated operations data.
      state: "web-process-ready",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
