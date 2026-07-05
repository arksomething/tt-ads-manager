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

export function getDefaultUgcPayStartDateForEndDate(endDate: string) {
  return addDateOnlyDays(endDate, -6);
}
