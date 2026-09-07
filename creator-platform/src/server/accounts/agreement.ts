import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type CreatorAgreementContext = {
  id: string;
  enrollmentId: string;
  dealVersionId: string;
  provider: string;
  providerEnvironment: string | null;
  externalAgreementId: string | null;
  status: string;
  signerName: string;
  signerEmail: string;
  providerTemplateId: string | null;
  dealSnapshotSha256: string | null;
  verifiedProviderTemplateId: string | null;
  verifiedDealSnapshotSha256: string | null;
  provisioningStartedAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
};

export const AGREEMENT_PROVISIONING_LEASE_MS = 10 * 60 * 1_000;

export type CreatorAssignedDealVersion = {
  id: string;
  dealKey: string;
  version: number;
  label: string;
  termsMarkdown: string;
  termsSha256: string;
  effectiveAt: string | null;
};

export type AgreementProvisioningLease = {
  agreementId: string;
  provisioningToken: string;
  enrollmentId: string;
  dealVersionId: string;
  dealSnapshotSha256: string;
  providerTemplateId: string;
  signerName: string;
  signerEmail: string;
  externalAgreementId: string | null;
};

function recordValue(value: unknown): UnknownRecord | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as UnknownRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

export function normalizeCreatorAgreementContext(value: unknown): CreatorAgreementContext | null {
  const record = recordValue(value);
  const id = stringValue(record?.agreement_id ?? record?.agreementId);
  const enrollmentId = stringValue(record?.enrollment_id ?? record?.enrollmentId);
  const dealVersionId = stringValue(record?.deal_version_id ?? record?.dealVersionId);
  const provider = stringValue(record?.provider);
  const status = stringValue(record?.agreement_status ?? record?.agreementStatus ?? record?.status);
  const signerName = stringValue(record?.signer_name ?? record?.signerName);
  const signerEmail = stringValue(record?.signer_email ?? record?.signerEmail);
  const dealSnapshotSha256 = stringValue(
    record?.deal_snapshot_sha256 ?? record?.dealSnapshotSha256,
  );
  const verifiedDealSnapshotSha256 = stringValue(
    record?.verified_deal_snapshot_sha256 ?? record?.verifiedDealSnapshotSha256,
  );
  if (
    (dealSnapshotSha256 && !SHA256_PATTERN.test(dealSnapshotSha256))
    || (verifiedDealSnapshotSha256 && !SHA256_PATTERN.test(verifiedDealSnapshotSha256))
  ) return null;
  if (!id || !enrollmentId || !dealVersionId || !provider || !status || !signerName || !signerEmail) return null;
  return {
    id,
    enrollmentId,
    dealVersionId,
    provider,
    providerEnvironment: stringValue(record?.provider_environment ?? record?.providerEnvironment),
    externalAgreementId: stringValue(record?.external_agreement_id ?? record?.externalAgreementId),
    status,
    signerName,
    signerEmail,
    providerTemplateId: stringValue(
      record?.provider_template_id ?? record?.providerTemplateId,
    ),
    dealSnapshotSha256,
    verifiedProviderTemplateId: stringValue(
      record?.verified_provider_template_id ?? record?.verifiedProviderTemplateId,
    ),
    verifiedDealSnapshotSha256,
    provisioningStartedAt: stringValue(
      record?.provisioning_started_at ?? record?.provisioningStartedAt,
    ),
    sentAt: stringValue(record?.sent_at ?? record?.sentAt),
    completedAt: stringValue(record?.completed_at ?? record?.completedAt),
  };
}

export function isAgreementProvisioningLeaseExpired(
  provisioningStartedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!provisioningStartedAt) return false;
  const startedAt = Date.parse(provisioningStartedAt);
  return Number.isFinite(startedAt)
    && startedAt <= now - AGREEMENT_PROVISIONING_LEASE_MS;
}

export function normalizeAgreementProvisioningLease(value: unknown): AgreementProvisioningLease | null {
  const record = recordValue(value);
  const agreementId = stringValue(record?.agreement_id ?? record?.agreementId);
  const provisioningToken = stringValue(record?.provisioning_token ?? record?.provisioningToken);
  const enrollmentId = stringValue(record?.enrollment_id ?? record?.enrollmentId);
  const dealVersionId = stringValue(record?.deal_version_id ?? record?.dealVersionId);
  const dealSnapshotSha256 = stringValue(
    record?.deal_snapshot_sha256 ?? record?.dealSnapshotSha256,
  );
  const providerTemplateId = stringValue(
    record?.provider_template_id ?? record?.providerTemplateId,
  );
  const signerName = stringValue(record?.signer_name ?? record?.signerName);
  const signerEmail = stringValue(record?.signer_email ?? record?.signerEmail);
  return agreementId
    && provisioningToken
    && enrollmentId
    && dealVersionId
    && dealSnapshotSha256
    && SHA256_PATTERN.test(dealSnapshotSha256)
    && providerTemplateId
    && signerName
    && signerEmail
    ? {
        agreementId,
        provisioningToken,
        enrollmentId,
        dealVersionId,
        dealSnapshotSha256,
        providerTemplateId,
        signerName,
        signerEmail,
        externalAgreementId: stringValue(
          record?.external_agreement_id ?? record?.externalAgreementId,
        ),
      }
    : null;
}

export function normalizeCreatorAssignedDealVersion(value: unknown): CreatorAssignedDealVersion | null {
  const record = recordValue(value);
  const id = stringValue(record?.id);
  const dealKey = stringValue(record?.deal_key ?? record?.dealKey);
  const version = positiveInteger(record?.version);
  const label = stringValue(record?.label);
  const termsMarkdown = stringValue(record?.terms_markdown ?? record?.termsMarkdown);
  const termsSha256 = stringValue(record?.terms_sha256 ?? record?.termsSha256);

  if (
    !id ||
    !dealKey ||
    !version ||
    !label ||
    !termsMarkdown ||
    !termsSha256 ||
    !/^[a-f0-9]{64}$/u.test(termsSha256)
  ) {
    return null;
  }

  return {
    id,
    dealKey,
    version,
    label,
    termsMarkdown,
    termsSha256,
    effectiveAt: stringValue(record?.effective_at ?? record?.effectiveAt),
  };
}

export async function getOwnAgreementSigningContext() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_agreement_signing_context");
  if (error) throw new Error("Could not load the assigned agreement.", { cause: error });
  return normalizeCreatorAgreementContext(data);
}

export async function getOwnAssignedDealVersion(dealVersionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("program_deal_versions")
    .select("id,deal_key,version,label,terms_markdown,terms_sha256,effective_at")
    .eq("id", dealVersionId)
    .maybeSingle();

  if (error) throw new Error("Could not load the assigned deal version.", { cause: error });
  return normalizeCreatorAssignedDealVersion(data);
}
