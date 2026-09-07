import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AdminDealTemplateSourceArtifact,
  maximumDealTemplateSourceBytes,
  normalizeAdminDealTemplateSourceArtifact,
} from "@/server/admin/deal-template-source";
import { archivedDealTemplateSourceBytesMatch } from "@/server/admin/deal-template-source-bytes";

type AdminClient = ReturnType<typeof createAdminClient>;

export class DealTemplateSourceIntegrityError extends Error {
  constructor(
    public readonly safeCode:
      | "artifact_not_found"
      | "artifact_identity_mismatch"
      | "artifact_unavailable"
      | "artifact_bytes_mismatch",
  ) {
    super(`Deal template source integrity check failed: ${safeCode}`);
  }
}

export type DealTemplateSourceIntegrityExpectation = {
  dealVersionId: string;
  sourceArtifactId?: string;
  snapshotHash: string;
  templateId?: string;
};

export type DealTemplateSourceMutationReceipt = {
  dealVersionId: string;
  sourceArtifactId: string;
  outcome: "verified" | "activated";
};

export function normalizeDealTemplateSourceMutationReceipt(
  value: unknown,
  expected: Omit<DealTemplateSourceMutationReceipt, "outcome">,
  outcome: DealTemplateSourceMutationReceipt["outcome"],
): DealTemplateSourceMutationReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expectedKeys = ["dealVersionId", "sourceArtifactId", outcome] as const;
  const keys = Object.keys(record);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key as (typeof expectedKeys)[number])) ||
    record.dealVersionId !== expected.dealVersionId ||
    record.sourceArtifactId !== expected.sourceArtifactId ||
    record[outcome] !== true
  ) return null;
  return { ...expected, outcome };
}

/**
 * Loads source metadata only through the service-role RPC, downloads the
 * private object, and revalidates exact identity, length, structural format,
 * and SHA-256. The archive is application-immutable and tamper-evident, not a
 * claim of storage-level WORM behavior.
 */
export async function assertDealTemplateSourceIntegrity(
  expectation: DealTemplateSourceIntegrityExpectation,
  admin: AdminClient = createAdminClient(),
): Promise<AdminDealTemplateSourceArtifact> {
  const loaded = await admin.rpc("get_server_program_deal_template_source_artifact", {
    target_deal_version_id: expectation.dealVersionId,
    source_artifact_id_input: expectation.sourceArtifactId ?? null,
  });
  if (loaded.error) {
    throw new DealTemplateSourceIntegrityError("artifact_unavailable");
  }
  if (loaded.data === null) {
    throw new DealTemplateSourceIntegrityError("artifact_not_found");
  }

  const artifact = normalizeAdminDealTemplateSourceArtifact(loaded.data);
  if (
    !artifact || artifact.dealVersionId !== expectation.dealVersionId ||
    artifact.snapshotHash !== expectation.snapshotHash ||
    (expectation.templateId !== undefined && artifact.templateId !== expectation.templateId) ||
    (expectation.sourceArtifactId !== undefined && artifact.id !== expectation.sourceArtifactId)
  ) {
    throw new DealTemplateSourceIntegrityError("artifact_identity_mismatch");
  }

  const downloaded = await admin.storage
    .from(artifact.storageBucket)
    .download(artifact.storagePath);
  if (downloaded.error || !downloaded.data) {
    throw new DealTemplateSourceIntegrityError("artifact_unavailable");
  }
  if (
    downloaded.data.size !== artifact.byteSize ||
    downloaded.data.size < 1 ||
    downloaded.data.size > maximumDealTemplateSourceBytes
  ) {
    throw new DealTemplateSourceIntegrityError("artifact_bytes_mismatch");
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await downloaded.data.arrayBuffer());
  } catch {
    throw new DealTemplateSourceIntegrityError("artifact_unavailable");
  }
  if (!await archivedDealTemplateSourceBytesMatch(artifact, bytes)) {
    throw new DealTemplateSourceIntegrityError("artifact_bytes_mismatch");
  }
  return artifact;
}

export function dealTemplateSourceIntegrityHttpStatus(error: unknown) {
  return error instanceof DealTemplateSourceIntegrityError &&
    error.safeCode === "artifact_unavailable"
    ? 503
    : 409;
}
