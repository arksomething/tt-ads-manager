#!/usr/bin/env node

/**
 * Resolve paid TikTok delivery for owned-tracker rows whose Viral.app
 * first-seven-day counters were recovered. This calls the same exact-post
 * attribution path used by the UGC Pay calculator.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getPaidViewsForSourceVideosForCreatorForOrganization } from "../../web/src/server/tiktok-business/reporting";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const INPUT = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/owned-tiktok-window-recovery.json",
);
const OUTPUT = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/owned-tiktok-paid-view-recovery.json",
);
const ORGANIZATION_ID = "org_public_tt_ads_manager";
const ORGANIZATION_SLUG = "gotall";

type RecoveryRow = {
  creatorId: string;
  platformVideoId: string;
  creator: string;
  handle: string;
  publishedDate: string;
  window: {
    from: string;
    to: string;
    status: string;
    views: number | null;
  };
};

async function main() {
  const recovery = JSON.parse(readFileSync(INPUT, "utf8")) as {
    rows: RecoveryRow[];
  };
  const groups = new Map<
    string,
    {
      creatorId: string;
      creator: string;
      from: string;
      to: string;
      sourceVideoIds: string[];
    }
  >();
  for (const row of recovery.rows) {
    if (row.window.status !== "found" || (row.window.views ?? 0) <= 0) continue;
    const key = `${row.creatorId}|${row.window.from}|${row.window.to}`;
    const group = groups.get(key) ?? {
      creatorId: row.creatorId,
      creator: row.creator,
      from: row.window.from,
      to: row.window.to,
      sourceVideoIds: [],
    };
    group.sourceVideoIds.push(row.platformVideoId);
    groups.set(key, group);
  }

  const results = [];
  let completed = 0;
  for (const group of groups.values()) {
    try {
      const result = await getPaidViewsForSourceVideosForCreatorForOrganization({
        organizationSlug: ORGANIZATION_SLUG,
        organizationId: ORGANIZATION_ID,
        creatorId: group.creatorId,
        sourceVideoIds: group.sourceVideoIds,
        startDate: group.from,
        endDate: group.to,
        metric: "impressions",
      });
      results.push({
        ...group,
        unresolvedPostBackedGroupCount: result.unresolvedPostBackedGroupCount,
        unresolvedNonPostBackedGroupCount: result.unresolvedNonPostBackedGroupCount,
        warnings: result.warnings,
        rows: result.rows,
        error: null,
      });
    } catch (error) {
      results.push({
        ...group,
        unresolvedPostBackedGroupCount: null,
        unresolvedNonPostBackedGroupCount: null,
        warnings: [],
        rows: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
    completed += 1;
    console.error(`paid-view groups ${completed}/${groups.size}`);
  }

  const rows = results.flatMap((result) =>
    result.rows.map((row) => ({
      creatorId: result.creatorId,
      creator: result.creator,
      windowFrom: result.from,
      windowTo: result.to,
      ...row,
    })),
  );
  const statusCounts = Object.fromEntries(
    Object.entries(
      rows.reduce<Record<string, number>>((counts, row) => {
        counts[row.paidStatus] = (counts[row.paidStatus] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );
  const output = {
    generatedAt: new Date().toISOString(),
    input: INPUT,
    methodology:
      "Same exact-post paid-impression resolver used by UGC Pay, grouped by creator and each video's clipped first-seven-day payout window.",
    summary: {
      groups: groups.size,
      completedGroups: results.filter((result) => result.error == null).length,
      failedGroups: results.filter((result) => result.error != null).length,
      videos: rows.length,
      paidViews: rows.reduce((total, row) => total + row.paidViews, 0),
      statusCounts,
      groupsWithWarnings: results.filter((result) => result.warnings.length > 0).length,
    },
    groups: results,
    rows,
  };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
