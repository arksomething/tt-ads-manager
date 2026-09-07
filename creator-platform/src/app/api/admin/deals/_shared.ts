import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { normalizeAdminDealDetail, type AdminDealDetail } from "@/server/admin/deals";

const maximumBodyBytes = 131_072;

export type AdminDealRouteContext = {
  actorUserId: string;
  request: NextRequest;
  authResponse: NextResponse;
  supabase: ReturnType<typeof createRouteHandlerClient>;
};

export function copyAuthState(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(key);
    if (value) target.headers.set(key, value);
  }
  target.headers.set("Cache-Control", "private, no-store, max-age=0");
  return target;
}

export function dealJson(
  authResponse: NextResponse,
  body: Record<string, unknown>,
  status: number,
) {
  return copyAuthState(authResponse, NextResponse.json(body, { status }));
}

export function validateDealWriteRequest(request: NextRequest, authResponse: NextResponse) {
  if (!hasSupabaseAuthEnv()) {
    return dealJson(authResponse, { error: "Deal administration is not configured." }, 503);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return dealJson(authResponse, { error: "Send the deal request as JSON." }, 415);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) {
        return dealJson(authResponse, { error: "Request origin was not accepted." }, 403);
      }
    } catch {
      return dealJson(authResponse, { error: "Request origin was not accepted." }, 403);
    }
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return dealJson(authResponse, { error: "Deal request is too large." }, 413);
  }
  return null;
}

export function validateDealReleaseRequest(request: NextRequest, authResponse: NextResponse) {
  const rejected = validateDealWriteRequest(request, authResponse);
  if (rejected) return rejected;
  if (!request.headers.get("origin")) {
    return dealJson(authResponse, { error: "A same-origin browser request is required." }, 403);
  }
  return null;
}

export function validAdminDealId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(value);
}

export async function parseDealJsonBody(request: NextRequest): Promise<unknown | undefined> {
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) return undefined;
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export async function requireAdminDealSession(
  request: NextRequest,
  authResponse: NextResponse,
): Promise<AdminDealRouteContext | NextResponse> {
  const supabase = createRouteHandlerClient(request, authResponse);
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return dealJson(authResponse, { error: "Sign in with an administrator account." }, 401);
  }
  return { actorUserId: data.claims.sub, request, authResponse, supabase };
}

export function adminDealRpcError(authResponse: NextResponse, error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "42501") {
    return dealJson(authResponse, { error: "Administrator access is required." }, 403);
  }
  if (code === "P0002") {
    return dealJson(authResponse, { error: "Deal version was not found." }, 404);
  }
  if (code === "40001") {
    return dealJson(authResponse, {
      error: "This deal snapshot changed in another session. Refresh before continuing.",
    }, 409);
  }
  if (code === "55000" || code === "23505") {
    return dealJson(authResponse, {
      error: "That operation is not valid for the current deal state.",
    }, 409);
  }
  if (code === "22023" || code === "23514") {
    return dealJson(authResponse, {
      error: "The request is incomplete or contains invalid deal evidence.",
    }, 422);
  }
  return dealJson(authResponse, {
    error: "The deal change could not be saved. No change is being claimed.",
  }, 503);
}

export function adminDealSuccess(
  authResponse: NextResponse,
  data: unknown,
  status: number,
) {
  const deal: AdminDealDetail | null = normalizeAdminDealDetail(data);
  if (!deal) {
    return dealJson(authResponse, {
      error: "The deal was saved, but its verified response was incomplete. Refresh before continuing.",
    }, 503);
  }
  return dealJson(authResponse, { deal }, status);
}
