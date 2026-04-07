import { NextResponse } from "next/server";

import { hasSingularEnv, isGoogleAuthDisabled } from "@/lib/server-env";

export function GET() {
  const hasGenericProviderConfig =
    Boolean(process.env.DATA_PROVIDER_BASE_URL) &&
    Boolean(process.env.DATA_PROVIDER_API_KEY);
  const hasViralAppConfig =
    Boolean(process.env.VIRAL_APP_BASE_URL ?? process.env.DATA_PROVIDER_BASE_URL) &&
    Boolean(process.env.VIRAL_APP_API_KEY ?? process.env.DATA_PROVIDER_API_KEY);

  return NextResponse.json({
    ok: true,
    service: "billion-views-web",
    timestamp: new Date().toISOString(),
    configured: {
      database: Boolean(process.env.DATABASE_URL),
      googleAuth:
        !isGoogleAuthDisabled() &&
        Boolean(process.env.GOOGLE_CLIENT_ID) &&
        Boolean(process.env.GOOGLE_CLIENT_SECRET),
      publicAccess: isGoogleAuthDisabled(),
      aiAnalytics: Boolean(process.env.OPENAI_API_KEY),
      dataProvider: hasGenericProviderConfig,
      viralApp: hasViralAppConfig,
      singularReporting: hasSingularEnv(),
    },
  });
}
