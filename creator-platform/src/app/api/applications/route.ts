import { NextResponse, type NextRequest } from "next/server";

import { validateCreatorApplicationInput } from "@/lib/creator-application";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";

const maximumBodyBytes = 32_768;

function copyAuthHeaders(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }

  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(key);
    if (value) target.headers.set(key, value);
  }

  target.headers.set("Cache-Control", "private, no-store, max-age=0");
  return target;
}

function jsonResponse(
  authResponse: NextResponse,
  body: Record<string, unknown>,
  status: number,
) {
  return copyAuthHeaders(
    authResponse,
    NextResponse.json(body, { status }),
  );
}

function resultRecord(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : {};
}

function rpcErrorResponse(authResponse: NextResponse, error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";

  if (code === "23505") {
    return jsonResponse(
      authResponse,
      { error: "One of those creator handles is already connected to another account." },
      409,
    );
  }

  if (code === "22023") {
    return jsonResponse(
      authResponse,
      { error: "Check the application details and try again." },
      400,
    );
  }

  if (code === "42501") {
    return jsonResponse(
      authResponse,
      { error: "This account is not allowed to submit that application yet." },
      403,
    );
  }

  return jsonResponse(
    authResponse,
    { error: "We could not save the application. Please try again." },
    503,
  );
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();

  if (!hasSupabaseAuthEnv()) {
    return jsonResponse(
      authResponse,
      { error: "Application submission is not configured yet." },
      503,
    );
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    return jsonResponse(
      authResponse,
      { error: "Send application details as JSON." },
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return jsonResponse(authResponse, { error: "Application details are too large." }, 413);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) {
        return jsonResponse(authResponse, { error: "Request origin was not accepted." }, 403);
      }
    } catch {
      return jsonResponse(authResponse, { error: "Request origin was not accepted." }, 403);
    }
  }

  let input: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > maximumBodyBytes) {
      return jsonResponse(authResponse, { error: "Application details are too large." }, 413);
    }
    input = JSON.parse(rawBody);
  } catch {
    return jsonResponse(authResponse, { error: "Application details are not valid JSON." }, 400);
  }

  const validation = validateCreatorApplicationInput(input);
  if (!validation.ok) {
    return jsonResponse(authResponse, { error: validation.error }, 400);
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return jsonResponse(authResponse, { error: "Sign in before submitting an application." }, 401);
  }

  const { data, error } = await supabase.rpc("submit_creator_application", {
    application_input: validation.value,
  });

  if (error) {
    return rpcErrorResponse(authResponse, error);
  }

  const result = resultRecord(data);
  return jsonResponse(
    authResponse,
    {
      applicationId: result.application_id ?? result.id ?? null,
      status: result.status ?? "submitted",
    },
    201,
  );
}
