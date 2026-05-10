const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SHORT_PRIVATE_CACHE_CONTROL =
  "private, max-age=30, stale-while-revalidate=300";
export const NO_STORE_CACHE_CONTROL = "no-store";

function toUtcDateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
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

  const today = toUtcDateOnly(args.today);
  return args.startDate <= today && today <= args.endDate;
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
