import { NextResponse, type NextRequest } from "next/server";

export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function formRedirect(
  request: NextRequest,
  path: string,
  values: { notice?: string; error?: string },
  authResponse?: NextResponse,
) {
  const target = new URL(path, request.url);
  if (values.notice) target.searchParams.set("notice", values.notice);
  if (values.error) target.searchParams.set("error", values.error);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  if (authResponse) {
    for (const cookie of authResponse.cookies.getAll()) response.cookies.set(cookie);
  }
  return response;
}
