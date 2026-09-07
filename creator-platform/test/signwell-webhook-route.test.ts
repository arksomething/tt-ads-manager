import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  getArtifact: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
  }),
}));

vi.mock("@/lib/agreements/signwell", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/agreements/signwell")>(),
  verifySignWellWebhook: () => ({
    externalEventId: "e".repeat(64),
    eventType: "document_completed",
    eventTimestamp: "2026-08-31T12:00:00.000Z",
    documentId: "c4e4dbd4-4594-43b3-87b0-0b62b10b656b",
    payloadSha256: "a".repeat(64),
  }),
  getSignWellCompletedArtifact: mocks.getArtifact,
}));

import { POST } from "@/app/api/integrations/signwell/webhook/route";

function request() {
  return new NextRequest("https://gotall-creator-platform.vercel.app/api/integrations/signwell/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: {}, data: {} }),
  });
}

describe("SignWell webhook artifact boundary", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.upload.mockReset();
    mocks.getArtifact.mockReset();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getArtifact.mockResolvedValue({
      bytes: Buffer.from("%PDF-completed"),
      sha256: "b".repeat(64),
    });
  });

  it("retains an unknown provider event without downloading an unrelated document", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "pending", error: null });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.getArtifact).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("acknowledges an already-processed event without refetching its artifact", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "duplicate", error: null });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: "duplicate" });
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });

  it("downloads and archives only after the database recognizes an unfinished agreement", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: "artifact_required", error: null })
      .mockResolvedValueOnce({ data: "processed", error: null });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.getArtifact).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^signwell\/.+\/[a-f0-9]{64}\.pdf$/u),
      expect.any(Buffer),
      expect.objectContaining({ contentType: "application/pdf" }),
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
