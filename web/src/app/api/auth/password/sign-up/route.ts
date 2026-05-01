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
    notice?: string | null;
  },
) {
  const url = new URL("/login", request.url);

  if (args.mode === "switch-account") {
    url.searchParams.set("mode", "switch-account");
  }

  if (args.error) {
    url.searchParams.set("error", args.error);
  }

  if (args.notice) {
    url.searchParams.set("notice", args.notice);
  }

  return url;
}

function getEmailRedirectTo(request: NextRequest) {
  const url = new URL("/auth/confirm", request.url);
  url.searchParams.set("next", "/app");
  return url.toString();
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
  const { data, error } = await supabase.auth.signUp({
    email: getFormString(formData, "email").trim().toLowerCase(),
    password: getFormString(formData, "password"),
    options: {
      emailRedirectTo: getEmailRedirectTo(request),
    },
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

  if (data.session && data.user) {
    await syncAuthUserRecord({
      supabaseUser: data.user,
    });
    return successResponse;
  }

  return NextResponse.redirect(
    getLoginRedirectUrl(request, {
      mode,
      notice: "Check your inbox for the confirmation link before signing in.",
    }),
    303,
  );
}
