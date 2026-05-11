const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SHORT_PRIVATE_CACHE_CONTROL =
  "private, max-age=30, stale-while-revalidate=300";
export const NO_STORE_CACHE_CONTROL = "no-store";

function toUtcDateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function toNewYorkDateOnly(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(value);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));

  return `${partMap.get("year")}-${partMap.get("month")}-${partMap.get("day")}`;
}

function getCurrentDateKeys(value = new Date()) {
  return [...new Set([toUtcDateOnly(value), toNewYorkDateOnly(value)])];
}

function isDateOnly(value: string | null | undefined): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function dateRangeIncludesToday(args: {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  today?: Date;
  missingDateIncludesToday?: boolean;
}) {
  if (!isDateOnly(args.startDate) || !isDateOnly(args.endDate)) {
    return args.missingDateIncludesToday ?? false;
  }

  const { endDate, startDate } = args;
  return getCurrentDateKeys(args.today).some(
    (today) => startDate <= today && today <= endDate,
  );
}

export function getDateRangeCacheControl(args: {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  today?: Date;
  missingDateIncludesToday?: boolean;
}) {
  return dateRangeIncludesToday(args)
    ? NO_STORE_CACHE_CONTROL
    : SHORT_PRIVATE_CACHE_CONTROL;
}

export function getDateRangeCacheHeaders(args: {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  today?: Date;
  missingDateIncludesToday?: boolean;
}) {
  return {
    "Cache-Control": getDateRangeCacheControl(args),
  };
}
