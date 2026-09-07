import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export type AdminContentState = "submitted" | "matching" | "needs_review";

export type AdminContentQueueItem = {
  id: string;
  accountId: string;
  platform: "TIKTOK" | "INSTAGRAM_REELS";
  url: string;
  declaredNativePostId: string | null;
  matchState: AdminContentState;
  matchedPostId: string | null;
  submittedAt: string;
};

export type AdminEarningState = "estimated" | "pending" | "approved" | "paid" | "reconciled";
export type AdminSettlementState = Exclude<AdminEarningState, "estimated">;

export type AdminEarningEntry = {
  id: string;
  accountId: string;
  enrollmentId: string;
  postId: string | null;
  sourceKey: string;
  category: string;
  currency: string;
  currencyExponent: number;
  amountMinor: string;
  state: AdminEarningState;
  periodStart: string | null;
  periodEnd: string | null;
  earnedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  reconciledAt: string | null;
  externalReference: string | null;
  settlementId: string | null;
};

export type AdminSettlement = {
  id: string;
  accountId: string;
  enrollmentId: string;
  currency: string;
  currencyExponent: number;
  totalMinor: string;
  state: AdminSettlementState;
  periodStart: string | null;
  periodEnd: string | null;
  payoutProvider: string | null;
  externalPayoutId: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  reconciledAt: string | null;
  createdAt: string;
  earningEntryIds: string[];
};

