import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { getFormString } from "@/server/auth/http";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const nextPath = sanitizeNextPath(getFormString(formData, "next"), "/");
  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);

  if (hasSupabaseAuthEnv()) {
    const supabase = createRouteHandlerClient(request, response);
    await supabase.auth.signOut();
  }

  return response;
}
