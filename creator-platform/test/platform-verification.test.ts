import { describe, expect, it } from "vitest";

import {
  normalizeCreatorPlatformSetup,
  normalizeCreatorPlatformVerificationQueue,
} from "@/server/accounts/platform-verification";
import {
  parsePlatformClaimId,
  parsePlatformClaimReview,
} from "@/server/accounts/platform-verification-form";

const claimId = "92d0f7e2-3f8f-4ce5-a1af-d93b7b84d011";

describe("platform verification data", () => {
  it("normalizes only complete creator-safe claim rows", () => {
    expect(normalizeCreatorPlatformSetup([
      {
        claim_id: claimId,
        platform: "TIKTOK",
        entered_handle: "@creator",
        claim_status: "checking",
        bio_code: "GT-ABCDEF12",
        code_expires_at: "2026-09-07T12:00:00.000Z",
        last_check_requested_at: "2026-08-31T12:00:00.000Z",
        verification_job_state: "queued",
      },
      { claim_id: "missing-fields" },
    ])).toEqual([
      expect.objectContaining({
        id: claimId,
        platform: "TIKTOK",
        handle: "@creator",
        status: "checking",
        bioCode: "GT-ABCDEF12",
        jobState: "queued",
      }),
    ]);
  });

  it("requires creator identity before exposing a staff queue row", () => {
    const base = {
      claim_id: claimId,
      platform: "INSTAGRAM_REELS",
      entered_handle: "creator.ig",
      claim_status: "pending_code",
      bio_code: "GT-1234ABCD",
      code_expires_at: "2026-09-07T12:00:00.000Z",
    };
    expect(normalizeCreatorPlatformVerificationQueue([
      { ...base, creator_name: "Casey", creator_email: "casey@example.com" },
      base,
    ])).toHaveLength(1);
  });
});

describe("platform verification forms", () => {
  it("accepts UUID claim identifiers", () => {
    const form = new FormData();
    form.set("claimId", claimId);
    expect(parsePlatformClaimId(form)).toBe(claimId);
    form.set("claimId", "not-a-uuid");
    expect(parsePlatformClaimId(form)).toBeNull();
  });

  it("requires stable identity evidence for approval", () => {
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("decision", "approve");
    expect(parsePlatformClaimReview(form)).toEqual({
      ok: false,
      error: "Enter the stable platform account ID.",
    });

    form.set("nativeAccountId", "native-123");
    form.set("evidenceReference", "https://tiktok.com/@creator");
    expect(parsePlatformClaimReview(form)).toEqual({
      ok: true,
      value: {
        claimId,
        decision: "approve",
        nativeAccountId: "native-123",
        evidenceReference: "https://tiktok.com/@creator",
        note: "",
      },
    });
  });

  it("requires a creator-facing correction note on rejection", () => {
    const form = new FormData();
    form.set("claimId", claimId);
    form.set("decision", "reject");
    expect(parsePlatformClaimReview(form)).toEqual({
      ok: false,
      error: "Tell the creator what needs attention.",
    });
  });
});