export type AdminFinanceLedger = {
  entries: AdminEarningEntry[];
  settlements: AdminSettlement[];
};

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstRecord(value: unknown) {
  return recordValue(Array.isArray(value) ? value[0] : value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function dateValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : null;
}

function exponentValue(value: unknown) {
  const candidate = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(candidate) && candidate >= 0 && candidate <= 4
    ? candidate
    : null;
}

function integerString(value: unknown) {
  const candidate = stringValue(value);
  return candidate && /^-?\d+$/u.test(candidate) ? candidate : null;
}

function arrayResult(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.length === 1 && Array.isArray(value[0]) ? value[0] : value;
}

function normalizeContentItem(value: unknown): AdminContentQueueItem | null {
  const row = recordValue(value);
  const id = stringValue(row?.id);
  const accountId = stringValue(row?.accountId ?? row?.account_id);
  const platform = stringValue(row?.platform);
  const url = stringValue(row?.url);
  const matchState = stringValue(row?.matchState ?? row?.match_state);
  const submittedAt = timestampValue(row?.submittedAt ?? row?.submitted_at);

  if (
    !id || !accountId || !url || !submittedAt ||
    (platform !== "TIKTOK" && platform !== "INSTAGRAM_REELS") ||
    (matchState !== "submitted" && matchState !== "matching" && matchState !== "needs_review")
  ) return null;

  return {
    id,
    accountId,
    platform,
    url,
    declaredNativePostId: stringValue(
      row?.declaredNativePostId ?? row?.declared_native_post_id,
    ),
    matchState,
    matchedPostId: stringValue(row?.matchedPostId ?? row?.matched_post_id),
    submittedAt,
  };
}

export function normalizeAdminContentQueue(value: unknown): AdminContentQueueItem[] | null {
  const rawItems = arrayResult(value);
  if (!rawItems) return null;
  const items: AdminContentQueueItem[] = [];
  for (const candidate of rawItems) {
    const item = normalizeContentItem(candidate);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function normalizeEarning(value: unknown): AdminEarningEntry | null {
  const row = recordValue(value);
  const id = stringValue(row?.id);
  const accountId = stringValue(row?.accountId ?? row?.account_id);
  const enrollmentId = stringValue(row?.enrollmentId ?? row?.enrollment_id);
  const sourceKey = stringValue(row?.sourceKey ?? row?.source_key);
  const category = stringValue(row?.category);
  const currency = stringValue(row?.currency);
  const currencyExponent = exponentValue(row?.currencyExponent ?? row?.currency_exponent);
  const amountMinor = integerString(row?.amountMinor ?? row?.amount_minor);
  const state = stringValue(row?.state);
  const earnedAt = timestampValue(row?.earnedAt ?? row?.earned_at);

  if (
    !id || !accountId || !enrollmentId || !sourceKey || !category || !currency ||
    currencyExponent === null || !amountMinor || !earnedAt ||
    !["estimated", "pending", "approved", "paid", "reconciled"].includes(state ?? "")
  ) return null;

  return {
    id,
    accountId,
    enrollmentId,
    postId: stringValue(row?.postId ?? row?.post_id),
    sourceKey,
    category,
    currency,
    currencyExponent,
    amountMinor,
    state: state as AdminEarningState,
    periodStart: dateValue(row?.periodStart ?? row?.period_start),
    periodEnd: dateValue(row?.periodEnd ?? row?.period_end),
    earnedAt,
    approvedAt: timestampValue(row?.approvedAt ?? row?.approved_at),
    paidAt: timestampValue(row?.paidAt ?? row?.paid_at),
    reconciledAt: timestampValue(row?.reconciledAt ?? row?.reconciled_at),
    externalReference: stringValue(row?.externalReference ?? row?.external_reference),
    settlementId: stringValue(row?.settlementId ?? row?.settlement_id),
  };
}

function normalizeSettlement(value: unknown): AdminSettlement | null {
  const row = recordValue(value);
  const id = stringValue(row?.id);
  const accountId = stringValue(row?.accountId ?? row?.account_id);
  const enrollmentId = stringValue(row?.enrollmentId ?? row?.enrollment_id);
  const currency = stringValue(row?.currency);
  const currencyExponent = exponentValue(row?.currencyExponent ?? row?.currency_exponent);
  const totalMinor = integerString(row?.totalMinor ?? row?.total_minor);
  const state = stringValue(row?.state);
  const createdAt = timestampValue(row?.createdAt ?? row?.created_at);
  const rawEntryIds = row?.earningEntryIds ?? row?.earning_entry_ids;

  if (
    !id || !accountId || !enrollmentId || !currency || currencyExponent === null ||
    !totalMinor || !createdAt ||
    !["pending", "approved", "paid", "reconciled"].includes(state ?? "") ||
    !Array.isArray(rawEntryIds)
  ) return null;

  return {
    id,
    accountId,
    enrollmentId,
    currency,
    currencyExponent,
    totalMinor,
    state: state as AdminSettlementState,
    periodStart: dateValue(row?.periodStart ?? row?.period_start),
    periodEnd: dateValue(row?.periodEnd ?? row?.period_end),
    payoutProvider: stringValue(row?.payoutProvider ?? row?.payout_provider),
    externalPayoutId: stringValue(row?.externalPayoutId ?? row?.external_payout_id),
    approvedAt: timestampValue(row?.approvedAt ?? row?.approved_at),
    paidAt: timestampValue(row?.paidAt ?? row?.paid_at),
    reconciledAt: timestampValue(row?.reconciledAt ?? row?.reconciled_at),
    createdAt,
    earningEntryIds: rawEntryIds.flatMap((candidate) => {
      const idValue = stringValue(candidate);
      return idValue ? [idValue] : [];
    }),
  };
}

export function normalizeAdminFinanceLedger(value: unknown): AdminFinanceLedger | null {
  const root = firstRecord(value);
  if (!root || !Array.isArray(root.entries) || !Array.isArray(root.settlements)) return null;

  const entries: AdminEarningEntry[] = [];
  for (const candidate of root.entries) {
    const entry = normalizeEarning(candidate);
    if (!entry) return null;
    entries.push(entry);
  }
  const settlements: AdminSettlement[] = [];
  for (const candidate of root.settlements) {
    const settlement = normalizeSettlement(candidate);
    if (!settlement) return null;
    settlements.push(settlement);
  }

  return {
    entries,
    settlements,
  };
}

function boundedLimit(value: number, fallback: number, maximum: number) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

export async function getAdminContentQueue(limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_content_queue", {
    result_limit: boundedLimit(limit, 100, 500),
  });
  if (error) throw new Error("Could not load the content review queue.", { cause: error });
  const queue = normalizeAdminContentQueue(data);
  if (!queue) throw new Error("The content review queue returned invalid data.");
  return queue;
}

export async function getAdminFinanceLedger(limit = 250) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_finance_ledger", {
    result_limit: boundedLimit(limit, 250, 1000),
  });
  if (error) throw new Error("Could not load the finance ledger.", { cause: error });
  const ledger = normalizeAdminFinanceLedger(data);
  if (!ledger) throw new Error("The finance ledger returned invalid data.");
  return ledger;
}
