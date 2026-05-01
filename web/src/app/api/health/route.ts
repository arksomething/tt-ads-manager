import { NextResponse } from "next/server";

import {
  hasSingularEnv,
  hasSupabaseAuthEnv,
  hasSupabaseDatabaseEnv,
  isAuthDisabled,
} from "@/lib/server-env";

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
      database: hasSupabaseDatabaseEnv(),
      supabaseAuth: !isAuthDisabled() && hasSupabaseAuthEnv(),
      publicAccess: isAuthDisabled(),
      aiAnalytics: Boolean(process.env.OPENAI_API_KEY),
      dataProvider: hasGenericProviderConfig,
      viralApp: hasViralAppConfig,
      singularReporting: hasSingularEnv(),
    },
  });
}
