export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PlatformClaimReviewInput = {
  claimId: string;
  decision: "approve" | "reject";
  nativeAccountId: string;
  evidenceReference: string;
  note: string;
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function parsePlatformClaimId(formData: FormData) {
  const claimId = formString(formData, "claimId");
  return UUID_PATTERN.test(claimId) ? claimId : null;
}

export function parsePlatformClaimReview(formData: FormData):
  | { ok: true; value: PlatformClaimReviewInput }
  | { ok: false; error: string } {
  const claimId = formString(formData, "claimId");
  const decision = formString(formData, "decision");
  const nativeAccountId = formString(formData, "nativeAccountId");
  const evidenceReference = formString(formData, "evidenceReference");
  const note = formString(formData, "note");

  if (!UUID_PATTERN.test(claimId)) {
    return { ok: false, error: "Choose a valid campaign account." };
  }

  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "Choose approve or needs attention." };
  }

  if (decision === "approve") {
    if (nativeAccountId.length < 1 || nativeAccountId.length > 191) {
      return { ok: false, error: "Enter the stable platform account ID." };
    }
    if (evidenceReference.length < 8 || evidenceReference.length > 2_000) {
      return { ok: false, error: "Record the profile or evidence used for verification." };
    }
  }

  if (decision === "reject" && note.length < 3) {
    return { ok: false, error: "Tell the creator what needs attention." };
  }

  return {
    ok: true,
    value: {
      claimId,
      decision,
      nativeAccountId,
      evidenceReference,
      note: note.slice(0, 500),
    },
  };
}
