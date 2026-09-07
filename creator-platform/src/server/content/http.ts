import { NextResponse, type NextRequest } from "next/server";

import { copySupabaseResponseState } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/server-env";

export function isAcceptedContentOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === getAppOrigin(request.url);
  } catch {
    return false;
  }
}

export function contentRedirect(
  request: NextRequest,
  path: string,
  params: { notice?: string; error?: string },
  authResponse?: NextResponse,
) {
  const url = new URL(path, request.url);
  if (params.notice) url.searchParams.set("notice", params.notice);
  if (params.error) url.searchParams.set("error", params.error);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return authResponse ? copySupabaseResponseState(authResponse, response) : response;
}

export function formText(formData: FormData, key: string, maximum: number) {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximum);
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function contentMutationError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "42501") return "Your account does not have permission for that action.";
  if (code === "22023" || code === "23514" || code === "23503") {
    return "Check the content details and try again.";
  }
  return "The content change could not be saved. Please try again.";
}
