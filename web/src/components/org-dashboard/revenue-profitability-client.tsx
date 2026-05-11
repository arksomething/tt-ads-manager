"use client";

import { useEffect, useMemo, useState } from "react";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import { type DashboardSearchParams } from "@/server/dashboard/filters";

type RevenueProfitabilityRow = {
  kind:
    | "operating-cost"
    | "operating-total"
    | "organic-cost"
    | "organic-total"
    | "paid"
    | "renewal";
  key: string;
  label: string;
  basis: string;
  proceeds: number | null;
  spend: number | null;
  profit: number | null;
  roas: number | null;
  margin: number | null;
};

type RevenueProfitabilityDailyRow = {
  date: string;
  facelessSpend: number;
  operatingSpend: number;
  proceeds: number;
  paidSpend: number | null;
  ugcSpend: number;
  totalSpend: number | null;
  profit: number | null;
  roas: number | null;
};

type RevenueProfitabilityData = {
  blendedRoas: number | null;
  currency: string | null;
  dailyRows: RevenueProfitabilityDailyRow[];
  facelessConfigured: boolean;
  facelessErrorMessage: string | null;
  facelessSpend: number;
  knownSpend: number;
  netProfit: number;
  operatingSpend: number;
  paidSourceSpend: number;
  rows: RevenueProfitabilityRow[];
  ugcSpend: number;
  unknownSpendLabels: string[];
};

type RevenueProfitabilityClientProps = {
  endDate: string;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
};

type LoadState =
  | {
      data: RevenueProfitabilityData;
      error: null;
      status: "ready";
    }
  | {
      data: null;
      error: string | null;
      status: "error" | "loading";
    };

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const cached = currencyFormatterCache.get(normalizedCurrency);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
    style: "currency",
  });

  currencyFormatterCache.set(normalizedCurrency, formatter);
  return formatter;
}

function formatAmount(value: number, currency: string | null) {
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    return getCurrencyFormatter(currency).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? percentFormatter.format(value)
    : "Unavailable";
}

