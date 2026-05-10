export type ReportWarningSummary = {
  detailWarnings: string[];
  summaryWarnings: string[];
};

const tiktokPostRateLimitPattern =
  /^Could not resolve TikTok post (\d+) in viral\.app: Rate limit exceeded, please try again in ([^()]+)(?: \(([^)]+)\))?\.$/;

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
