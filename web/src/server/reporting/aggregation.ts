import type {
  CanonicalCurrentDayFacts,
  CanonicalDailyFact,
  CanonicalFactDimensions,
  CanonicalFreshness,
  CanonicalMetricKey,
  CanonicalMetricTotal,
  CanonicalRangeAggregation,
  CanonicalSourceBreakdown,
  CanonicalSourceProvenance,
} from "./types";

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function getCanonicalDateKeys(startDate: string, endDate: string) {
  const keys: string[] = [];
  const cursor = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!cursor || !end || cursor > end) {
    return keys;
  }

  while (cursor <= end) {
    keys.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

export function normalizeCanonicalWarnings(warnings: readonly string[]) {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
}

function normalizeNumber(value: number) {
  return Number(Number(value).toFixed(10));
}

function dimensionsKey(dimensions: CanonicalFactDimensions | undefined) {
  const entries = Object.entries(dimensions ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return JSON.stringify(entries);
}

function getFactGroupKey(fact: CanonicalDailyFact) {
  return [
    fact.metricKey,
    fact.unit,
    fact.currency ?? "",
  ].join("\u001f");
}

function getBreakdownKey(fact: CanonicalDailyFact) {
  return [
    getFactGroupKey(fact),
    fact.source ?? "",
    fact.bucket ?? "",
    dimensionsKey(fact.dimensions),
  ].join("\u001f");
}

function compareMetricTotals(left: CanonicalMetricTotal, right: CanonicalMetricTotal) {
  return (
    left.metricKey.localeCompare(right.metricKey) ||
    (left.currency ?? "").localeCompare(right.currency ?? "")
  );
}

function compareBreakdowns(
  left: CanonicalSourceBreakdown,
  right: CanonicalSourceBreakdown,
) {
  return (
    (left.source ?? "").localeCompare(right.source ?? "") ||
    (left.bucket ?? "").localeCompare(right.bucket ?? "") ||
    dimensionsKey(left.dimensions).localeCompare(dimensionsKey(right.dimensions))
  );
}

function mergeProvenance(
  left: readonly CanonicalSourceProvenance[],
  right: readonly CanonicalSourceProvenance[],
) {
  const seen = new Set<string>();
  const merged: CanonicalSourceProvenance[] = [];

  for (const item of [...left, ...right]) {
    const key = JSON.stringify({
      cacheKey: item.cacheKey ?? null,
      exportedAt: item.exportedAt ?? null,
      generatedAt: item.generatedAt ?? null,
      provider: item.provider,
      providerReportId: item.providerReportId ?? null,
      requestedRange: item.requestedRange ?? null,
      rowCount: item.rowCount ?? null,
      status: item.status,
      warnings: normalizeCanonicalWarnings(item.warnings),
    });

    if (!seen.has(key)) {
      seen.add(key);
      merged.push({
        ...item,
        warnings: normalizeCanonicalWarnings(item.warnings),
      });
    }
  }

  return merged;
}

export function getCanonicalFreshness(
  states: readonly CanonicalFreshness[],
): CanonicalFreshness {
  if (states.includes("incomplete")) {
    return "incomplete";
  }

  if (states.includes("stale")) {
    return "stale";
  }

  if (states.length > 0 && states.every((state) => state === "superseded")) {
    return "superseded";
  }

  return "fresh";
}

export function aggregateCanonicalFactsByMetric(
  facts: readonly CanonicalDailyFact[],
) {
  const totals = new Map<string, CanonicalMetricTotal>();
  const breakdownsByTotal = new Map<string, Map<string, CanonicalSourceBreakdown>>();

  for (const fact of facts) {
    const totalKey = getFactGroupKey(fact);
    const existingTotal =
      totals.get(totalKey) ??
      ({
        currency: fact.currency ?? null,
        metricKey: fact.metricKey,
        sourceBreakdown: [],
        unit: fact.unit,
        value: 0,
      } satisfies CanonicalMetricTotal);
    existingTotal.value = normalizeNumber(existingTotal.value + fact.value);
    totals.set(totalKey, existingTotal);

    const breakdownKey = getBreakdownKey(fact);
    const breakdowns =
      breakdownsByTotal.get(totalKey) ??
      new Map<string, CanonicalSourceBreakdown>();
    const existingBreakdown =
      breakdowns.get(breakdownKey) ??
      ({
        bucket: fact.bucket ?? null,
        currency: fact.currency ?? null,
        days: [],
        dimensions: fact.dimensions ?? {},
        metricKey: fact.metricKey,
        provenance: [],
        source: fact.source ?? null,
        unit: fact.unit,
        value: 0,
        warnings: [],
      } satisfies CanonicalSourceBreakdown);

    existingBreakdown.value = normalizeNumber(existingBreakdown.value + fact.value);
    existingBreakdown.days = [...new Set([...existingBreakdown.days, fact.reportDate])].sort();
    existingBreakdown.provenance = mergeProvenance(
      existingBreakdown.provenance,
      fact.provenance,
    );
    existingBreakdown.warnings = normalizeCanonicalWarnings([
      ...existingBreakdown.warnings,
      ...fact.provenance.flatMap((source) => source.warnings),
    ]);
    breakdowns.set(breakdownKey, existingBreakdown);
    breakdownsByTotal.set(totalKey, breakdowns);
  }

  for (const [totalKey, total] of totals) {
    total.sourceBreakdown = [
      ...(breakdownsByTotal.get(totalKey)?.values() ?? []),
    ].sort(compareBreakdowns);
  }

  return [...totals.values()].sort(compareMetricTotals);
}

export function aggregateCurrentDailyFacts(args: {
  organizationId: string;
  startDate: string;
  endDate: string;
  days: readonly CanonicalCurrentDayFacts[];
}): CanonicalRangeAggregation {
  const expectedDates = getCanonicalDateKeys(args.startDate, args.endDate);
  const daysByDate = new Map(
    args.days.map((day) => [day.reportDate, day] as const),
  );
  const includedDays = expectedDates
    .map((date) => daysByDate.get(date))
    .filter((day): day is CanonicalCurrentDayFacts => Boolean(day));
  const missingDays = expectedDates.filter((date) => !daysByDate.has(date));
  const facts = includedDays.flatMap((day) => day.version.facts);
  const incompleteDays = includedDays
    .filter(
      (day) =>
        day.version.freshness === "incomplete" ||
        day.version.status === "incomplete" ||
        day.version.status === "failed",
    )
    .map((day) => day.reportDate);
  const staleDays = includedDays
    .filter((day) => day.version.freshness === "stale")
    .map((day) => day.reportDate);
  const sourceStatuses = mergeProvenance(
    [],
    includedDays.flatMap((day) => day.version.sourceState),
  );
  const warnings = normalizeCanonicalWarnings([
    ...includedDays.flatMap((day) => day.version.warnings),
    ...sourceStatuses.flatMap((source) => source.warnings),
    ...missingDays.map((date) => `No current canonical day version exists for ${date}.`),
  ]);

  return {
    freshness: getCanonicalFreshness([
      ...includedDays.map((day) => day.version.freshness),
      ...(missingDays.length > 0 ? (["incomplete"] as const) : []),
    ]),
    includedDayVersions: includedDays.map((day) => ({
      freshness: day.version.freshness,
      reportDate: day.reportDate,
      status: day.version.status,
      version: day.version.version,
    })),
    incompleteDays: [...incompleteDays, ...missingDays],
    missingDays,
    organizationId: args.organizationId,
    requestedRange: {
      endDate: args.endDate,
      startDate: args.startDate,
    },
    sourceStatuses,
    staleDays,
    totals: aggregateCanonicalFactsByMetric(facts),
    warnings,
  };
}

export function getMetricTotal(
  aggregation: CanonicalRangeAggregation,
  metricKey: CanonicalMetricKey,
) {
  return aggregation.totals.find((total) => total.metricKey === metricKey) ?? null;
}
