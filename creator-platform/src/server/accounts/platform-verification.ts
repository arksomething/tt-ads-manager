import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export type CreatorPlatformClaimStatus =
  | "pending_code"
  | "checking"
  | "needs_attention"
  | "verified"
  | "revoked";

export type CreatorPlatformSetupClaim = {
  id: string;
  platform: "TIKTOK" | "INSTAGRAM_REELS";
  handle: string;
  status: CreatorPlatformClaimStatus;
  bioCode: string;
  codeExpiresAt: string;
  codeExpired: boolean;
  lastCheckRequestedAt: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  creatorMessage: string | null;
  nativeAccountId: string | null;
  verifiedAt: string | null;
  jobState: string | null;
};

export type CreatorPlatformVerificationQueueItem = CreatorPlatformSetupClaim & {
  creatorName: string;
  creatorEmail: string;
};

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function claimStatus(value: unknown): CreatorPlatformClaimStatus | null {
  const candidate = stringValue(value);
  return candidate === "pending_code"
    || candidate === "checking"
    || candidate === "needs_attention"
    || candidate === "verified"
    || candidate === "revoked"
    ? candidate
    : null;
}

function platformValue(value: unknown): CreatorPlatformSetupClaim["platform"] | null {
  const candidate = stringValue(value);
  return candidate === "TIKTOK" || candidate === "INSTAGRAM_REELS"
    ? candidate
    : null;
}

function normalizeClaim(value: unknown): CreatorPlatformSetupClaim | null {
  const record = recordValue(value);
  const id = stringValue(record?.claim_id ?? record?.claimId ?? record?.id);
  const platform = platformValue(record?.platform);
  const handle = stringValue(record?.entered_handle ?? record?.enteredHandle ?? record?.handle);
  const status = claimStatus(record?.claim_status ?? record?.claimStatus ?? record?.status);
  const bioCode = stringValue(record?.bio_code ?? record?.bioCode);
  const codeExpiresAt = timestampValue(record?.code_expires_at ?? record?.codeExpiresAt);

  if (!id || !platform || !handle || !status || !bioCode || !codeExpiresAt) {
    return null;
  }

  return {
    id,
    platform,
    handle,
    status,
    bioCode,
    codeExpiresAt,
    codeExpired: record?.code_expired === true || record?.codeExpired === true,
    lastCheckRequestedAt: timestampValue(
      record?.last_check_requested_at ?? record?.lastCheckRequestedAt,
    ),
    lastCheckedAt: timestampValue(record?.last_checked_at ?? record?.lastCheckedAt),
    lastErrorCode: stringValue(record?.last_error_code ?? record?.lastErrorCode),
    creatorMessage: stringValue(record?.creator_message ?? record?.creatorMessage),
    nativeAccountId: stringValue(record?.native_account_id ?? record?.nativeAccountId),
    verifiedAt: timestampValue(
      record?.ownership_verified_at ?? record?.ownershipVerifiedAt ?? record?.verifiedAt,
    ),
    jobState: stringValue(
      record?.verification_job_state ?? record?.verificationJobState ?? record?.jobState,
    ),
  };
}

export function normalizeCreatorPlatformSetup(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const claim = normalizeClaim(candidate);
    return claim ? [claim] : [];
  });
}

export function normalizeCreatorPlatformVerificationQueue(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate): CreatorPlatformVerificationQueueItem[] => {
    const claim = normalizeClaim(candidate);
    const record = recordValue(candidate);
    const creatorName = stringValue(record?.creator_name ?? record?.creatorName);
    const creatorEmail = stringValue(record?.creator_email ?? record?.creatorEmail);
    return claim && creatorName && creatorEmail
      ? [{ ...claim, creatorName, creatorEmail }]
      : [];
  });
}

export async function getOwnCreatorPlatformSetup() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_creator_platform_setup");
  if (error) {
    throw new Error("Could not load campaign-account verification.", { cause: error });
  }
  return normalizeCreatorPlatformSetup(data);
}

export async function getCreatorPlatformVerificationQueue() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_creator_platform_verification_queue");
  if (error) {
    throw new Error("Could not load the campaign-account review queue.", { cause: error });
  }
  return normalizeCreatorPlatformVerificationQueue(data);
}
