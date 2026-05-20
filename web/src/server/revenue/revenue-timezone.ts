export const REVENUE_REPORT_TIME_ZONE = "UTC";
export const SNAPCHAT_REVENUE_TIME_ZONE = "America/Los_Angeles";

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    year: Number(parts.year),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function getUtcInstantForZonedDateStart(date: string, timeZone: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const firstUtc = utcGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(firstUtc), timeZone);

  return new Date(utcGuess - secondOffset);
}

export function getUtcDateForProviderDate(args: {
  date: string;
  providerTimeZone: string;
}) {
  if (args.providerTimeZone === REVENUE_REPORT_TIME_ZONE) {
    return args.date;
  }

  const utcStart = getUtcInstantForZonedDateStart(
    args.date,
    args.providerTimeZone,
  );

  return utcStart?.toISOString().slice(0, 10) ?? args.date;
}

export function getSingularSourceTimeZone(label: string | null) {
  const normalized = (label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ");

  return normalized.includes("snapchat") || normalized.includes("snap")
    ? SNAPCHAT_REVENUE_TIME_ZONE
    : REVENUE_REPORT_TIME_ZONE;
}
