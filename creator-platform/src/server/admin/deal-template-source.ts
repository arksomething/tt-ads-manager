import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export const dealTemplateSourceBucket = "creator-deal-template-sources";
// Keep the complete multipart request and verified download below Vercel's
// 4.5 MB Function request/response ceiling.
export const maximumDealTemplateSourceBytes = 4 * 1024 * 1024;

export type AdminDealTemplateSourceArtifact = {
  id: string;
  dealVersionId: string;
  provider: "signwell";
  environment: "production";
  templateId: string;
  snapshotHash: string;
  sourceSha256: string;
  storageBucket: typeof dealTemplateSourceBucket;
  storagePath: string;
  originalFilename: string;
  contentType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  byteSize: number;
  uploadedBy: string;
  createdAt: string;
};

export type AdminDealArchivedBindingInput = {
  sourceArtifactId: string;
  snapshotHash: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[a-f0-9]{64}$/u;
const acceptedContentTypes = new Set<AdminDealTemplateSourceArtifact["contentType"]>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const artifactKeys = [
  "id",
  "dealVersionId",
  "provider",
  "environment",
  "templateId",
  "snapshotHash",
  "sourceSha256",
  "storageBucket",
  "storagePath",
  "originalFilename",
  "contentType",
  "byteSize",
  "uploadedBy",
  "createdAt",
] as const;

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function exactKeys(record: UnknownRecord) {
  const keys = Object.keys(record);
  return keys.length === artifactKeys.length && keys.every((key) => (
    artifactKeys.includes(key as (typeof artifactKeys)[number])
  ));
}

function onlyExactKeys(record: UnknownRecord, keys: readonly string[]) {
  const received = Object.keys(record);
  return received.length === keys.length && received.every((key) => keys.includes(key));
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : null;
}

export function normalizeAdminDealTemplateSourceArtifact(
  value: unknown,
): AdminDealTemplateSourceArtifact | null {
  const record = recordValue(value);
  if (!record || !exactKeys(record)) return null;

  const id = typeof record.id === "string" ? record.id : "";
  const dealVersionId = typeof record.dealVersionId === "string" ? record.dealVersionId : "";
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  const snapshotHash = typeof record.snapshotHash === "string" ? record.snapshotHash : "";
  const sourceSha256 = typeof record.sourceSha256 === "string" ? record.sourceSha256 : "";
  const storagePath = typeof record.storagePath === "string" ? record.storagePath : "";
  const originalFilename = typeof record.originalFilename === "string"
    ? record.originalFilename
    : "";
  const uploadedBy = typeof record.uploadedBy === "string" ? record.uploadedBy : "";
  const createdAt = timestamp(record.createdAt);
  const byteSize = typeof record.byteSize === "number" && Number.isSafeInteger(record.byteSize)
    ? record.byteSize
    : null;
  const contentType = acceptedContentTypes.has(
    record.contentType as AdminDealTemplateSourceArtifact["contentType"],
  ) ? record.contentType as AdminDealTemplateSourceArtifact["contentType"] : null;

  if (
    !uuidPattern.test(id) || !uuidPattern.test(dealVersionId) ||
    !uuidPattern.test(templateId) || !hashPattern.test(snapshotHash) ||
    !hashPattern.test(sourceSha256) || record.provider !== "signwell" ||
    record.environment !== "production" || record.storageBucket !== dealTemplateSourceBucket ||
    !storagePath.startsWith(`${dealVersionId}/`) || storagePath.includes("..") ||
    storagePath.includes("\\") || originalFilename.length < 1 || originalFilename.length > 200 ||
    originalFilename.includes("/") || originalFilename.includes("\\") || !contentType ||
    byteSize === null || byteSize < 1 || byteSize > maximumDealTemplateSourceBytes ||
    !uuidPattern.test(uploadedBy) || !createdAt
  ) return null;

  const expectedExtension = contentType === "application/pdf" ? ".pdf" : ".docx";
  if (
    !originalFilename.toLowerCase().endsWith(expectedExtension) ||
    !storagePath.toLowerCase().endsWith(expectedExtension)
  ) return null;

  return {
    id,
    dealVersionId,
    provider: "signwell",
    environment: "production",
    templateId,
    snapshotHash,
    sourceSha256,
    storageBucket: dealTemplateSourceBucket,
    storagePath,
    originalFilename,
    contentType,
    byteSize,
    uploadedBy,
    createdAt,
  };
}

export function parseAdminDealArchivedBindingInput(
  value: unknown,
): AdminDealArchivedBindingInput | null {
  const record = recordValue(value);
  if (!record || !onlyExactKeys(record, ["sourceArtifactId", "snapshotHash"])) return null;
  const sourceArtifactId = typeof record.sourceArtifactId === "string"
    ? record.sourceArtifactId.trim()
    : "";
  const snapshotHash = typeof record.snapshotHash === "string" ? record.snapshotHash.trim() : "";
  return uuidPattern.test(sourceArtifactId) && hashPattern.test(snapshotHash)
    ? { sourceArtifactId, snapshotHash }
    : null;
}

export function parseAdminDealArchivedBindingVerificationInput(
  value: unknown,
  requiredAttestation: string,
): (AdminDealArchivedBindingInput & { attestation: string }) | null {
  const record = recordValue(value);
  if (!record || !onlyExactKeys(record, [
    "sourceArtifactId",
    "snapshotHash",
    "attestation",
  ])) return null;
  const binding = parseAdminDealArchivedBindingInput({
    sourceArtifactId: record.sourceArtifactId,
    snapshotHash: record.snapshotHash,
  });
  return binding && record.attestation === requiredAttestation
    ? { ...binding, attestation: requiredAttestation }
    : null;
}

export async function getAdminDealTemplateSourceArtifact(
  dealVersionId: string,
): Promise<AdminDealTemplateSourceArtifact | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_admin_program_deal_template_source_artifact",
    { target_deal_version_id: dealVersionId },
  );
  if (error) throw new Error("Could not load the archived template source.", { cause: error });
  if (data === null) return null;
  const artifact = normalizeAdminDealTemplateSourceArtifact(data);
  if (!artifact) throw new Error("The archived template source response was incomplete.");
  return artifact;
}
