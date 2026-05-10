export type RevenueSourceKind = "tiktok" | "apple" | "paid" | "organic";

export function splitCommaSeparatedList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesSourceLabel(label: string | null, patterns: readonly string[]) {
  if (!label) {
    return false;
  }

  const normalizedLabel = normalizeMatchText(label);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizeMatchText(pattern);
    return normalizedPattern.length > 0 && normalizedLabel.includes(normalizedPattern);
  });
}

export function isTikTokLabel(label: string | null, patterns: readonly string[]) {
  return matchesSourceLabel(label, patterns);
}

export function isAppleAdsLabel(label: string | null, patterns: readonly string[]) {
  return matchesSourceLabel(label, patterns);
}

export function isCreatorSourceLabel(
  label: string | null,
  patterns: readonly string[],
) {
  return matchesSourceLabel(label, patterns);
}

export function isUnattributedLabel(label: string | null) {
  if (!label) {
    return true;
  }

  const normalized = normalizeMatchText(label);
  return (
    normalized.length === 0 ||
    ["unknown", "not set", "none", "null", "n a", "organic"].includes(normalized)
  );
}

export function isOrganicSingularLabel(
  label: string | null,
  creatorPatterns: readonly string[],
) {
  if (!label) {
    return true;
  }

  const normalized = normalizeMatchText(label);
  return (
    isUnattributedLabel(label) ||
    isCreatorSourceLabel(label, creatorPatterns) ||
    [
      "organic",
      "unattributed",
      "unknown",
      "direct",
      "web",
      "none",
    ].includes(normalized)
  );
}

export function getRevenueSourceKind(args: {
  label: string | null;
  tiktokPatterns: readonly string[];
  applePatterns: readonly string[];
  creatorPatterns: readonly string[];
}): RevenueSourceKind {
  if (
    isUnattributedLabel(args.label) ||
    isCreatorSourceLabel(args.label, args.creatorPatterns)
  ) {
    return "organic";
  }

  if (isTikTokLabel(args.label, args.tiktokPatterns)) {
    return "tiktok";
  }

  if (isAppleAdsLabel(args.label, args.applePatterns)) {
    return "apple";
  }

  return "paid";
}
