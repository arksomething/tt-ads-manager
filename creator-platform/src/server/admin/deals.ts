import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export const adminDealStatuses = ["draft", "sealed", "active", "retired"] as const;
export type AdminDealStatus = (typeof adminDealStatuses)[number];

export const paidImpressionsPolicies = [
  "include",
  "exclude_verified",
  "exclude_all",
] as const;
export type AdminDealPaidImpressionsPolicy =
  (typeof paidImpressionsPolicies)[number];

export const invalidTrafficPolicies = ["exclude_verified", "exclude_all"] as const;
export type AdminDealInvalidTrafficPolicy =
  (typeof invalidTrafficPolicies)[number];

export const crossPostPolicies = [
  "separate_eligible_post",
  "single_deliverable",
  "campaign_brief",
] as const;
export type AdminDealCrossPostPolicy = (typeof crossPostPolicies)[number];

export type AdminDealEconomicsTier = {
  rateMicrosPerThousand: number | null;
  perPostCapMicros: number | null;
  qualification: string | null;
};

export type AdminDealEconomics = {
  schemaVersion: 1;
  currency: string | null;
  currencyExponent: number | null;
  measurementWindowSeconds: number | null;
  measurementWindowAnchor: "published_at" | null;
  paidImpressionsPolicy: AdminDealPaidImpressionsPolicy | null;
  invalidTrafficPolicy: AdminDealInvalidTrafficPolicy | null;
  fixedFeeMicros: number | null;
  creatorAggregateCapMicros: number | null;
  minimumQualifiedViews: number | null;
  crossPostPolicy: AdminDealCrossPostPolicy | null;
  paymentDueDays: number | null;
  minimumPayoutMicros: number | null;
  tiers: {
    baseline: AdminDealEconomicsTier;
    talking: AdminDealEconomicsTier;
  };
};

export type AdminDealVersion = {
  id: string;
  dealKey: string;
  version: number;
  label: string;
  status: AdminDealStatus;
  isDefault: boolean;
  draftRevision: number;
  termsHash: string;
  economicsHash: string | null;
  snapshotHash: string;
  providerTemplateHash: string | null;
  assignmentCount: number;
  providerBindingCount: number;
  approvalCount: number;
  businessApprovalCount: number;
  legalApprovalCount: number;
  readinessBlockerCount: number;
  activationReady: boolean;
  readinessBlockers: string[];
  createdAt: string;
  updatedAt: string;
  effectiveAt: string | null;
  sealedAt: string | null;
};

export type AdminDealProviderBinding = {
  id: string;
  sourceArtifactId: string | null;
  provider: "signwell";
  environment: string;
  templateId: string;
  templateHash: string;
  boundSnapshotHash: string;
  status: "pending" | "verified" | "disabled";
  configuredBy: string;
  verifiedBy: string | null;
  verificationMethod: "manual_admin_attestation" | null;
  verifiedAt: string | null;
  updatedAt: string;
};

export type AdminDealApproval = {
  id: string;
  kind: "business" | "legal";
  status: "approved" | "revoked";
  snapshotHash: string;
  approvedBy: string;
  note: string | null;
  approvedAt: string;
  revokedBy: string | null;
  revocationNote: string | null;
  revokedAt: string | null;
};

export type AdminDealAuditMetadata = {
  changedFields: string[];
  changeNote: string | null;
  snapshotHash: string | null;
  approvalKind: "business" | "legal" | null;
  approvalNote: string | null;
  originalApprover: string | null;
  revocationNote: string | null;
  newAssignmentsBlocked: boolean | null;
  provider: "signwell" | null;
  environment: "production" | null;
  templateId: string | null;
  sourceArtifactId: string | null;
  templateSourceSha256: string | null;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  verificationState: "pending_manual_attestation" | null;
  verificationMethod: "manual_admin_attestation" | null;
  attestationText: string | null;
  integrityCheckedAt: string | null;
  integrityMethod: "server_private_storage_download_size_structure_sha256" | null;
  replacementDealVersionId: string | null;
  replacementSnapshotHash: string | null;
  previousDefaultDealVersionId: string | null;
  activationConfirmation: string | null;
  readinessRecomputedUnderLock: boolean | null;
};

export type AdminDealAuditEvent = {
  id: number;
  type:
    | "draft_created"
    | "draft_updated"
    | "draft_sealed"
    | "snapshot_approval_recorded"
    | "snapshot_approval_revoked"
    | "signwell_template_source_archived"
    | "signwell_binding_recorded"
    | "signwell_binding_verified"
    | "default_replaced_and_retired"
    | "default_activated";
  actorUserId: string;
  draftRevision: number;
  fromStatus: AdminDealStatus | null;
  toStatus: AdminDealStatus | null;
  metadata: AdminDealAuditMetadata;
  createdAt: string;
};

export type AdminDealDetail = AdminDealVersion & {
  termsMarkdown: string;
  economics: AdminDealEconomics | null;
  changeNote: string | null;
  providerBindings: AdminDealProviderBinding[];
  approvals: AdminDealApproval[];
  auditEvents: AdminDealAuditEvent[];
};