function formatSignedAmount(value: number | null, currency: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const absoluteValue = formatAmount(Math.abs(value), currency);
  return value < 0 ? `-${absoluteValue}` : absoluteValue;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function appendSearchParams(
  params: URLSearchParams,
  searchParams: DashboardSearchParams,
) {
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
}

function StatCard(args: {
  icon: "payouts" | "integrations" | "creators" | "compare";
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <article className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {args.label}
        </p>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.75rem] border border-white/[0.08] bg-black/[0.22] text-muted-foreground">
          <DashboardIcon className="h-4 w-4" name={args.icon} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-medium tracking-[-0.045em] text-foreground">
        {args.value}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{args.meta}</p>
    </article>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[0.8rem] bg-white/[0.055] ${className}`}
    />
  );
}

function RevenueProfitabilitySkeleton() {
  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Profitability
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Proceeds matched to known spend
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Loading exact spend breakdown
        </p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4"
            key={index}
          >
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-4 h-7 w-32" />
            <SkeletonBlock className="mt-3 h-3 w-full" />
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonBlock className="h-10 w-full" key={index} />
        ))}
      </div>
    </section>
  );
}

function RevenueProfitabilityContent({
  data,
}: {
  data: RevenueProfitabilityData;
}) {
  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Profitability
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Proceeds matched to known spend
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Paid ad spend + UGC Pay owed + ViewsBase faceless spend + operating costs
        </p>
      </div>

      <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
        Paid channel spend uses Singular `adn_cost` when Singular returns it and
        Adapty Ads Manager for Apple Search Ads when dashboard auth is
        configured. UGC spend is loaded from exact daily UGC Pay queries using
        gained views and the first 7 days. Faceless spend uses ViewsBase&apos;s
        daily ledger total or projected price, whichever is higher. Operating
        costs are prorated by calendar day.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon="integrations"
          label="Known spend"
          meta={`${formatAmount(data.paidSourceSpend, data.currency)} ad + ${formatAmount(data.ugcSpend, data.currency)} UGC + ${formatAmount(data.facelessSpend, data.currency)} faceless + ${formatAmount(data.operatingSpend, data.currency)} ops`}
          value={formatAmount(data.knownSpend, data.currency)}
        />
        <StatCard
          icon="payouts"
          label="Net profit"
          meta="Total proceeds minus known spend"
          value={formatSignedAmount(data.netProfit, data.currency)}
        />
        <StatCard
          icon="compare"
          label="Blended ROAS"
          meta="Total proceeds / known spend"
          value={formatPercent(data.blendedRoas)}
        />
        <StatCard
          icon="integrations"
          label="Operating costs"
          meta="Monthly fixed costs prorated daily + Superwall 1%"
          value={formatAmount(data.operatingSpend, data.currency)}
        />
        <StatCard
          icon="creators"
          label="UGC owed"
          meta="Gained views, first 7 days"
          value={formatAmount(data.ugcSpend, data.currency)}
        />
      </div>

      {data.facelessErrorMessage ? (
        <div className="mt-4 rounded-[1.05rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-3 text-sm leading-6 text-[#FFEAB1]">
          ViewsBase faceless spend could not be loaded:{" "}
          {data.facelessErrorMessage}
        </div>
      ) : null}

      {data.unknownSpendLabels.length > 0 ? (
        <div className="mt-4 rounded-[1.05rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-3 text-sm leading-6 text-[#FFEAB1]">
          Spend is unavailable for {data.unknownSpendLabels.join(", ")} in this
          report, so those rows are excluded from known spend and profit.
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Channel
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Basis
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Proceeds
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Profit
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                ROAS
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Margin
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                className={
                  row.kind === "organic-cost" || row.kind === "operating-cost"
                    ? "bg-white/[0.015] text-muted-foreground"
                    : "text-foreground"
                }
                key={row.key}
              >
                <td className="border-b border-white/[0.06] px-3 py-3 font-medium">
                  {row.kind === "organic-cost" || row.kind === "operating-cost" ? (
                    <span className="pl-5 text-muted-foreground">
                      {row.label}
                    </span>
                  ) : (
                    row.label
                  )}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-muted-foreground">
                  {row.basis}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.proceeds === null
                    ? "Included above"
                    : formatAmount(row.proceeds, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.spend === null
                    ? "Unavailable"
                    : formatAmount(row.spend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.kind === "organic-cost" || row.kind === "operating-cost"
                    ? "Included above"
                    : formatSignedAmount(row.profit, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.kind === "organic-cost" || row.kind === "operating-cost"
                    ? "Included above"
                    : formatPercent(row.roas)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.kind === "organic-cost" || row.kind === "operating-cost"
                    ? "Included above"
                    : formatPercent(row.margin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Day
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Proceeds
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Singular spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                UGC owed
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Faceless
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Operating
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Known spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Profit
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                ROAS
              </th>
            </tr>
          </thead>
          <tbody>
            {data.dailyRows.map((row) => (
              <tr className="text-foreground" key={row.date}>
                <td className="border-b border-white/[0.06] px-3 py-3">
                  {formatDate(row.date)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {formatAmount(row.proceeds, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.paidSpend === null
                    ? "Unavailable"
                    : formatAmount(row.paidSpend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {formatAmount(row.ugcSpend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {formatAmount(row.facelessSpend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {formatAmount(row.operatingSpend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {row.totalSpend === null
                    ? "Unavailable"
                    : formatAmount(row.totalSpend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {formatSignedAmount(row.profit, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                  {formatPercent(row.roas)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RevenueProfitabilityClient({
  endDate,
  organizationSlug,
  searchParams,
  startDate,
}: RevenueProfitabilityClientProps) {
  const searchParamsKey = useMemo(
    () => JSON.stringify(searchParams),
    [searchParams],
  );
  const [state, setState] = useState<LoadState>({
    data: null,
    error: null,
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    appendSearchParams(params, searchParams);
    params.set("startDate", startDate);
    params.set("endDate", endDate);

    setState({
      data: null,
      error: null,
      status: "loading",
    });

    fetch(
      `/api/org/${encodeURIComponent(organizationSlug)}/revenue/profitability?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Could not load profitability data right now.",
          );
        }

        return payload as RevenueProfitabilityData;
      })
      .then((data) => {
        setState({
          data,
          error: null,
          status: "ready",
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not load profitability data right now.",
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [endDate, organizationSlug, searchParams, searchParamsKey, startDate]);

  if (state.status === "ready") {
    return <RevenueProfitabilityContent data={state.data} />;
  }

  if (state.status === "error") {
    return (
      <section className="rounded-[1.55rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-5 text-sm leading-6 text-[#FFEAB1]">
        Profitability data could not be loaded: {state.error}
      </section>
    );
  }

  return <RevenueProfitabilitySkeleton />;
}
