import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AdminDealTemplateSourceArtifact,
  dealTemplateSourceBucket,
  maximumDealTemplateSourceBytes,
  normalizeAdminDealTemplateSourceArtifact,
} from "@/server/admin/deal-template-source";
import {
  archivedDealTemplateSourceBytesMatch,
  validateDealTemplateSourceBytes,
} from "@/server/admin/deal-template-source-bytes";

import {
  adminDealRpcError,
  copyAuthState,
  dealJson,
  requireAdminDealSession,
  validAdminDealId,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ dealId: string }> };

const maximumMultipartBytes = maximumDealTemplateSourceBytes + 256 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[a-f0-9]{64}$/u;
const allowedFormKeys = new Set(["file", "templateId", "snapshotHash"]);

function sameOriginMultipartRequest(request: NextRequest, authResponse: NextResponse) {
  const origin = request.headers.get("origin");
  try {
    if (!origin || new URL(origin).origin !== request.nextUrl.origin) {
      return dealJson(authResponse, { error: "A same-origin browser request is required." }, 403);
    }
  } catch {
    return dealJson(authResponse, { error: "A same-origin browser request is required." }, 403);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return dealJson(authResponse, { error: "Upload the template source as multipart form data." }, 415);
  }
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader === null) {
    return dealJson(authResponse, { error: "Content-Length is required before an upload can be read." }, 411);
  }
  if (!/^[1-9]\d*$/u.test(contentLengthHeader)) {
    return dealJson(authResponse, { error: "Content-Length must be a positive integer." }, 400);
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength)) {
    return dealJson(authResponse, { error: "Content-Length must be a safe positive integer." }, 400);
  }
  if (contentLength > maximumMultipartBytes) {
    return dealJson(authResponse, { error: "Template source uploads must be 4 MB or smaller." }, 413);
  }
  return null;
}

function formText(form: FormData, key: string) {
  const values = form.getAll(key);
  return values.length === 1 && typeof values[0] === "string" ? values[0].trim() : "";
}

function artifactMatchesUpload(
  artifact: AdminDealTemplateSourceArtifact,
  expected: {
    dealId: string;
    templateId: string;
    snapshotHash: string;
    sourceSha256: string;
    storagePath: string;
    byteSize: number;
  },
) {
  return artifact.dealVersionId === expected.dealId &&
    artifact.templateId === expected.templateId &&
    artifact.snapshotHash === expected.snapshotHash &&
    artifact.sourceSha256 === expected.sourceSha256 &&
    artifact.storagePath === expected.storagePath &&
    artifact.byteSize === expected.byteSize;
}

function rpcErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function downloadFilename(value: string) {
  return value.replace(/[^A-Za-z0-9._() -]+/gu, "-").slice(0, 200) || "template-source";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const rejected = sameOriginMultipartRequest(request, authResponse);
  if (rejected) return rejected;

  const { dealId } = await context.params;
  if (!validAdminDealId(dealId)) {
    return dealJson(authResponse, { error: "Deal identifier is invalid." }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;

  // Prove the caller is an active administrator, and that the deal exists,
  // before Next parses or buffers any multipart bytes.
  const authorization = await session.supabase.rpc(
    "authorize_admin_program_deal_template_source_upload",
    { target_deal_version_id: dealId },
  );
  if (authorization.error) return adminDealRpcError(authResponse, authorization.error);
  if (authorization.data !== true) {
    return dealJson(authResponse, {
      error: "The server did not authorize reading this template source upload.",
    }, 503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return dealJson(authResponse, { error: "The template source upload could not be read." }, 400);
  }
  if ([...form.keys()].some((key) => !allowedFormKeys.has(key))) {
    return dealJson(authResponse, {
      error: "The upload contained unsupported evidence fields. The server computes the source hash.",
    }, 400);
  }

  const templateId = formText(form, "templateId");
  const snapshotHash = formText(form, "snapshotHash");
  const files = form.getAll("file");
  const file = files.length === 1 && files[0] instanceof File ? files[0] : null;
  if (!uuidPattern.test(templateId) || !hashPattern.test(snapshotHash) || !file || file.size < 1) {
    return dealJson(authResponse, {
      error: "Choose one PDF or DOCX source, a production SignWell template ID, and the exact snapshot.",
    }, 400);
  }
  if (file.size > maximumDealTemplateSourceBytes) {
    return dealJson(authResponse, { error: "Template source uploads must be 4 MB or smaller." }, 413);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return dealJson(authResponse, { error: "The template source upload could not be read." }, 400);
  }
  if (bytes.byteLength !== file.size || bytes.byteLength > maximumDealTemplateSourceBytes) {
    return dealJson(authResponse, { error: "The template source size could not be verified." }, 400);
  }
  const evidence = await validateDealTemplateSourceBytes(file.name, bytes);
  if (!evidence) {
    return dealJson(authResponse, {
      error: "Choose a valid PDF or DOCX source. Renaming another file type is not accepted.",
    }, 415);
  }

  const preflight = await session.supabase.rpc(
    "prepare_admin_program_deal_template_source_upload",
    {
      target_deal_version_id: dealId,
      expected_snapshot_sha256: snapshotHash,
      provider_template_id_input: templateId,
    },
  );
  if (preflight.error) return adminDealRpcError(authResponse, preflight.error);
  if (preflight.data !== true) {
    return dealJson(authResponse, {
      error: "The server did not authorize this immutable source upload.",
    }, 503);
  }

  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${dealId}/${randomUUID()}.${evidence.extension}`;
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return dealJson(authResponse, { error: "Private template-source storage is not configured." }, 503);
  }

  const uploaded = await admin.storage.from(dealTemplateSourceBucket).upload(storagePath, bytes, {
    cacheControl: "0",
    contentType: evidence.contentType,
    upsert: false,
  });
  if (uploaded.error) {
    return dealJson(authResponse, {
      error: "The template source could not be written to the private archive.",
    }, 503);
  }

  const archived = await admin.rpc("archive_admin_program_deal_template_source", {
    target_deal_version_id: dealId,
    actor_user_id_input: session.actorUserId,
    expected_snapshot_sha256: snapshotHash,
    provider_template_id_input: templateId,
    source_sha256_input: sourceSha256,
    storage_path_input: storagePath,
    original_filename_input: evidence.originalFilename,
    content_type_input: evidence.contentType,
    byte_size_input: bytes.byteLength,
  });
  const expectedArtifact = {
    dealId,
    templateId,
    snapshotHash,
    sourceSha256,
    storagePath,
    byteSize: bytes.byteLength,
  };
  let artifact = normalizeAdminDealTemplateSourceArtifact(archived.data);
  if (artifact && artifactMatchesUpload(artifact, expectedArtifact)) {
    return dealJson(authResponse, { artifact }, 201);
  }

  // A transport error can arrive after the transaction committed. Re-read the
  // authoritative record before deciding whether this object is an orphan.
  // If that read is itself ambiguous, retain the private object for operator
  // reconciliation; deleting it could destroy the only bytes behind a commit.
  const readback = await session.supabase.rpc(
    "get_admin_program_deal_template_source_artifact",
    { target_deal_version_id: dealId },
  );
  artifact = normalizeAdminDealTemplateSourceArtifact(readback.data);
  if (!readback.error && artifact && artifactMatchesUpload(artifact, expectedArtifact)) {
    return dealJson(authResponse, { artifact }, 201);
  }

  const registrationDefinitelyAbsent = rpcErrorCode(readback.error) === "P0002" ||
    (!readback.error && (
      readback.data === null || (artifact !== null && artifact.storagePath !== storagePath)
    ));
  if (registrationDefinitelyAbsent) {
    const cleanup = await admin.storage.from(dealTemplateSourceBucket).remove([storagePath]);
    if (cleanup.error) {
      return dealJson(authResponse, {
        error: "Registration was not accepted, but its private staged object needs operator cleanup.",
        reconciliationId: storagePath.split("/").at(-1)?.split(".", 1)[0],
      }, 503);
    }
    if (archived.error) return adminDealRpcError(authResponse, archived.error);
    return dealJson(authResponse, {
      error: "Another immutable template source is already registered for this deal. Refresh before continuing.",
    }, 409);
  }

  return dealJson(authResponse, {
    error: "The registration outcome could not be confirmed. The private staged object was retained; refresh before retrying or give the reconciliation ID to an operator.",
    reconciliationId: storagePath.split("/").at(-1)?.split(".", 1)[0],
  }, 503);

}

export async function GET(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const { dealId } = await context.params;
  if (!validAdminDealId(dealId)) {
    return dealJson(authResponse, { error: "Deal identifier is invalid." }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;
  const loaded = await session.supabase.rpc(
    "get_admin_program_deal_template_source_artifact",
    { target_deal_version_id: dealId },
  );
  if (loaded.error) return adminDealRpcError(authResponse, loaded.error);
  const artifact = normalizeAdminDealTemplateSourceArtifact(loaded.data);
  if (!artifact) {
    return dealJson(authResponse, { error: "No archived template source was found." }, 404);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return dealJson(authResponse, { error: "Private template-source storage is not configured." }, 503);
  }
  const downloaded = await admin.storage
    .from(artifact.storageBucket)
    .download(artifact.storagePath);
  if (downloaded.error || !downloaded.data) {
    return dealJson(authResponse, {
      error: "The archived template source could not be retrieved. Do not attest until it is available.",
    }, 503);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await downloaded.data.arrayBuffer());
  } catch {
    return dealJson(authResponse, {
      error: "The archived template source could not be verified. Do not attest until it is available.",
    }, 503);
  }
  if (!await archivedDealTemplateSourceBytesMatch(artifact, bytes)) {
    return dealJson(authResponse, {
      error: "The archived bytes no longer match their immutable size, type, and SHA-256. Do not attest or activate this version.",
    }, 409);
  }

  const responseBytes = new Uint8Array(bytes.byteLength);
  responseBytes.set(bytes);
  const response = new NextResponse(responseBytes.buffer, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${downloadFilename(artifact.originalFilename)}"`,
      "Content-Type": artifact.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
  return copyAuthState(authResponse, response);
}