export type AdminDealCatalog = {
  defaultVersion: AdminDealVersion | null;
  versions: AdminDealVersion[];
};

export type AdminDealCreateInput = {
  dealKey: string;
  label: string;
  termsMarkdown: string;
  economics: AdminDealEconomics;
  changeNote: string | null;
};

export type AdminDealUpdateInput = {
  revision: number;
  patch: {
    label?: string;
    termsMarkdown?: string;
    economics?: AdminDealEconomics;
    changeNote?: string | null;
  };
};

export type AdminDealSealInput = {
  revision: number;
  changeNote: string | null;
};

export const signWellBindingVerificationAttestation =
  "I verified this exact SignWell production template source against this sealed deal snapshot.";

export const adminDealActivationConfirmation =
  "ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT";

export type AdminDealApprovalInput = {
  kind: "business" | "legal";
  snapshotHash: string;
  note: string | null;
};

export type AdminDealApprovalRevocationInput = {
  kind: "business" | "legal";
  snapshotHash: string;
  reason: string;
};

export type AdminDealSignWellBindingInput = {
  templateId: string;
  templateSourceSha256: string;
  snapshotHash: string;
};

export type AdminDealSignWellVerificationInput = AdminDealSignWellBindingInput & {
  attestation: typeof signWellBindingVerificationAttestation;
};

export type AdminDealActivationInput = {
  snapshotHash: string;
  confirmation: typeof adminDealActivationConfirmation;
};

const hashPattern = /^[a-f0-9]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const dealKeyPattern = /^[a-z0-9][a-z0-9_-]{1,79}$/u;
const maximumSafeMicros = Number.MAX_SAFE_INTEGER;

const economicsKeys = [
  "schemaVersion",
  "currency",
  "currencyExponent",
  "measurementWindowSeconds",
  "measurementWindowAnchor",
  "paidImpressionsPolicy",
  "invalidTrafficPolicy",
  "fixedFeeMicros",
  "creatorAggregateCapMicros",
  "minimumQualifiedViews",
  "crossPostPolicy",
  "paymentDueDays",
  "minimumPayoutMicros",
  "tiers",
] as const;
const tierKeys = ["rateMicrosPerThousand", "perPostCapMicros", "qualification"] as const;

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function exactKeys(record: UnknownRecord, keys: readonly string[]) {
  const received = Object.keys(record);
  return received.length === keys.length && received.every((key) => keys.includes(key));
}

function onlyKeys(record: UnknownRecord, keys: readonly string[]) {
  return Object.keys(record).every((key) => keys.includes(key));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown, maximum: number): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= maximum ? normalized : undefined;
}

function safeInteger(value: unknown, maximum = maximumSafeMicros) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function nullableInteger(
  value: unknown,
  maximum = maximumSafeMicros,
): number | null | undefined {
  if (value === null) return null;
  const parsed = safeInteger(value, maximum);
  return parsed === null ? undefined : parsed;
}

