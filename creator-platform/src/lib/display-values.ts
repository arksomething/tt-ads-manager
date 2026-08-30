export type DataFreshness = "fresh" | "stale" | "incomplete" | "unsupported";

export function formatObservedCount(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatObservedMoney(valueMinor: number | null | undefined) {
  if (valueMinor == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(valueMinor / 100);
}

export function describeFreshness(freshness: DataFreshness) {
  switch (freshness) {
    case "fresh":
      return "Tracking active";
    case "stale":
      return "Tracking is stale";
    case "incomplete":
      return "Tracking needs review";
    case "unsupported":
      return "Metric unavailable from this source";
  }
}
