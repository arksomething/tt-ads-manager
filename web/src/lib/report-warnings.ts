export type ReportWarningSummary = {
  detailWarnings: string[];
  summaryWarnings: string[];
};

const tiktokPostRateLimitPattern =
  /^Could not resolve TikTok post (\d+) in viral\.app: Rate limit exceeded, please try again in ([^()]+)(?: \(([^)]+)\))?\.$/;
const singularIncompleteSpendPattern =
  /^Singular spend is incomplete for (.+); available spend is shown and profit may change when delayed cost rows arrive\.$/;
const unlinkedCreatorPattern =
  /^Could not associate (.+) with a local creator record, so paid TikTok delivery cannot be attributed to these View Tally rows\.$/;

function formatList(values: Iterable<string>) {
  const items = [...values];

  if (items.length <= 1) {
    return items[0] ?? "";
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function summarizeReportWarnings(
  warnings: readonly string[],
): ReportWarningSummary {
  const detailWarnings = [...warnings];
  const rateLimitedPostIds = new Set<string>();
  const retryAfterValues = new Set<string>();
  const retryTimestamps = new Set<string>();
  const summaryWarnings: string[] = [];

  for (const warning of warnings) {
    const match = warning.match(tiktokPostRateLimitPattern);

    if (!match) {
      summaryWarnings.push(warning);
      continue;
    }

    rateLimitedPostIds.add(match[1]);
    retryAfterValues.add(match[2].trim());

    if (match[3]) {
      retryTimestamps.add(match[3].trim());
    }
  }

  if (rateLimitedPostIds.size > 0) {
    const retryLabel =
      retryAfterValues.size === 1
        ? ` Retry in ${[...retryAfterValues][0]}.`
        : "";
    const timestampLabel =
      retryTimestamps.size === 1
        ? ` Last response: ${[...retryTimestamps][0]}.`
        : "";

    summaryWarnings.unshift(
      `viral.app rate-limited ${rateLimitedPostIds.size} TikTok post lookup${rateLimitedPostIds.size === 1 ? "" : "s"}.${retryLabel}${timestampLabel}`,
    );
  }

  return {
    detailWarnings,
    summaryWarnings,
  };
}

export function summarizeUgcStatusWarnings(warnings: readonly string[]) {
  const summaryWarnings: string[] = [];
  const seen = new Set<string>();
  const incompleteSingularSpendSources = new Set<string>();
  const unlinkedCreators = new Set<string>();
  let hasTikTokMatchingWarning = false;
  let hasViewTallyLimitWarning = false;

  function addWarning(warning: string) {
    if (seen.has(warning)) {
      return;
    }

    seen.add(warning);
    summaryWarnings.push(warning);
  }

  for (const warning of warnings) {
    const singularSpendMatch = warning.match(singularIncompleteSpendPattern);

    if (singularSpendMatch) {
      incompleteSingularSpendSources.add(singularSpendMatch[1]);
      continue;
    }

    const unlinkedCreatorMatch = warning.match(unlinkedCreatorPattern);

    if (unlinkedCreatorMatch) {
      unlinkedCreators.add(unlinkedCreatorMatch[1]);
      continue;
    }

    if (warning.startsWith("Revenue targets UTC.")) {
      addWarning(
        "Some Snapchat/Singular rows are Pacific-day aggregates mapped to UTC; exact UTC-day splitting would require hourly exports.",
      );
      continue;
    }

    if (
      warning.startsWith("Could not load TikTok ad metadata") ||
      /^TikTok returned \d+ ad groups without a resolvable TikTok post ID\./.test(
        warning,
      ) ||
      warning.startsWith("TikTok report rows did not include item_id") ||
      warning.startsWith("TikTok rejected the richer ad field set") ||
      warning.startsWith("No authorized Spark item IDs were found") ||
      warning.startsWith("TikTok exposed Spark item IDs") ||
      /^Singular matched \d+ unresolved TikTok ad groups by name/.test(
        warning,
      ) ||
      /^Singular lined up \d+ unresolved TikTok ad groups by TikTok ad ID\./.test(
        warning,
      ) ||
      warning.startsWith(
        "Singular could not line up the unresolved TikTok ad groups",
      )
    ) {
      hasTikTokMatchingWarning = true;
      continue;
    }

    if (warning.startsWith("View Tally returned 100 video rows")) {
      hasViewTallyLimitWarning = true;
      continue;
    }

    addWarning(warning);
  }

  if (incompleteSingularSpendSources.size > 0) {
    addWarning(
      `Singular spend is incomplete for ${formatList(incompleteSingularSpendSources)}; profit may change as delayed cost rows arrive.`,
    );
  }

  if (hasTikTokMatchingWarning) {
    addWarning(
      "TikTok paid-delivery matching is partial for this window; some ad groups lack exact post IDs or creative metadata, so per-video paid deductions may be incomplete.",
    );
  }

  if (unlinkedCreators.size > 0) {
    const creatorLabel =
      unlinkedCreators.size === 1
        ? formatList(unlinkedCreators)
        : `${unlinkedCreators.size} creators`;

    addWarning(
      `${creatorLabel} not linked to local creator records; paid TikTok delivery may not be attributed to those View Tally rows.`,
    );
  }

  if (hasViewTallyLimitWarning) {
    addWarning(
      "View Tally hit its 100-row response cap for part of this window; lower-view UGC rows may be missing.",
    );
  }

  return summaryWarnings;
}
