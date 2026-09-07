import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  contentMutationError,
  contentRedirect,
  formText,
  isAcceptedContentOrigin,
  isUuid,
} from "@/server/content/http";

export const dynamic = "force-dynamic";

const bucket = "creator-program-assets";
const maximumUploadBytes = 50 * 1024 * 1024;
const assetKinds = new Set(["brand", "template", "footage", "audio", "image", "document", "link", "other"]);

function safeFilename(value: string) {
  const normalized = value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 160) || "asset";
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isAcceptedContentOrigin(request)) {
    return contentRedirect(request, "/admin/assets", { error: "Request origin was not accepted." });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumUploadBytes + 64_000) {
    return contentRedirect(request, "/admin/assets", { error: "Uploads must be 50 MB or smaller." });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const accountId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
  if (claimsError || !accountId) {
    return contentRedirect(request, "/auth/sign-in", { error: "Sign in before managing assets." }, authResponse);
  }

  const formData = await request.formData();
  const action = formText(formData, "action", 32);
  let result: { data?: unknown; error: unknown } = { error: null };
  let notice = "Asset saved.";

  if (action === "create") {
    const title = formText(formData, "title", 140);
    const description = formText(formData, "description", 1000);
    const assetKind = formText(formData, "assetKind", 32);
    const sourceType = formText(formData, "sourceType", 32);
    const externalUrl = formText(formData, "externalUrl", 2048);
    const suppliedStoragePath = formText(formData, "storagePath", 512);
    const suppliedOriginalFilename = formText(formData, "originalFilename", 255);
    const suppliedMimeType = formText(formData, "mimeType", 160);
    const suppliedSizeBytes = Number(formText(formData, "sizeBytes", 24));
    const upload = formData.get("file");
    if (title.length < 2 || !assetKinds.has(assetKind) || (sourceType !== "upload" && sourceType !== "external_url")) {
      return contentRedirect(request, "/admin/assets", { error: "Complete the asset title, type, and source." }, authResponse);
    }

    let storagePath: string | null = null;
    let originalFilename: string | null = null;
    let mimeType: string | null = null;
    let sizeBytes: number | null = null;
    if (sourceType === "upload") {
      if (upload instanceof File && upload.size > 0) {
        if (upload.size > maximumUploadBytes) {
          return contentRedirect(request, "/admin/assets", { error: "Choose a file up to 50 MB." }, authResponse);
        }
        originalFilename = upload.name.slice(0, 255);
        mimeType = upload.type.slice(0, 160) || "application/octet-stream";
        sizeBytes = upload.size;
        storagePath = `${accountId}/${randomUUID()}/${safeFilename(upload.name)}`;
        const uploaded = await supabase.storage.from(bucket).upload(storagePath, upload, {
          contentType: mimeType,
          upsert: false,
        });
        if (uploaded.error) {
          return contentRedirect(request, "/admin/assets", { error: "The file could not be uploaded." }, authResponse);
        }
      } else {
        if (!suppliedStoragePath.startsWith(`${accountId}/`)
          || !suppliedOriginalFilename
          || !Number.isSafeInteger(suppliedSizeBytes)
          || suppliedSizeBytes < 1
          || suppliedSizeBytes > maximumUploadBytes) {
          return contentRedirect(request, "/admin/assets", { error: "Choose a file up to 50 MB." }, authResponse);
        }
        storagePath = suppliedStoragePath;
        originalFilename = suppliedOriginalFilename;
        mimeType = suppliedMimeType || "application/octet-stream";
        sizeBytes = suppliedSizeBytes;
      }
    } else {
      try {
        const url = new URL(externalUrl);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid");
      } catch {
        return contentRedirect(request, "/admin/assets", { error: "Enter a valid HTTPS asset URL." }, authResponse);
      }
    }

    result = await supabase.rpc("register_program_asset", {
      asset_input: {
        title,
        description,
        assetKind,
        sourceType,
        externalUrl: sourceType === "external_url" ? externalUrl : null,
        storagePath,
        originalFilename,
        mimeType,
        sizeBytes,
      },
    });
    if (result.error && storagePath) await supabase.storage.from(bucket).remove([storagePath]);
    notice = "Draft asset created.";
  } else if (action === "save") {
    const assetId = formText(formData, "assetId", 40);
    const title = formText(formData, "title", 140);
    const description = formText(formData, "description", 1000);
    const assetKind = formText(formData, "assetKind", 32);
    if (!isUuid(assetId) || title.length < 2 || !assetKinds.has(assetKind)) {
      return contentRedirect(request, "/admin/assets", { error: "Complete the asset title and type." }, authResponse);
    }
    result = await supabase.rpc("save_program_asset_metadata", {
      asset_input: { id: assetId, title, description, assetKind },
    });
    notice = "Asset revision saved.";
  } else if (action === "publish" || action === "archive") {
    const assetId = formText(formData, "assetId", 40);
    if (!isUuid(assetId)) return contentRedirect(request, "/admin/assets", { error: "Asset was not recognized." }, authResponse);
    result = await supabase.rpc("set_program_asset_status", {
      target_asset_id: assetId,
      target_status: action === "publish" ? "published" : "archived",
    });
    notice = action === "publish" ? "Asset published." : "Asset archived.";
  } else if (action === "delete") {
    const assetId = formText(formData, "assetId", 40);
    if (!isUuid(assetId)) return contentRedirect(request, "/admin/assets", { error: "Asset was not recognized." }, authResponse);
    result = await supabase.rpc("delete_draft_program_asset", { target_asset_id: assetId });
    if (!result.error) {
      const row = Array.isArray(result.data) && result.data[0] && typeof result.data[0] === "object"
        ? result.data[0] as Record<string, unknown>
        : null;
      const path = typeof row?.storage_path === "string" ? row.storage_path : null;
      if (path) await supabase.storage.from(bucket).remove([path]);
    }
    notice = "Draft asset deleted.";
  } else if (action === "assign") {
    const assetId = formText(formData, "assetId", 40);
    const enrollmentId = formText(formData, "enrollmentId", 40);
    const note = formText(formData, "note", 1000);
    if (!isUuid(assetId) || !isUuid(enrollmentId)) {
      return contentRedirect(request, "/admin/assets", { error: "Choose a creator for this assignment." }, authResponse);
    }
    result = await supabase.rpc("assign_program_asset", {
      assignment_input: { assetId, enrollmentId, note },
    });
    notice = "Asset assigned to creator.";
  } else if (action === "withdraw") {
    const assignmentId = formText(formData, "assignmentId", 40);
    if (!isUuid(assignmentId)) return contentRedirect(request, "/admin/assets", { error: "Assignment was not recognized." }, authResponse);
    result = await supabase.rpc("set_program_asset_assignment_state", {
      target_assignment_id: assignmentId,
      target_state: "withdrawn",
    });
    notice = "Asset assignment withdrawn.";
  } else {
    return contentRedirect(request, "/admin/assets", { error: "Asset action was not recognized." }, authResponse);
  }

  if (result.error) {
    return contentRedirect(request, "/admin/assets", { error: contentMutationError(result.error) }, authResponse);
  }
  return contentRedirect(request, "/admin/assets", { notice }, authResponse);
}
