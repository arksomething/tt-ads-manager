import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getContentAdminOverview,
  normalizeContentAdminOverview,
  normalizeCreatorAssetDownload,
  normalizeCreatorContentLibrary,
} from "@/server/content/library";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const emptyAdminOverview = [{ overview: { scripts: [], assets: [], creators: [] } }];

describe("creator content result normalization", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normalizes a complete staff overview", () => {
    const overview = normalizeContentAdminOverview([{ overview: {
      scripts: [{
        id: "script-1",
        title: "Opening hook",
        summary: "Use on day one",
        body_markdown: "Start with the outcome.",
        status: "published",
        revision: 3,
        published_at: "2026-08-31T12:00:00.000Z",
        updated_at: "2026-08-31T12:00:00.000Z",
        assignments: [{ id: "assign-1", enrollment_id: "enroll-1", creator_name: "Ari", state: "viewed" }],
      }],
      assets: [{
        id: "asset-1",
        title: "Logo",
        description: "Primary brand mark",
        status: "draft",
        source_type: "upload",
        asset_kind: "brand",
        size_bytes: "1024",
        published_at: null,
        updated_at: "2026-08-31T12:00:00.000Z",
        revision: 1,
        assignments: [],
      }],
      creators: [{ enrollment_id: "enroll-1", name: "Ari", email: "ari@example.com", status: "active" }],
    } }]);

    expect(overview?.scripts).toHaveLength(1);
    expect(overview?.scripts[0]).toMatchObject({ title: "Opening hook", revision: 3 });
    expect(overview?.scripts[0].assignments[0]).toMatchObject({ creatorName: "Ari", enrollmentId: "enroll-1" });
    expect(overview?.assets[0]).toMatchObject({ title: "Logo", sizeBytes: 1024 });
    expect(overview?.creators[0].email).toBe("ari@example.com");
  });

  it("preserves a valid empty staff overview but rejects malformed results", () => {
    expect(normalizeContentAdminOverview(emptyAdminOverview)).toEqual({
      scripts: [],
      assets: [],
      creators: [],
    });
    expect(normalizeContentAdminOverview(null)).toBeNull();
    expect(normalizeContentAdminOverview([{ overview: {
      scripts: [{ id: "bad", status: "unknown" }],
      assets: [],
      creators: [],
    } }])).toBeNull();
    expect(normalizeContentAdminOverview([{ overview: {
      scripts: [],
      assets: [],
      creators: [{ enrollment_id: "missing-identity" }],
    } }])).toBeNull();
  });

  it("makes a malformed staff RPC payload unavailable instead of empty", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: emptyAdminOverview, error: null });

    await expect(getContentAdminOverview()).rejects.toThrow("invalid data");
    await expect(getContentAdminOverview()).resolves.toEqual({
      scripts: [],
      assets: [],
      creators: [],
    });
  });

  it("keeps only actionable creator assignments", () => {
    const library = normalizeCreatorContentLibrary([{ library: {
      scripts: [{ assignment_id: "sa-1", title: "Script", state: "assigned", revision: 2 }],
      assets: [{ assignment_id: "aa-1", asset_id: "a-1", title: "Asset", state: "viewed", source_type: "external_url" }],
    } }]);
    expect(library.scripts[0]).toMatchObject({ assignmentId: "sa-1", state: "assigned" });
    expect(library.assets[0]).toMatchObject({ assetId: "a-1", state: "viewed" });
  });

  it("accepts creator and staff download records without inventing access", () => {
    expect(normalizeCreatorAssetDownload([{
      source_type: "upload",
      storage_bucket: "creator-program-assets",
      storage_path: "staff/file.pdf",
      download_filename: "file.pdf",
      assignment_id: "assignment-1",
    }])).toMatchObject({ sourceType: "upload", assignmentId: "assignment-1" });
    expect(normalizeCreatorAssetDownload([{
      source_type: "external_url",
      external_url: "https://example.com/file",
      download_filename: "file",
      assignment_id: null,
    }])).toMatchObject({ sourceType: "external_url", assignmentId: null });
    expect(normalizeCreatorAssetDownload([{ source_type: "ftp" }])).toBeNull();
  });
});
