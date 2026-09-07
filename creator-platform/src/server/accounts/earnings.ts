import { createClient } from "@/lib/supabase/server";

export type EarningState = "estimated" | "pending" | "approved" | "paid" | "reconciled";
export type SettlementState = Exclude<EarningState, "estimated">;

export type CreatorEarningEntry = {
  id: string;
  postId: string | null;
  category: string;
  currency: string;
  currencyExponent: number;
  amountMinor: string;
  state: EarningState;
  periodStart: string | null;
  periodEnd: string | null;
  earnedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  reconciledAt: string | null;
};

export type CreatorSettlement = {
  id: string;
  currency: string;
  currencyExponent: number;
  totalMinor: string;
  state: SettlementState;
  periodStart: string | null;
  periodEnd: string | null;
  payoutProvider: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  reconciledAt: string | null;
  createdAt: string;
};

export type CreatorEarningsWorkspace = {
  entries: CreatorEarningEntry[];
  settlements: CreatorSettlement[];
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exponentValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4
    ? value
    : null;
}

function amountValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && /^-?\d+$/u.test(candidate) ? candidate : null;
}

function normalizeEntries(value: unknown): CreatorEarningEntry[] | null {
  if (!Array.isArray(value)) return null;
  const validStates = new Set<EarningState>([
    "estimated",
    "pending",
    "approved",
    "paid",
    "reconciled",
  ]);

  const entries: CreatorEarningEntry[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const id = stringValue(row?.id);
    const category = stringValue(row?.category);
    const currency = stringValue(row?.currency);
    const currencyExponent = exponentValue(row?.currencyExponent ?? row?.currency_exponent);
    const amountMinor = amountValue(row?.amountMinor ?? row?.amount_minor);
    const state = stringValue(row?.state) as EarningState | null;
    const earnedAt = stringValue(row?.earnedAt ?? row?.earned_at);

    if (
      !id || !category || !currency || currencyExponent === null || !amountMinor ||
      !state || !validStates.has(state) || !earnedAt
    ) return null;

    entries.push({
      id,
      postId: stringValue(row?.postId ?? row?.post_id),
      category,
      currency,
      currencyExponent,
      amountMinor,
      state,
      periodStart: stringValue(row?.periodStart ?? row?.period_start),
      periodEnd: stringValue(row?.periodEnd ?? row?.period_end),
      earnedAt,
      approvedAt: stringValue(row?.approvedAt ?? row?.approved_at),
      paidAt: stringValue(row?.paidAt ?? row?.paid_at),
      reconciledAt: stringValue(row?.reconciledAt ?? row?.reconciled_at),
    });
  }
  return entries;
}

function normalizeSettlements(value: unknown): CreatorSettlement[] | null {
  if (!Array.isArray(value)) return null;
  const validStates = new Set<SettlementState>(["pending", "approved", "paid", "reconciled"]);

  const settlements: CreatorSettlement[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const id = stringValue(row?.id);
    const currency = stringValue(row?.currency);
    const currencyExponent = exponentValue(row?.currencyExponent ?? row?.currency_exponent);
    const totalMinor = amountValue(row?.totalMinor ?? row?.total_minor);
    const state = stringValue(row?.state) as SettlementState | null;
    const createdAt = stringValue(row?.createdAt ?? row?.created_at);

    if (
      !id || !currency || currencyExponent === null || !totalMinor ||
      !state || !validStates.has(state) || !createdAt
    ) return null;

    settlements.push({
      id,
      currency,
      currencyExponent,
      totalMinor,
      state,
      periodStart: stringValue(row?.periodStart ?? row?.period_start),
      periodEnd: stringValue(row?.periodEnd ?? row?.period_end),
      payoutProvider: stringValue(row?.payoutProvider ?? row?.payout_provider),
      approvedAt: stringValue(row?.approvedAt ?? row?.approved_at),
      paidAt: stringValue(row?.paidAt ?? row?.paid_at),
      reconciledAt: stringValue(row?.reconciledAt ?? row?.reconciled_at),
      createdAt,
    });
  }
  return settlements;
}

export function normalizeCreatorEarningsWorkspace(
  value: unknown,
): CreatorEarningsWorkspace | null {
  const row = recordValue(Array.isArray(value) ? value[0] : value);
  if (!row || !Array.isArray(row.entries) || !Array.isArray(row.settlements)) return null;
  const entries = normalizeEntries(row.entries);
  const settlements = normalizeSettlements(row.settlements);
  if (!entries || !settlements) return null;
  return {
    entries,
    settlements,
  };
}

export async function getOwnEarningsWorkspace() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_earnings_workspace");
  if (error) {
    throw new Error("Could not load the creator earnings workspace.", { cause: error });
  }

  const workspace = normalizeCreatorEarningsWorkspace(data);
  if (!workspace) throw new Error("The creator earnings workspace returned invalid data.");
  return workspace;
}

export function formatMinorUnits(
  amountMinor: string,
  currency: string,
  currencyExponent: number,
) {
  const amount = BigInt(amountMinor);
  const zero = BigInt(0);
  const sign = amount < zero ? "-" : "";
  const absolute = amount < zero ? -amount : amount;
  const divisor = BigInt(10) ** BigInt(currencyExponent);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const groupedWhole = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(whole);
  const decimal = currencyExponent > 0
    ? `.${fraction.toString().padStart(currencyExponent, "0")}`
    : "";
  return `${sign}${currency} ${groupedWhole}${decimal}`;
}
