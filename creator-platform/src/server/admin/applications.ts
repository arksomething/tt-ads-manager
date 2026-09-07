import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export const creatorApplicationStatuses = [
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type StaffApplicationStatus = (typeof creatorApplicationStatuses)[number];
export type StaffApplicationFilter = StaffApplicationStatus | "all";
export type StaffApplicationRole = "reviewer" | "admin";

export type StaffApplicationQueueItem = {
  id: string;
  name: string;
  email: string;
  discordUsername: string;
  status: StaffApplicationStatus;
  lifecycleStatus: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewRevision: number;
  handleCount: number;
  platforms: Array<"TIKTOK" | "INSTAGRAM_REELS">;
};

export type StaffApplicationHandle = {
  id: string;
  platform: "TIKTOK" | "INSTAGRAM_REELS";
  handle: string;
  normalizedHandle: string;
};

export type StaffApplicationAuditEvent = {
  id: number;
  type: string;
  actorUserId: string | null;
  createdAt: string;
  fromStatus: string | null;
  toStatus: string | null;
  applicantMessage: string | null;
  staffNote: string | null;
  reviewRevision: number | null;
};

export type StaffApplicationDetail = {
  id: string;
  accountId: string;
  name: string;
  email: string;
  phoneNumber: string;
  discordUsername: string;
  status: StaffApplicationStatus;
  lifecycleStatus: string;
  submittedAt: string;
  reviewedAt: string | null;
  decisionMessage: string | null;
  staffNote: string | null;
  reviewRevision: number;
  handles: StaffApplicationHandle[];
  enrollment: null | {
    id: string;
    status: string;
    approvedAt: string;
    dealVersionId: string;
    dealLabel: string;
    dealVersion: number;
  };
  agreement: null | {
    id: string;
    provider: string;
    status: string;
    createdAt: string;
  };
  auditEvents: StaffApplicationAuditEvent[];
};

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstRecord(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) return recordValue(value[0]);
  return recordValue(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerValue(value: unknown) {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function statusValue(value: unknown): StaffApplicationStatus | null {
  const candidate = stringValue(value);
  return creatorApplicationStatuses.find((status) => status === candidate) ?? null;
}

function timestampValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function platformValue(
  value: unknown,
): "TIKTOK" | "INSTAGRAM_REELS" | null {
  const candidate = stringValue(value);
  return candidate === "TIKTOK" || candidate === "INSTAGRAM_REELS"
    ? candidate
    : null;
}

function platformArray(value: unknown): StaffApplicationQueueItem["platforms"] | null {
  if (!Array.isArray(value)) return null;
  const platforms: StaffApplicationQueueItem["platforms"] = [];
  for (const candidate of value) {
    const platform = platformValue(candidate);
    if (!platform) return null;
    platforms.push(platform);
  }
  return platforms;
}

function queueItemValue(value: unknown): StaffApplicationQueueItem | null {
  const record = recordValue(value);
  if (!record) return null;

  const id = stringValue(record.id);
  const name = stringValue(record.name);
  const email = stringValue(record.email);
  const discordUsername = stringValue(record.discordUsername ?? record.discord_username);
  const status = statusValue(record.status);
  const lifecycleStatus = stringValue(record.lifecycleStatus ?? record.lifecycle_status);
  const submittedAt = timestampValue(record.submittedAt ?? record.submitted_at);
  const reviewedAt = timestampValue(record.reviewedAt ?? record.reviewed_at);
  const reviewRevision = integerValue(record.reviewRevision ?? record.review_revision);
  const handleCount = integerValue(record.handleCount ?? record.handle_count);
  const platforms = platformArray(record.platforms);

  if (
    !id || !name || !email || !discordUsername || !status || !lifecycleStatus ||
    !submittedAt || reviewRevision === null || handleCount === null || !platforms
  ) {
    return null;
  }

  return {
    id,
    name,
    email,
    discordUsername,
    status,
    lifecycleStatus,
    submittedAt,
    reviewedAt,
    reviewRevision,
    handleCount,
    platforms,
  };
}

export function normalizeStaffApplicationQueue(
  value: unknown,
): StaffApplicationQueueItem[] | null {
  const root = firstRecord(value);
  if (!root || !Array.isArray(root.applications)) return null;

  const applications: StaffApplicationQueueItem[] = [];
  for (const application of root.applications) {
    const normalized = queueItemValue(application);
    if (!normalized) return null;
    applications.push(normalized);
  }
  return applications;
}

function handleValue(value: unknown): StaffApplicationHandle | null {
  const record = recordValue(value);
  if (!record) return null;

  const id = stringValue(record.id);
  const platform = platformValue(record.platform);
  const handle = stringValue(record.handle);
  const normalizedHandle = stringValue(record.normalizedHandle ?? record.normalized_handle);

  return id && platform && handle && normalizedHandle
    ? { id, platform, handle, normalizedHandle }
    : null;
}

function auditEventValue(value: unknown): StaffApplicationAuditEvent | null {
  const record = recordValue(value);
  if (!record) return null;

  const id = integerValue(record.id);
  const type = stringValue(record.type);
  const createdAt = timestampValue(record.createdAt ?? record.created_at);
  const metadata = recordValue(record.metadata) ?? {};

  if (id === null || !type || !createdAt) return null;

  return {
    id,
    type,
    actorUserId: stringValue(record.actorUserId ?? record.actor_user_id),
    createdAt,
    fromStatus: stringValue(metadata.from_status ?? metadata.fromStatus),
    toStatus: stringValue(metadata.to_status ?? metadata.toStatus),
    applicantMessage: stringValue(
      metadata.applicant_message ?? metadata.applicantMessage,
    ),
    staffNote: stringValue(metadata.staff_note ?? metadata.staffNote),
    reviewRevision: integerValue(
      metadata.review_revision ?? metadata.reviewRevision,
    ),
  };
}

function enrollmentValue(value: unknown): StaffApplicationDetail["enrollment"] {
  const record = recordValue(value);
  if (!record) return null;

  const id = stringValue(record.id);
  const status = stringValue(record.status);
  const approvedAt = timestampValue(record.approvedAt ?? record.approved_at);
  const dealVersionId = stringValue(record.dealVersionId ?? record.deal_version_id);
  const dealLabel = stringValue(record.dealLabel ?? record.deal_label);
  const dealVersion = integerValue(record.dealVersion ?? record.deal_version);

  return id && status && approvedAt && dealVersionId && dealLabel && dealVersion !== null
    ? { id, status, approvedAt, dealVersionId, dealLabel, dealVersion }
    : null;
}

function agreementValue(value: unknown): StaffApplicationDetail["agreement"] {
  const record = recordValue(value);
  if (!record) return null;

  const id = stringValue(record.id);
  const provider = stringValue(record.provider);
  const status = stringValue(record.status);
  const createdAt = timestampValue(record.createdAt ?? record.created_at);

  return id && provider && status && createdAt
    ? { id, provider, status, createdAt }
    : null;
}

export function normalizeStaffApplicationDetail(
  value: unknown,
): StaffApplicationDetail | null {
  const root = firstRecord(value);
  const record = recordValue(root?.application) ?? root;
  if (!record) return null;

  const id = stringValue(record.id);
  const accountId = stringValue(record.accountId ?? record.account_id);
  const name = stringValue(record.name);
  const email = stringValue(record.email);
  const phoneNumber = stringValue(record.phoneNumber ?? record.phone_number);
  const discordUsername = stringValue(record.discordUsername ?? record.discord_username);
  const status = statusValue(record.status);
  const lifecycleStatus = stringValue(record.lifecycleStatus ?? record.lifecycle_status);
  const submittedAt = timestampValue(record.submittedAt ?? record.submitted_at);
  const reviewedAt = timestampValue(record.reviewedAt ?? record.reviewed_at);
  const reviewRevision = integerValue(record.reviewRevision ?? record.review_revision);

  if (
    !id || !accountId || !name || !email || !phoneNumber || !discordUsername ||
    !status || !lifecycleStatus || !submittedAt || reviewRevision === null
  ) {
    return null;
  }

  const rawAuditEvents = record.auditEvents ?? record.audit_events;
  const rawHandles = record.handles;
  if (!Array.isArray(rawHandles) || !Array.isArray(rawAuditEvents)) return null;

  const handles = rawHandles.map(handleValue);
  const auditEvents = rawAuditEvents.map(auditEventValue);
  const enrollment = record.enrollment === null ? null : enrollmentValue(record.enrollment);
  const agreement = record.agreement === null ? null : agreementValue(record.agreement);
  if (
    handles.some((handle) => !handle) || auditEvents.some((event) => !event) ||
    !("enrollment" in record) || (record.enrollment !== null && !enrollment) ||
    !("agreement" in record) || (record.agreement !== null && !agreement)
  ) return null;

  return {
    id,
    accountId,
    name,
    email,
    phoneNumber,
    discordUsername,
    status,
    lifecycleStatus,
    submittedAt,
    reviewedAt,
    decisionMessage: stringValue(record.decisionMessage ?? record.decision_message),
    staffNote: stringValue(record.staffNote ?? record.staff_note),
    reviewRevision,
    handles: handles as StaffApplicationHandle[],
    enrollment,
    agreement,
    auditEvents: auditEvents as StaffApplicationAuditEvent[],
  };
}

export function normalizeApplicationFilter(value: unknown): StaffApplicationFilter {
  const candidate = stringValue(value);
  if (!candidate || candidate === "all") return "all";
  return statusValue(candidate) ?? "all";
}

export async function getCurrentApplicationStaffMembership(): Promise<{
  role: StaffApplicationRole;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_current_staff_member");
  if (error) throw error;

  const record = firstRecord(data);
  const role = stringValue(record?.staff_role);
  if (record?.active !== true || (role !== "reviewer" && role !== "admin")) {
    return null;
  }

  return { role };
}

export async function getStaffApplicationQueue(filter: StaffApplicationFilter) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_staff_creator_application_queue",
    { application_status_filter: filter === "all" ? null : filter },
  );

  if (error) {
    throw new Error("Could not load the application queue.", { cause: error });
  }

  const queue = normalizeStaffApplicationQueue(data);
  if (!queue) throw new Error("The application queue returned invalid data.");
  return queue;
}

export async function getStaffApplicationDetail(applicationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_staff_creator_application", {
    target_application_id: applicationId,
  });

  if (error) {
    throw new Error("Could not load the creator application.", { cause: error });
  }

  if (Array.isArray(data) && data.length === 0) return null;
  const application = normalizeStaffApplicationDetail(data);
  if (!application) throw new Error("The creator application returned invalid data.");
  return application;
}
