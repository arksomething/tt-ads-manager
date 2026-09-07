import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  normalizeAdminStaffMutation,
  parseAdminStaffAccessInput,
} from "@/server/admin/staff";

const maximumBodyBytes = 4_096;

function copyAuthState(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(key);
    if (value) target.headers.set(key, value);
  }
  target.headers.set("Cache-Control", "private, no-store, max-age=0");
  return target;
}

function json(
  authResponse: NextResponse,
  body: Record<string, unknown>,
  status: number,
) {
  return copyAuthState(authResponse, NextResponse.json(body, { status }));
}

function rpcError(authResponse: NextResponse, error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";

  if (code === "42501") {
    return json(authResponse, { error: "Administrator access is required." }, 403);
  }
  if (code === "P0002") {
    return json(authResponse, {
      error: "No existing confirmed creator-platform account matches that email.",
    }, 404);
  }
  if (code === "55000") {
    return json(authResponse, {
      error: "That account already has a different stored staff role. This recovery path does not change roles.",
    }, 409);
  }
  if (code === "22023" || code === "23514") {
    return json(authResponse, {
      error: "Enter a valid account email and role. Administrator access also requires the exact confirmation phrase.",
    }, 422);
  }
  return json(authResponse, {
    error: "Staff access could not be saved. No access change is being claimed.",
  }, 503);
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();

  if (!hasSupabaseAuthEnv()) {
    return json(authResponse, { error: "Staff administration is not configured." }, 503);
  }

  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return json(authResponse, { error: "Send the staff request as JSON." }, 415);
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return json(authResponse, { error: "A same-origin browser request is required." }, 403);
  }
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) {
      return json(authResponse, { error: "Request origin was not accepted." }, 403);
    }
  } catch {
    return json(authResponse, { error: "Request origin was not accepted." }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return json(authResponse, { error: "Staff request is too large." }, 413);
  }

  let input = null;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > maximumBodyBytes) {
      return json(authResponse, { error: "Staff request is too large." }, 413);
    }
    input = parseAdminStaffAccessInput(JSON.parse(rawBody));
  } catch {
    // The validation response below intentionally avoids echoing parser input.
  }

  if (!input) {
    return json(authResponse, {
      error: "Enter the exact account email and choose reviewer or administrator access.",
    }, 400);
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return json(authResponse, { error: "Sign in with an administrator account." }, 401);
  }

  const { data, error } = await supabase.rpc("add_or_reactivate_creator_staff", {
    target_email: input.email,
    target_role: input.role,
    admin_confirmation: input.confirmation,
  });
  if (error) return rpcError(authResponse, error);

  const mutation = normalizeAdminStaffMutation(data, input);
  if (!mutation) {
    return json(authResponse, {
      error: "Staff access was saved, but its verified response was incomplete. Refresh before continuing.",
    }, 503);
  }

  return json(authResponse, mutation, 200);
}
