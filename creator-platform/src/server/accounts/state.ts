import { createClient } from "@/lib/supabase/server";

export type CreatorAccountState = {
  nextPath: string | null;
  profileState: string | null;
  applicationState: string | null;
  agreementState: string | null;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeCreatorAccountState(value: unknown): CreatorAccountState {
  const row = Array.isArray(value) ? value[0] : value;
  const record =
    row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : {};

  return {
    nextPath: stringValue(record.next_path ?? record.nextPath),
    profileState: stringValue(
      record.account_status ??
        record.accountStatus ??
        record.profile_state ??
        record.profileState,
    ),
    applicationState: stringValue(
      record.application_status ??
        record.applicationStatus ??
        record.application_state ??
        record.applicationState,
    ),
    agreementState: stringValue(
      record.agreement_status ??
        record.agreementStatus ??
        record.agreement_state ??
        record.agreementState,
    ),
  };
}

export async function getCreatorAccountState() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_creator_account_state");

  if (error) {
    throw new Error("Could not load the creator account state.", {
      cause: error,
    });
  }

  return normalizeCreatorAccountState(data);
}
