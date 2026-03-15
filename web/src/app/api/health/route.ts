import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "billion-views-web",
    timestamp: new Date().toISOString(),
    configured: {
      database: Boolean(process.env.DATABASE_URL),
      googleAuth:
        Boolean(process.env.GOOGLE_CLIENT_ID) &&
        Boolean(process.env.GOOGLE_CLIENT_SECRET),
      dataProvider:
        Boolean(process.env.DATA_PROVIDER_BASE_URL) &&
        Boolean(process.env.DATA_PROVIDER_API_KEY),
    },
  });
}
