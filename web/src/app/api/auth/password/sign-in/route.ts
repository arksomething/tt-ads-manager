import { NextResponse, type NextRequest } from "next/server";

import { isAuthConfigured, syncAuthUserRecord } from "@/auth";
import { createRouteHandlerClient } from "@/lib/supabase/server";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getLoginRedirectUrl(
  request: NextRequest,
  args: {
    error?: string | null;
    mode?: string | null;
  },
) {
  const url = new URL("/login", request.url);

  if (args.mode === "switch-account") {
    url.searchParams.set("mode", "switch-account");
  }

  if (args.error) {
    url.searchParams.set("error", args.error);
  }

  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const mode = getFormString(formData, "mode");

  if (!isAuthConfigured) {
    return NextResponse.redirect(
      getLoginRedirectUrl(request, {
        error: "Supabase Auth is not configured for this environment yet.",
        mode,
      }),
      303,
    );
  }

  const successResponse = NextResponse.redirect(new URL("/app", request.url), 303);
  const supabase = createRouteHandlerClient(request, successResponse);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: getFormString(formData, "email").trim().toLowerCase(),
    password: getFormString(formData, "password"),
  });

  if (error) {
    return NextResponse.redirect(
      getLoginRedirectUrl(request, {
        error: error.message,
        mode,
      }),
      303,
    );
  }

  if (data.user) {
    await syncAuthUserRecord({
      supabaseUser: data.user,
    });
  }

  return successResponse;
}
