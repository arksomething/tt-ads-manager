export type DashboardSearchParamsLike = Record<
  string,
  string | string[] | undefined
>;

function getSearchParamValue(
  searchParams: DashboardSearchParamsLike,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDateOnlyDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toDateOnlyString(parsed);
}

export function getDateKeys(startDate: string, endDate: string) {
  const keys: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    keys.push(cursor);
    cursor = addDateOnlyDays(cursor, 1);
  }

  return keys;
}

export function getRevenueUgcPaySearchParams(args: {
  searchParams: DashboardSearchParamsLike;
  startDate: string;
  endDate: string;
}) {
  return {
    ...args.searchParams,
    endDate: args.endDate,
    globalViewWindowDays: "7",
    payMode: "gained",
    reportTimeZone: "UTC",
    startDate: args.startDate,
    videoWindowStartDate:
      getSearchParamValue(args.searchParams, "videoWindowStartDate") ??
      addDateOnlyDays(args.startDate, -6),
    viewWindowMode: "first-days",
  };
}
