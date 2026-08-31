import type { CreatorApplicationPlatform } from "@/lib/creator-application";
import { createClient } from "@/lib/supabase/server";

export type SubmittedCreatorAccount = {
  platform: CreatorApplicationPlatform;
  handle: string;
};

export type CreatorApplicationSnapshot = {
  id: string;
  name: string;
  phoneNumber: string;
  discordUsername: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  accounts: SubmittedCreatorAccount[];
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function creatorAccountsValue(value: unknown): SubmittedCreatorAccount[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    const record = recordValue(candidate);
    const platform = stringValue(record?.platform);
    const handle = stringValue(record?.handle);

    if (
      (platform !== "TIKTOK" && platform !== "INSTAGRAM_REELS") ||
      !handle
    ) {
      return [];
    }

    return [{ platform, handle }];
  });
}

export function normalizeCreatorApplicationSnapshot(
  value: unknown,
): CreatorApplicationSnapshot | null {
  const row = Array.isArray(value) ? value[0] : value;
  const record = recordValue(row);
  if (!record) return null;

  const id = stringValue(record.application_id ?? record.applicationId ?? record.id);
  const name = stringValue(record.applicant_name ?? record.applicantName ?? record.name);
  const phoneNumber = stringValue(
    record.phone_e164 ?? record.phoneE164 ?? record.phone_number ?? record.phoneNumber,
  );
  const discordUsername = stringValue(
    record.discord_username ?? record.discordUsername,
  );
  const status = stringValue(
    record.application_status ?? record.applicationStatus ?? record.status,
  );
  const submittedAt = stringValue(record.submitted_at ?? record.submittedAt);

  if (!id || !name || !phoneNumber || !discordUsername || !status || !submittedAt) {
    return null;
  }

  return {
    id,
    name,
    phoneNumber,
    discordUsername,
    status,
    submittedAt,
    reviewedAt: stringValue(record.reviewed_at ?? record.reviewedAt),
    accounts: creatorAccountsValue(
      record.creator_accounts ?? record.creatorAccounts ?? record.accounts,
    ),
  };
}

export async function getOwnCreatorApplication() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_creator_application");

  if (error) {
    throw new Error("Could not load the creator application.", {
      cause: error,
    });
  }

  return normalizeCreatorApplicationSnapshot(data);
}
