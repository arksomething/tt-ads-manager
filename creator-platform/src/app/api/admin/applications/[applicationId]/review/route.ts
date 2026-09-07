import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";

const maximumBodyBytes = 16_384;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[a-f0-9]{64}$/u;
const reviewActions = ["start_review", "request_changes", "reject", "approve"] as const;

type ReviewAction = (typeof reviewActions)[number];
type RouteContext = { params: Promise<{ applicationId: string }> };

type ParsedDecision = {
  action: ReviewAction;
  applicantMessage: string | null;
  staffNote: string | null;
  dealReviewConfirmed: boolean;
  expectedDealVersionId: string | null;
  expectedDealSnapshotHash: string | null;
};

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

function parseText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= maximum ? normalized : undefined;
}

function parseDecision(value: unknown): ParsedDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string"
    ? reviewActions.find((candidate) => candidate === record.action)
    : undefined;
  const applicantMessage = parseText(record.applicantMessage, 2_000);
  const staffNote = parseText(record.staffNote, 4_000);

  if (!action || applicantMessage === undefined || staffNote === undefined) return null;
  if ((action === "request_changes" || action === "reject") && !applicantMessage) {
    return null;
  }

  const dealFieldNames = [
    "dealReviewConfirmed",
    "expectedDealVersionId",
    "expectedDealSnapshotHash",
  ];
  if (action === "approve") {
    if (
      record.dealReviewConfirmed !== true ||
      typeof record.expectedDealVersionId !== "string" ||
      !uuidPattern.test(record.expectedDealVersionId) ||
      typeof record.expectedDealSnapshotHash !== "string" ||
      !hashPattern.test(record.expectedDealSnapshotHash)
    ) return null;
    return {
      action,
      applicantMessage,
      staffNote,
      dealReviewConfirmed: true,
      expectedDealVersionId: record.expectedDealVersionId,
      expectedDealSnapshotHash: record.expectedDealSnapshotHash,
    };
  }

  if (dealFieldNames.some((key) => key in record)) return null;

  return {
    action,
    applicantMessage,
    staffNote,
    dealReviewConfirmed: false,
    expectedDealVersionId: null,
    expectedDealSnapshotHash: null,
  };
}

function resultRecord(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : {};
}

function rpcError(
  authResponse: NextResponse,
  error: unknown,
) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";

  if (code === "42501") {
    return json(authResponse, { error: "Reviewer access is required." }, 403);
  }
  if (code === "P0002") {
    return json(authResponse, { error: "Application was not found." }, 404);
  }
  if (code === "55000") {
    return json(
      authResponse,
      { error: "Approval is blocked because the reviewed default deal is unavailable, changed, or not ready. Refresh and review the exact deal before trying again." },
      409,
    );
  }
  if (code === "22023" || code === "23505" || code === "40001") {
    return json(
      authResponse,
      { error: "That decision is no longer valid for the current application state. Refresh and try again." },
      409,
    );
  }

  return json(
    authResponse,
    { error: "The review decision could not be saved. No status change is being claimed." },
    503,
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();

  if (!hasSupabaseAuthEnv()) {
    return json(authResponse, { error: "Application review is not configured." }, 503);
  }

  const { applicationId } = await context.params;
  if (!uuidPattern.test(applicationId)) {
    return json(authResponse, { error: "Application identifier is invalid." }, 400);
  }

  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return json(authResponse, { error: "Send the review decision as JSON." }, 415);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) {
        return json(authResponse, { error: "Request origin was not accepted." }, 403);
      }
    } catch {
      return json(authResponse, { error: "Request origin was not accepted." }, 403);
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return json(authResponse, { error: "Review decision is too large." }, 413);
  }

  let decision: ParsedDecision | null = null;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > maximumBodyBytes) {
      return json(authResponse, { error: "Review decision is too large." }, 413);
    }
    decision = parseDecision(JSON.parse(rawBody));
  } catch {
    // The shared response below intentionally does not echo parser details.
  }

  if (!decision) {
    return json(
      authResponse,
      { error: "Choose a valid decision. Approval requires confirmation of the exact current deal; change requests and rejections require a creator-facing message." },
      400,
    );
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return json(authResponse, { error: "Sign in with a staff account." }, 401);
  }

  const { data, error } = await supabase.rpc("review_creator_application_v2", {
    target_application_id: applicationId,
    review_action: decision.action,
    applicant_message: decision.applicantMessage,
    staff_note: decision.staffNote,
    deal_review_confirmed: decision.dealReviewConfirmed,
    expected_deal_version_id: decision.expectedDealVersionId,
    expected_deal_snapshot_sha256: decision.expectedDealSnapshotHash,
  });

  if (error) return rpcError(authResponse, error);

  const result = resultRecord(data);
  return json(authResponse, {
    applicationId: result.application_id ?? applicationId,
    status: result.application_status ?? null,
    lifecycleStatus: result.lifecycle_status ?? null,
    enrollmentId: result.enrollment_id ?? null,
    agreementId: result.agreement_id ?? null,
  }, 200);
}
