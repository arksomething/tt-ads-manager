import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as downloadTemplateSource,
  POST as archiveTemplateSource,
} from "@/app/api/admin/deals/[dealId]/template-source/route";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  download: vi.fn(),
  getClaims: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    storage: {
      from: () => ({
        download: mocks.download,
        remove: mocks.remove,
        upload: mocks.upload,
      }),
    },
  }),
}));

const origin = "https://gotall-creator-platform.vercel.app";
const dealId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const artifactId = "44444444-4444-4444-8444-444444444444";
const snapshotHash = "a".repeat(64);

function validPdf() {
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const object of [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ]) {
    offsets.push(Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(object);
  }
  const xrefOffset = Buffer.byteLength(parts.join(""), "latin1");
  parts.push(
    "xref\n0 4\n",
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    "trailer\n<< /Size 4 /Root 1 0 R >>\n",
    `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(parts.join(""), "latin1");
}

const pdfBytes = validPdf();
const sourceSha256 = createHash("sha256").update(pdfBytes).digest("hex");
const context = { params: Promise.resolve({ dealId }) };

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    dealVersionId: dealId,
    provider: "signwell",
    environment: "production",
    templateId,
    snapshotHash,
    sourceSha256,
    storageBucket: "creator-deal-template-sources",
    storagePath: `${dealId}/55555555-5555-4555-8555-555555555555.pdf`,
    originalFilename: "creator-agreement.pdf",
    contentType: "application/pdf",
    byteSize: pdfBytes.byteLength,
    uploadedBy: actorId,
    createdAt: "2026-09-03T12:00:00.000Z",
    ...overrides,
  };
}

function uploadRequest(
  mutate?: (form: FormData) => void,
  requestOrigin: string | null = origin,
  contentLength: string | null = String(pdfBytes.byteLength + 512),
) {
  const form = new FormData();
  form.set("templateId", templateId);
  form.set("snapshotHash", snapshotHash);
  form.set("file", new File([pdfBytes], "creator-agreement.pdf", { type: "application/pdf" }));
  mutate?.(form);
  const headers = new Headers({ "Content-Type": "multipart/form-data; boundary=test" });
  if (requestOrigin) headers.set("Origin", requestOrigin);
  if (contentLength !== null) headers.set("Content-Length", contentLength);
  return {
    headers,
    nextUrl: new URL(`${origin}/api/admin/deals/${dealId}/template-source`),
    formData: vi.fn().mockResolvedValue(form),
  } as unknown as NextRequest;
}

describe("admin immutable deal template source API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actorId } }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_admin_program_deal_template_source_artifact") {
        return { data: null, error: { code: "P0002" } };
      }
      return { data: true, error: null };
    });
    mocks.upload.mockResolvedValue({ data: { path: "stored" }, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.adminRpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
      data: artifact({
        storagePath: args.storage_path_input,
        originalFilename: args.original_filename_input,
        contentType: args.content_type_input,
        byteSize: args.byte_size_input,
        sourceSha256: args.source_sha256_input,
      }),
      error: null,
    }));
  });

  it("hashes validated bytes on the server before private immutable registration", async () => {
    const request = uploadRequest();
    const response = await archiveTemplateSource(request, context);

    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "authorize_admin_program_deal_template_source_upload",
      { target_deal_version_id: dealId },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "prepare_admin_program_deal_template_source_upload",
      {
        target_deal_version_id: dealId,
        expected_snapshot_sha256: snapshotHash,
        provider_template_id_input: templateId,
      },
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(request.formData).mock.invocationCallOrder[0]!,
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${dealId}/[0-9a-f-]{36}\\.pdf$`, "u")),
      expect.anything(),
      { cacheControl: "0", contentType: "application/pdf", upsert: false },
    );
    expect(Buffer.isBuffer(mocks.upload.mock.calls[0]?.[1])).toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "archive_admin_program_deal_template_source",
      expect.objectContaining({
        actor_user_id_input: actorId,
        byte_size_input: pdfBytes.byteLength,
        expected_snapshot_sha256: snapshotHash,
        provider_template_id_input: templateId,
        source_sha256_input: sourceSha256,
        target_deal_version_id: dealId,
      }),
    );
    const sent = mocks.adminRpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("source_sha256_from_browser");
    expect((await response.json()).artifact.sourceSha256).toBe(sourceSha256);
  });

  it("rejects browser hash/status fields and renamed non-PDF bytes before storage", async () => {
    const tampered = await archiveTemplateSource(uploadRequest((form) => {
      form.set("templateSourceSha256", "f".repeat(64));
    }), context);
    expect(tampered.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();

    const fakePdf = await archiveTemplateSource(uploadRequest((form) => {
      form.set("file", new File(["plain text"], "creator-agreement.pdf", {
        type: "application/pdf",
      }));
    }), context);
    expect(fakePdf.status).toBe(415);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("requires a same-origin browser upload and a signed-in account", async () => {
    const missingOrigin = await archiveTemplateSource(uploadRequest(undefined, null), context);
    expect(missingOrigin.status).toBe(403);

    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null }, error: new Error("expired") });
    const unsigned = await archiveTemplateSource(uploadRequest(), context);
    expect(unsigned.status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed, non-positive, unsafe, and oversized lengths before body parsing", async () => {
    for (const [length, expectedStatus] of [
      [null, 411],
      ["", 400],
      ["1.5", 400],
      ["-1", 400],
      ["0", 400],
      ["9007199254740992", 400],
      [String(4 * 1024 * 1024 + 256 * 1024 + 1), 413],
    ] as const) {
      const request = uploadRequest(undefined, origin, length);
      const response = await archiveTemplateSource(request, context);
      expect(response.status).toBe(expectedStatus);
      expect(request.formData).not.toHaveBeenCalled();
    }
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("proves active administrator access before multipart parsing", async () => {
    mocks.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { code: "42501" },
    }));
    const request = uploadRequest();
    const response = await archiveTemplateSource(request, context);

    expect(response.status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "authorize_admin_program_deal_template_source_upload",
      { target_deal_version_id: dealId },
    );
    expect(request.formData).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("retains the post-parse file-size check when Content-Length understates the body", async () => {
    const request = uploadRequest((form) => {
      form.set("file", new File(
        [Buffer.alloc(4 * 1024 * 1024 + 1)],
        "creator-agreement.pdf",
        { type: "application/pdf" },
      ));
    }, origin, "1024");
    const response = await archiveTemplateSource(request, context);

    expect(response.status).toBe(413);
    expect(request.formData).toHaveBeenCalledOnce();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes a staged object only after authoritative readback proves registration absent", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { code: "55000" } });
    mocks.rpc.mockImplementation(async (name: string) => name ===
      "get_admin_program_deal_template_source_artifact"
      ? { data: null, error: null }
      : { data: true, error: null });
    const response = await archiveTemplateSource(uploadRequest(), context);

    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(`^${dealId}/[0-9a-f-]{36}\\.pdf$`, "u")),
    ]);
  });

  it("retains staged bytes when readback returns a malformed non-null artifact", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "response lost" } });
    mocks.rpc.mockImplementation(async (name: string) => name ===
      "get_admin_program_deal_template_source_artifact"
      ? { data: { id: artifactId }, error: null }
      : { data: true, error: null });

    const response = await archiveTemplateSource(uploadRequest(), context);
    expect(response.status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/retained/i) });
  });

  it("removes the staged path when readback proves a different valid artifact won", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    mocks.rpc.mockImplementation(async (name: string) => name ===
      "get_admin_program_deal_template_source_artifact"
      ? { data: artifact(), error: null }
      : { data: true, error: null });

    const response = await archiveTemplateSource(uploadRequest(), context);
    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("keeps a staged object when both registration and readback outcomes are ambiguous", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    mocks.rpc.mockImplementation(async (name: string) => name ===
      "get_admin_program_deal_template_source_artifact"
      ? { data: null, error: { message: "readback unavailable" } }
      : { data: true, error: null });
    const response = await archiveTemplateSource(uploadRequest(), context);

    expect(response.status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/retained/i),
      reconciliationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
  });

  it("returns committed artifact evidence when registration response failed after commit", async () => {
    let committed: ReturnType<typeof artifact> | null = null;
    mocks.adminRpc.mockImplementationOnce(async (_name: string, args: Record<string, unknown>) => {
      committed = artifact({
        storagePath: args.storage_path_input,
        originalFilename: args.original_filename_input,
        contentType: args.content_type_input,
        byteSize: args.byte_size_input,
        sourceSha256: args.source_sha256_input,
      });
      return { data: null, error: { message: "response lost" } };
    });
    mocks.rpc.mockImplementation(async (name: string) => name ===
      "get_admin_program_deal_template_source_artifact"
      ? { data: committed, error: null }
      : { data: true, error: null });

    const response = await archiveTemplateSource(uploadRequest(), context);
    expect(response.status).toBe(201);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await response.json()).artifact).toMatchObject({ sourceSha256 });
  });

  it("refuses to download bytes whose size or SHA-256 no longer matches metadata", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: artifact(), error: null });
    mocks.download.mockResolvedValueOnce({
      data: new Blob(["%PDF-1.7\ncorrupted\n%%EOF"], { type: "application/pdf" }),
      error: null,
    });
    const request = new NextRequest(`${origin}/api/admin/deals/${dealId}/template-source`);
    const response = await downloadTemplateSource(request, context);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/no longer match/i) });
  });

  it("downloads only bytes that re-match immutable type, length, and SHA-256", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: artifact(), error: null });
    mocks.download.mockResolvedValueOnce({
      data: new Blob([pdfBytes], { type: "application/pdf" }),
      error: null,
    });
    const request = new NextRequest(`${origin}/api/admin/deals/${dealId}/template-source`);
    const response = await downloadTemplateSource(request, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("creator-agreement.pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
  });
});