function positiveInteger(value: unknown) {
  const parsed = safeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timestampValue(value: unknown): string | null {
  const candidate = stringValue(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function statusValue(value: unknown): AdminDealStatus | null {
  const candidate = stringValue(value);
  return adminDealStatuses.find((status) => status === candidate) ?? null;
}

function hashValue(value: unknown): string | null {
  const candidate = stringValue(value);
  return candidate && hashPattern.test(candidate) ? candidate : null;
}

function requiredNullableString(
  record: UnknownRecord,
  key: string,
  values?: readonly string[],
): string | null | undefined {
  if (!(key in record)) return undefined;
  if (record[key] === null) return null;
  const candidate = stringValue(record[key]);
  if (!candidate || (values && !values.includes(candidate))) return undefined;
  return candidate;
}

function normalizeEconomicsTier(value: unknown): AdminDealEconomicsTier | null {
  const record = recordValue(value);
  if (!record || !exactKeys(record, tierKeys)) return null;

  const rateMicrosPerThousand = nullableInteger(record.rateMicrosPerThousand);
  const perPostCapMicros = nullableInteger(record.perPostCapMicros);
  const qualification = nullableText(record.qualification, 2_000);
  if (
    rateMicrosPerThousand === undefined ||
    perPostCapMicros === undefined ||
    qualification === undefined
  ) return null;

  return { rateMicrosPerThousand, perPostCapMicros, qualification };
}

export function normalizeAdminDealEconomics(value: unknown): AdminDealEconomics | null {
  const record = recordValue(value);
  if (!record || !exactKeys(record, economicsKeys) || record.schemaVersion !== 1) return null;

  const currency = requiredNullableString(record, "currency");
  const currencyExponent = nullableInteger(record.currencyExponent, 6);
  const measurementWindowSeconds = nullableInteger(record.measurementWindowSeconds, 31_557_600);
  const measurementWindowAnchor = requiredNullableString(
    record,
    "measurementWindowAnchor",
    ["published_at"],
  );
  const paidImpressionsPolicy = requiredNullableString(
    record,
    "paidImpressionsPolicy",
    paidImpressionsPolicies,
  );
  const invalidTrafficPolicy = requiredNullableString(
    record,
    "invalidTrafficPolicy",
    invalidTrafficPolicies,
  );
  const fixedFeeMicros = nullableInteger(record.fixedFeeMicros);
  const creatorAggregateCapMicros = nullableInteger(record.creatorAggregateCapMicros);
  const minimumQualifiedViews = nullableInteger(record.minimumQualifiedViews);
  const crossPostPolicy = requiredNullableString(
    record,
    "crossPostPolicy",
    crossPostPolicies,
  );
  const paymentDueDays = nullableInteger(record.paymentDueDays, 3_650);
  const minimumPayoutMicros = nullableInteger(record.minimumPayoutMicros);
  const tiers = recordValue(record.tiers);
  const baseline = normalizeEconomicsTier(tiers?.baseline);
  const talking = normalizeEconomicsTier(tiers?.talking);

  if (
    currency === undefined ||
    (currency !== null && !/^[A-Z]{3}$/u.test(currency)) ||
    currencyExponent === undefined ||
    measurementWindowSeconds === undefined ||
    measurementWindowAnchor === undefined ||
    paidImpressionsPolicy === undefined ||
    invalidTrafficPolicy === undefined ||
    fixedFeeMicros === undefined ||
    creatorAggregateCapMicros === undefined ||
    minimumQualifiedViews === undefined ||
    crossPostPolicy === undefined ||
    paymentDueDays === undefined ||
    minimumPayoutMicros === undefined ||
    !tiers || !exactKeys(tiers, ["baseline", "talking"]) ||
    !baseline || !talking
  ) return null;

  return {
    schemaVersion: 1,
    currency,
    currencyExponent,
    measurementWindowSeconds,
    measurementWindowAnchor: measurementWindowAnchor as "published_at" | null,
    paidImpressionsPolicy: paidImpressionsPolicy as AdminDealPaidImpressionsPolicy | null,
    invalidTrafficPolicy: invalidTrafficPolicy as AdminDealInvalidTrafficPolicy | null,
    fixedFeeMicros,
    creatorAggregateCapMicros,
    minimumQualifiedViews,
    crossPostPolicy: crossPostPolicy as AdminDealCrossPostPolicy | null,
    paymentDueDays,
    minimumPayoutMicros,
    tiers: { baseline, talking },
  };
}

export function emptyAdminDealEconomics(): AdminDealEconomics {
  return {
    schemaVersion: 1,
    currency: null,
    currencyExponent: 2,
    measurementWindowSeconds: null,
    measurementWindowAnchor: "published_at",
    paidImpressionsPolicy: null,
    invalidTrafficPolicy: null,
    fixedFeeMicros: null,
    creatorAggregateCapMicros: null,
    minimumQualifiedViews: null,
    crossPostPolicy: null,
    paymentDueDays: null,
    minimumPayoutMicros: null,
    tiers: {
      baseline: { rateMicrosPerThousand: null, perPostCapMicros: null, qualification: null },
      talking: { rateMicrosPerThousand: null, perPostCapMicros: null, qualification: null },
    },
  };
}

function normalizeReadinessBlockers(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const blockers = value.map(stringValue);
  return blockers.every((blocker): blocker is string => blocker !== null) ? blockers : null;
}

export function normalizeAdminDealVersion(value: unknown): AdminDealVersion | null {
  const record = recordValue(value);
  if (!record) return null;

  const id = stringValue(record.id);
  const dealKey = stringValue(record.dealKey);
  const version = positiveInteger(record.version);
  const label = stringValue(record.label);
  const status = statusValue(record.status);
  const draftRevision = positiveInteger(record.draftRevision);
  const termsHash = hashValue(record.termsHash);
  const economicsHash = record.economicsHash === null ? null : hashValue(record.economicsHash);
  const snapshotHash = hashValue(record.snapshotHash);
  const providerTemplateHash = record.providerTemplateHash === null
    ? null
    : hashValue(record.providerTemplateHash);
  const assignmentCount = safeInteger(record.assignmentCount);
  const providerBindingCount = safeInteger(record.providerBindingCount);
  const approvalCount = safeInteger(record.approvalCount);
  const businessApprovalCount = safeInteger(record.businessApprovalCount);
  const legalApprovalCount = safeInteger(record.legalApprovalCount);
  const readinessBlockerCount = safeInteger(record.readinessBlockerCount);
  const readinessBlockers = normalizeReadinessBlockers(record.readinessBlockers);
  const createdAt = timestampValue(record.createdAt);
  const updatedAt = timestampValue(record.updatedAt);
  const effectiveAt = record.effectiveAt === null ? null : timestampValue(record.effectiveAt);
  const sealedAt = record.sealedAt === null ? null : timestampValue(record.sealedAt);

  if (
    !id || !uuidPattern.test(id) || !dealKey || !version || !label || !status ||
    !draftRevision || !termsHash || record.economicsHash !== null && !economicsHash ||
    !snapshotHash || record.providerTemplateHash !== null && !providerTemplateHash ||
    assignmentCount === null || providerBindingCount === null || approvalCount === null ||
    businessApprovalCount === null || legalApprovalCount === null ||
    readinessBlockerCount === null || !readinessBlockers ||
    readinessBlockers.length !== readinessBlockerCount ||
    typeof record.isDefault !== "boolean" || typeof record.activationReady !== "boolean" ||
    record.activationReady !== (readinessBlockerCount === 0) || !createdAt || !updatedAt ||
    (record.effectiveAt !== null && !effectiveAt) || (record.sealedAt !== null && !sealedAt)
  ) return null;

  return {
    id,
    dealKey,
    version,
    label,
    status,
    isDefault: record.isDefault,
    draftRevision,
    termsHash,
    economicsHash,
    snapshotHash,
    providerTemplateHash,
    assignmentCount,
    providerBindingCount,
    approvalCount,
    businessApprovalCount,
    legalApprovalCount,
    readinessBlockerCount,
    activationReady: record.activationReady,
    readinessBlockers,
    createdAt,
    updatedAt,
    effectiveAt,
    sealedAt,
  };
}

function normalizeProviderBinding(value: unknown): AdminDealProviderBinding | null {
  const record = recordValue(value);
  if (!record) return null;
  const id = stringValue(record.id);
  const sourceArtifactId = record.sourceArtifactId === null
    ? null
    : stringValue(record.sourceArtifactId);
  const environment = stringValue(record.environment);
  const templateId = stringValue(record.templateId);
  const templateHash = hashValue(record.templateHash);
  const boundSnapshotHash = hashValue(record.boundSnapshotHash);
  const configuredBy = stringValue(record.configuredBy);
  const verifiedBy = record.verifiedBy === null ? null : stringValue(record.verifiedBy);
  const verificationMethod = record.verificationMethod === null
    ? null
    : stringValue(record.verificationMethod);
  const verifiedAt = record.verifiedAt === null ? null : timestampValue(record.verifiedAt);
  const updatedAt = timestampValue(record.updatedAt);
  if (
    !id || !uuidPattern.test(id) ||
    (record.sourceArtifactId !== null && (!sourceArtifactId || !uuidPattern.test(sourceArtifactId))) ||
    record.provider !== "signwell" || !environment ||
    !templateId || !uuidPattern.test(templateId) || !templateHash || !boundSnapshotHash ||
    !configuredBy || !uuidPattern.test(configuredBy) ||
    (record.verifiedBy !== null && (!verifiedBy || !uuidPattern.test(verifiedBy))) ||
    ![null, "manual_admin_attestation"].includes(verificationMethod) ||
    !["pending", "verified", "disabled"].includes(String(record.status)) ||
    (record.verifiedAt !== null && !verifiedAt) ||
    (record.status === "verified") !== Boolean(verifiedAt && verifiedBy && verificationMethod) ||
    !updatedAt
  ) return null;
  return {
    id,
    sourceArtifactId,
    provider: "signwell",
    environment,
    templateId,
    templateHash,
    boundSnapshotHash,
    status: record.status as AdminDealProviderBinding["status"],
    configuredBy,
    verifiedBy,
    verificationMethod: verificationMethod as AdminDealProviderBinding["verificationMethod"],
    verifiedAt,
    updatedAt,
  };
}

function normalizeApproval(value: unknown): AdminDealApproval | null {
  const record = recordValue(value);
  if (!record) return null;
  const id = stringValue(record.id);
  const snapshotHash = hashValue(record.snapshotHash);
  const approvedBy = stringValue(record.approvedBy);
  const note = nullableText(record.note, 2_000);
  const approvedAt = timestampValue(record.approvedAt);
  const revokedBy = record.revokedBy === null ? null : stringValue(record.revokedBy);
  const revocationNote = nullableText(record.revocationNote, 2_000);
  const revokedAt = record.revokedAt === null ? null : timestampValue(record.revokedAt);
  if (
    !id || !uuidPattern.test(id) || !["business", "legal"].includes(String(record.kind)) ||
    !["approved", "revoked"].includes(String(record.status)) || !snapshotHash ||
    !approvedBy || !uuidPattern.test(approvedBy) || note === undefined || !approvedAt ||
    (record.revokedBy !== null && (!revokedBy || !uuidPattern.test(revokedBy))) ||
    revocationNote === undefined || (record.revokedAt !== null && !revokedAt) ||
    (record.status === "revoked") !== Boolean(revokedAt && revokedBy && revocationNote)
  ) return null;
  return {
    id,
    kind: record.kind as AdminDealApproval["kind"],
    status: record.status as AdminDealApproval["status"],
    snapshotHash,
    approvedBy,
    note,
    approvedAt,
    revokedBy,
    revocationNote,
    revokedAt,
  };
}

function emptyAuditMetadata(): AdminDealAuditMetadata {
  return {
    changedFields: [],
    changeNote: null,
    snapshotHash: null,
    approvalKind: null,
    approvalNote: null,
    originalApprover: null,
    revocationNote: null,
    newAssignmentsBlocked: null,
    provider: null,
    environment: null,
    templateId: null,
    sourceArtifactId: null,
    templateSourceSha256: null,
    originalFilename: null,
    contentType: null,
    byteSize: null,
    verificationState: null,
    verificationMethod: null,
    attestationText: null,
    integrityCheckedAt: null,
    integrityMethod: null,
    replacementDealVersionId: null,
    replacementSnapshotHash: null,
    previousDefaultDealVersionId: null,
    activationConfirmation: null,
    readinessRecomputedUnderLock: null,
  };
}

function auditUuid(value: unknown) {
  const candidate = stringValue(value);
  return candidate && uuidPattern.test(candidate) ? candidate : null;
}

function normalizeAuditEvent(value: unknown): AdminDealAuditEvent | null {
  const record = recordValue(value);
  if (!record || !exactKeys(record, [
    "id",
    "type",
    "actorUserId",
    "draftRevision",
    "fromStatus",
    "toStatus",
    "metadata",
    "createdAt",
  ])) return null;
  const metadata = recordValue(record.metadata);
  if (!metadata) return null;
  const id = positiveInteger(record.id);
  const type = stringValue(record.type);
  const actorUserId = stringValue(record.actorUserId);
  const draftRevision = positiveInteger(record.draftRevision);
  const fromStatus = record.fromStatus === null ? null : statusValue(record.fromStatus);
  const toStatus = record.toStatus === null ? null : statusValue(record.toStatus);
  const createdAt = timestampValue(record.createdAt);
  if (
    !id || !type || !actorUserId || !uuidPattern.test(actorUserId) || !draftRevision ||
    (record.fromStatus !== null && !fromStatus) || (record.toStatus !== null && !toStatus) ||
    !createdAt
  ) return null;

  const normalized = emptyAuditMetadata();
  if (type === "draft_created") {
    const changeNote = nullableText(metadata.changeNote, 2_000);
    if (
      !exactKeys(metadata, ["changeNote"]) || changeNote === undefined ||
      fromStatus !== null || toStatus !== "draft"
    ) return null;
    normalized.changeNote = changeNote;
  } else if (type === "draft_updated") {
    const rawFields = Array.isArray(metadata.changedFields) ? metadata.changedFields : null;
    const changedFields = rawFields?.map(stringValue) ?? null;
    const changeNote = nullableText(metadata.changeNote, 2_000);
    if (
      !exactKeys(metadata, ["changedFields", "changeNote"]) || !changedFields ||
      changedFields.length === 0 ||
      !changedFields.every((field): field is string =>
        field !== null && ["label", "termsMarkdown", "economics"].includes(field)) ||
      new Set(changedFields).size !== changedFields.length || changeNote === undefined ||
      fromStatus !== "draft" || toStatus !== "draft"
    ) return null;
    normalized.changedFields = changedFields as string[];
    normalized.changeNote = changeNote;
  } else if (type === "draft_sealed") {
    const snapshotHash = hashValue(metadata.snapshotHash);
    const changeNote = nullableText(metadata.changeNote, 2_000);
    if (
      !exactKeys(metadata, ["snapshotHash", "changeNote"]) || !snapshotHash ||
      changeNote === undefined || fromStatus !== "draft" || toStatus !== "sealed"
    ) return null;
    normalized.snapshotHash = snapshotHash;
    normalized.changeNote = changeNote;
  } else if (type === "snapshot_approval_recorded") {
    const approvalKind = metadata.approvalKind === "business" || metadata.approvalKind === "legal"
      ? metadata.approvalKind
      : null;
    const snapshotHash = hashValue(metadata.snapshotHash);
    const approvalNote = nullableText(metadata.note, 2_000);
    if (
      !exactKeys(metadata, ["approvalKind", "snapshotHash", "note"]) || !approvalKind ||
      !snapshotHash || approvalNote === undefined ||
      (approvalKind === "legal" && (!approvalNote || approvalNote.length < 4)) ||
      fromStatus !== "sealed" || toStatus !== "sealed"
    ) return null;
    normalized.approvalKind = approvalKind;
    normalized.snapshotHash = snapshotHash;
    normalized.approvalNote = approvalNote;
  } else if (type === "snapshot_approval_revoked") {
    const approvalKind = metadata.approvalKind === "business" || metadata.approvalKind === "legal"
      ? metadata.approvalKind
      : null;
    const snapshotHash = hashValue(metadata.snapshotHash);
    const originalApprover = auditUuid(metadata.originalApprover);
    const revocationNote = stringValue(metadata.revocationNote);
    if (
      !exactKeys(metadata, [
        "approvalKind",
        "snapshotHash",
        "originalApprover",
        "revocationNote",
        "newAssignmentsBlocked",
      ]) || !approvalKind || !snapshotHash || !originalApprover || !revocationNote ||
      revocationNote.length < 4 || revocationNote.length > 2_000 ||
      typeof metadata.newAssignmentsBlocked !== "boolean" ||
      !fromStatus || fromStatus !== toStatus || !["sealed", "active"].includes(fromStatus)
    ) return null;
    normalized.approvalKind = approvalKind;
    normalized.snapshotHash = snapshotHash;
    normalized.originalApprover = originalApprover;
    normalized.revocationNote = revocationNote;
    normalized.newAssignmentsBlocked = metadata.newAssignmentsBlocked;
  } else if (type === "signwell_template_source_archived") {
    const templateId = auditUuid(metadata.templateId);
    const sourceArtifactId = auditUuid(metadata.sourceArtifactId);
    const templateSourceSha256 = hashValue(metadata.templateSourceSha256);
    const snapshotHash = hashValue(metadata.snapshotHash);
    const originalFilename = stringValue(metadata.originalFilename);
    const contentType = stringValue(metadata.contentType);
    const byteSize = positiveInteger(metadata.byteSize);
    if (
      !exactKeys(metadata, [
        "provider",
        "environment",
        "templateId",
        "sourceArtifactId",
        "templateSourceSha256",
        "snapshotHash",
        "originalFilename",
        "contentType",
        "byteSize",
      ]) || metadata.provider !== "signwell" || metadata.environment !== "production" ||
      !templateId || !sourceArtifactId || !templateSourceSha256 || !snapshotHash ||
      !originalFilename || originalFilename.length > 255 ||
      !contentType || ![
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(contentType) || !byteSize ||
      fromStatus !== "sealed" || toStatus !== "sealed"
    ) return null;
    normalized.provider = "signwell";
    normalized.environment = "production";
    normalized.templateId = templateId;
    normalized.sourceArtifactId = sourceArtifactId;
    normalized.templateSourceSha256 = templateSourceSha256;
    normalized.snapshotHash = snapshotHash;
    normalized.originalFilename = originalFilename;
    normalized.contentType = contentType;
    normalized.byteSize = byteSize;
  } else if (type === "signwell_binding_recorded") {
    const templateId = auditUuid(metadata.templateId);
    const sourceArtifactId = auditUuid(metadata.sourceArtifactId);
    const templateSourceSha256 = hashValue(metadata.templateSourceSha256);
    const snapshotHash = hashValue(metadata.snapshotHash);
    if (
      !exactKeys(metadata, [
        "provider",
        "environment",
        "templateId",
        "sourceArtifactId",
        "templateSourceSha256",
        "snapshotHash",
        "verificationState",
      ]) || metadata.provider !== "signwell" || metadata.environment !== "production" ||
      !templateId || !sourceArtifactId || !templateSourceSha256 || !snapshotHash ||
      metadata.verificationState !== "pending_manual_attestation" ||
      fromStatus !== "sealed" || toStatus !== "sealed"
    ) return null;
    normalized.provider = "signwell";
    normalized.environment = "production";
    normalized.templateId = templateId;
    normalized.sourceArtifactId = sourceArtifactId;
    normalized.templateSourceSha256 = templateSourceSha256;
    normalized.snapshotHash = snapshotHash;
    normalized.verificationState = "pending_manual_attestation";
  } else if (type === "signwell_binding_verified") {
    const templateId = auditUuid(metadata.templateId);
    const sourceArtifactId = auditUuid(metadata.sourceArtifactId);
    const templateSourceSha256 = hashValue(metadata.templateSourceSha256);
    const snapshotHash = hashValue(metadata.snapshotHash);
    const attestationText = stringValue(metadata.attestationText);
    const integrityCheckedAt = timestampValue(metadata.integrityCheckedAt);
    if (
      !exactKeys(metadata, [
        "provider",
        "environment",
        "templateId",
        "sourceArtifactId",
        "templateSourceSha256",
        "snapshotHash",
        "verificationMethod",
        "attestationText",
        "integrityCheckedAt",
        "integrityMethod",
      ]) || metadata.provider !== "signwell" || metadata.environment !== "production" ||
      !templateId || !sourceArtifactId || !templateSourceSha256 || !snapshotHash ||
      metadata.verificationMethod !== "manual_admin_attestation" ||
      attestationText !== signWellBindingVerificationAttestation ||
      !integrityCheckedAt ||
      metadata.integrityMethod !== "server_private_storage_download_size_structure_sha256" ||
      fromStatus !== "sealed" || toStatus !== "sealed"
    ) return null;
    normalized.provider = "signwell";
    normalized.environment = "production";
    normalized.templateId = templateId;
    normalized.sourceArtifactId = sourceArtifactId;
    normalized.templateSourceSha256 = templateSourceSha256;
    normalized.snapshotHash = snapshotHash;
    normalized.verificationMethod = "manual_admin_attestation";
    normalized.attestationText = attestationText;
    normalized.integrityCheckedAt = integrityCheckedAt;
    normalized.integrityMethod = "server_private_storage_download_size_structure_sha256";
  } else if (type === "default_replaced_and_retired") {
    const replacementDealVersionId = auditUuid(metadata.replacementDealVersionId);
    const replacementSnapshotHash = hashValue(metadata.replacementSnapshotHash);
    if (
      !exactKeys(metadata, ["replacementDealVersionId", "replacementSnapshotHash"]) ||
      !replacementDealVersionId || !replacementSnapshotHash ||
      fromStatus !== "active" || toStatus !== "retired"
    ) return null;
    normalized.replacementDealVersionId = replacementDealVersionId;
    normalized.replacementSnapshotHash = replacementSnapshotHash;
  } else if (type === "default_activated") {
    const snapshotHash = hashValue(metadata.snapshotHash);
    const sourceArtifactId = auditUuid(metadata.sourceArtifactId);
    const templateSourceSha256 = hashValue(metadata.templateSourceSha256);
    const integrityCheckedAt = timestampValue(metadata.integrityCheckedAt);
    const previousDefaultDealVersionId = metadata.previousDefaultDealVersionId === null
      ? null
      : auditUuid(metadata.previousDefaultDealVersionId);
    if (
      !exactKeys(metadata, [
        "snapshotHash",
        "sourceArtifactId",
        "templateSourceSha256",
        "previousDefaultDealVersionId",
        "activationConfirmation",
        "readinessRecomputedUnderLock",
        "integrityCheckedAt",
        "integrityMethod",
      ]) || !snapshotHash || !sourceArtifactId || !templateSourceSha256 || !integrityCheckedAt ||
      (metadata.previousDefaultDealVersionId !== null && !previousDefaultDealVersionId) ||
      metadata.activationConfirmation !== adminDealActivationConfirmation ||
      metadata.readinessRecomputedUnderLock !== true ||
      metadata.integrityMethod !== "server_private_storage_download_size_structure_sha256" ||
      fromStatus !== "sealed" || toStatus !== "active"
    ) return null;
    normalized.snapshotHash = snapshotHash;
    normalized.sourceArtifactId = sourceArtifactId;
    normalized.templateSourceSha256 = templateSourceSha256;
    normalized.previousDefaultDealVersionId = previousDefaultDealVersionId;
    normalized.activationConfirmation = adminDealActivationConfirmation;
    normalized.readinessRecomputedUnderLock = true;
    normalized.integrityCheckedAt = integrityCheckedAt;
    normalized.integrityMethod = "server_private_storage_download_size_structure_sha256";
  } else {
    return null;
  }

  return {
    id,
    type: type as AdminDealAuditEvent["type"],
    actorUserId,
    draftRevision,
    fromStatus,
    toStatus,
    metadata: normalized,
    createdAt,
  };
}

export function normalizeAdminDealDetail(value: unknown): AdminDealDetail | null {
  const record = recordValue(firstValue(value));
  const version = normalizeAdminDealVersion(record);
  if (!record || !version) return null;
  const termsMarkdown = typeof record.termsMarkdown === "string" ? record.termsMarkdown : null;
  const economics = record.economics === null ? null : normalizeAdminDealEconomics(record.economics);
  const changeNote = nullableText(record.changeNote, 2_000);
  const rawBindings = Array.isArray(record.providerBindings) ? record.providerBindings : null;
  const rawApprovals = Array.isArray(record.approvals) ? record.approvals : null;
  const rawEvents = Array.isArray(record.auditEvents) ? record.auditEvents : null;
  const providerBindings = rawBindings?.map(normalizeProviderBinding) ?? null;
  const approvals = rawApprovals?.map(normalizeApproval) ?? null;
  const auditEvents = rawEvents?.map(normalizeAuditEvent) ?? null;
  if (
    termsMarkdown === null || (record.economics !== null && !economics) ||
    changeNote === undefined || !providerBindings || providerBindings.some((item) => !item) ||
    !approvals || approvals.some((item) => !item) || !auditEvents || auditEvents.some((item) => !item)
  ) return null;
  return {
    ...version,
    termsMarkdown,
    economics,
    changeNote,
    providerBindings: providerBindings as AdminDealProviderBinding[],
    approvals: approvals as AdminDealApproval[],
    auditEvents: auditEvents as AdminDealAuditEvent[],
  };
}

export function normalizeAdminDealCatalog(value: unknown): AdminDealCatalog | null {
  const record = recordValue(firstValue(value));
  if (!record || !Array.isArray(record.versions)) return null;
  const versions = record.versions.map(normalizeAdminDealVersion);
  const defaultVersion = record.defaultVersion === null
    ? null
    : normalizeAdminDealVersion(record.defaultVersion);
  if (versions.some((version) => !version) || (record.defaultVersion !== null && !defaultVersion)) {
    return null;
  }
  return { defaultVersion, versions: versions as AdminDealVersion[] };
}

function parseChangeNote(value: unknown): string | null | undefined {
  return nullableText(value, 2_000);
}

export function parseAdminDealCreateInput(value: unknown): AdminDealCreateInput | null {
  const record = recordValue(value);
  const keys = ["dealKey", "label", "termsMarkdown", "economics", "changeNote"];
  if (!record || !onlyKeys(record, keys)) return null;
  const dealKey = stringValue(record.dealKey)?.toLowerCase() ?? null;
  const label = stringValue(record.label);
  const termsMarkdown = typeof record.termsMarkdown === "string"
    ? record.termsMarkdown.trim()
    : null;
  const economics = normalizeAdminDealEconomics(record.economics);
  const changeNote = parseChangeNote(record.changeNote);
  if (
    !dealKey || !dealKeyPattern.test(dealKey) || !label || label.length > 120 ||
    !termsMarkdown || termsMarkdown.length > 100_000 || !economics || changeNote === undefined
  ) return null;
  return { dealKey, label, termsMarkdown, economics, changeNote };
}

export function parseAdminDealUpdateInput(value: unknown): AdminDealUpdateInput | null {
  const record = recordValue(value);
  const keys = ["revision", "label", "termsMarkdown", "economics", "changeNote"];
  if (!record || !onlyKeys(record, keys)) return null;
  const revision = positiveInteger(record.revision);
  const patch: AdminDealUpdateInput["patch"] = {};
  if ("label" in record) {
    const label = stringValue(record.label);
    if (!label || label.length > 120) return null;
    patch.label = label;
  }
  if ("termsMarkdown" in record) {
    if (typeof record.termsMarkdown !== "string") return null;
    const termsMarkdown = record.termsMarkdown.trim();
    if (!termsMarkdown || termsMarkdown.length > 100_000) return null;
    patch.termsMarkdown = termsMarkdown;
  }
  if ("economics" in record) {
    const economics = normalizeAdminDealEconomics(record.economics);
    if (!economics) return null;
    patch.economics = economics;
  }
  if ("changeNote" in record) {
    const changeNote = parseChangeNote(record.changeNote);
    if (changeNote === undefined) return null;
    patch.changeNote = changeNote;
  }
  if (!revision || !("label" in patch || "termsMarkdown" in patch || "economics" in patch)) {
    return null;
  }
  return { revision, patch };
}

export function parseAdminDealSealInput(value: unknown): AdminDealSealInput | null {
  const record = recordValue(value);
  if (!record || !onlyKeys(record, ["revision", "changeNote"])) return null;
  const revision = positiveInteger(record.revision);
  const changeNote = parseChangeNote(record.changeNote);
  return revision && changeNote !== undefined ? { revision, changeNote } : null;
}

export function parseAdminDealApprovalInput(value: unknown): AdminDealApprovalInput | null {
  const record = recordValue(value);
  if (!record || !onlyKeys(record, ["kind", "snapshotHash", "note"])) return null;
  const kind = record.kind === "business" || record.kind === "legal" ? record.kind : null;
  const snapshotHash = hashValue(record.snapshotHash);
  const note = nullableText(record.note, 2_000);
  if (!kind || !snapshotHash || note === undefined) return null;
  if (kind === "legal" && (!note || note.length < 4)) return null;
  return { kind, snapshotHash, note };
}

export function parseAdminDealApprovalRevocationInput(
  value: unknown,
): AdminDealApprovalRevocationInput | null {
  const record = recordValue(value);
  if (!record || !onlyKeys(record, ["kind", "snapshotHash", "reason"])) return null;
  const kind = record.kind === "business" || record.kind === "legal" ? record.kind : null;
  const snapshotHash = hashValue(record.snapshotHash);
  const reason = stringValue(record.reason);
  return kind && snapshotHash && reason && reason.length >= 4 && reason.length <= 2_000
    ? { kind, snapshotHash, reason }
    : null;
}

export function parseAdminDealSignWellBindingInput(
  value: unknown,
): AdminDealSignWellBindingInput | null {
  const record = recordValue(value);
  if (!record || !onlyKeys(record, ["templateId", "templateSourceSha256", "snapshotHash"])) {
    return null;
  }
  const templateId = stringValue(record.templateId);
  const templateSourceSha256 = hashValue(record.templateSourceSha256);
  const snapshotHash = hashValue(record.snapshotHash);
  return templateId && uuidPattern.test(templateId) && templateSourceSha256 && snapshotHash
    ? { templateId, templateSourceSha256, snapshotHash }
    : null;
}

export function parseAdminDealSignWellVerificationInput(
  value: unknown,
): AdminDealSignWellVerificationInput | null {
  const record = recordValue(value);
  if (!record || !onlyKeys(record, [
    "templateId",
    "templateSourceSha256",
    "snapshotHash",
    "attestation",
  ])) return null;
  const binding = parseAdminDealSignWellBindingInput({
    templateId: record.templateId,
    templateSourceSha256: record.templateSourceSha256,
    snapshotHash: record.snapshotHash,
  });
  return binding && record.attestation === signWellBindingVerificationAttestation
    ? { ...binding, attestation: signWellBindingVerificationAttestation }
    : null;
}

export function parseAdminDealActivationInput(value: unknown): AdminDealActivationInput | null {
  const record = recordValue(value);
  if (!record || !onlyKeys(record, ["snapshotHash", "confirmation"])) return null;
  const snapshotHash = hashValue(record.snapshotHash);
  return snapshotHash && record.confirmation === adminDealActivationConfirmation
    ? { snapshotHash, confirmation: adminDealActivationConfirmation }
    : null;
}

export async function getAdminDealCatalog(): Promise<AdminDealCatalog> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_program_deal_catalog");
  if (error) throw new Error("Could not load the deal catalog.", { cause: error });
  const catalog = normalizeAdminDealCatalog(data);
  if (!catalog) throw new Error("The deal catalog response was incomplete.");
  return catalog;
}

export async function getAdminDealDetail(dealVersionId: string): Promise<AdminDealDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_program_deal_detail", {
    target_deal_version_id: dealVersionId,
  });
  if (error) throw new Error("Could not load the deal version.", { cause: error });
  if (data === null) return null;
  const detail = normalizeAdminDealDetail(data);
  if (!detail) throw new Error("The deal detail response was incomplete.");
  return detail;
}
