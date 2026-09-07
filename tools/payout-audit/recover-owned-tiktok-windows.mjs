#!/usr/bin/env node

/**
 * Recover Viral.app view-in-period counters for TikTok IDs discovered by the
 * owned tracker but absent from the frozen August settlement inventory.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const RECONCILIATION_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/owned-tiktok-reconciliation.json",
);
const OUTPUT_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/owned-tiktok-window-recovery.json",
);
const CSV_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/owned-tiktok-window-recovery.csv",
);
const LIVE_CACHE_PATH = "/tmp/owned-tiktok-window-recovery-cache.json";
const PRIOR_CACHE_PATH = "/tmp/viral-window-live-cache.json";

function readEnvironment(name) {
  for (const envPath of [path.join(ROOT, "web/.env.local"), path.join(ROOT, "web/.env")]) {
    let text = "";
    try {
      text = readFileSync(envPath, "utf8");
    } catch {
      continue;
    }
    const match = text.match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
    if (match) return match[1];
  }
  throw new Error(`${name} is not configured`);
}

function readJsonOr(pathname, fallback) {
  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return fallback;
  }
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function windowFor(publishedDate) {
  const from = publishedDate < "2026-08-01" ? "2026-08-01" : publishedDate;
  const naturalEnd = addDays(publishedDate, 6);
  const to = naturalEnd < "2026-09-01" ? naturalEnd : "2026-08-31";
  return { from, to };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

async function main() {
  const reconciliation = JSON.parse(readFileSync(RECONCILIATION_PATH, "utf8"));
  const base = (() => {
    try {
      return readEnvironment("VIRAL_APP_BASE_URL");
    } catch {
      return readEnvironment("DATA_PROVIDER_BASE_URL");
    }
  })().replace(/\/$/, "");
  const apiKey = (() => {
    try {
      return readEnvironment("VIRAL_APP_API_KEY");
    } catch {
      return readEnvironment("DATA_PROVIDER_API_KEY");
    }
  })();
  const headers = { accept: "application/json", "x-api-key": apiKey };
  const priorCache = readJsonOr(PRIOR_CACHE_PATH, {});
  const liveCache = readJsonOr(LIVE_CACHE_PATH, {});
  const groups = new Map();
  for (const candidate of reconciliation.candidates) {
    if (!candidate.viralTrackedAccountId) continue;
    const window = windowFor(candidate.publishedDate);
    const key = ["tiktok", candidate.viralTrackedAccountId, window.from, window.to].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        platform: "tiktok",
        account: candidate.viralTrackedAccountId,
        ...window,
        response: null,
        source: null,
        error: null,
      });
    }
  }

  for (const group of groups.values()) {
    if (Array.isArray(liveCache[group.key])) {
      group.response = liveCache[group.key];
      group.source = "recovery-cache";
    } else if (Array.isArray(priorCache[group.key])) {
      group.response = priorCache[group.key];
      group.source = "prior-live-cache";
    }
  }

  const todo = [...groups.values()].filter((group) => group.response == null);
  let next = 0;
  let rateLimitUntil = 0;
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function fetchGroup(group) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (Date.now() < rateLimitUntil) {
        await sleep(rateLimitUntil - Date.now() + 250);
      }
      const url = new URL(`${base}/analytics/top-videos`);
      for (const [key, value] of Object.entries({
        platforms: "tiktok",
        viewMode: "internal",
        publicationMode: "allEligible",
        onlyPublished: "false",
        "dateRange[from]": group.from,
        "dateRange[to]": group.to,
        accounts: group.account,
        metric: "viewCountInPeriod",
        limit: "100",
      })) {
        url.searchParams.set(key, value);
      }
      const response = await fetch(url, { headers });
      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("retry-after")) || 60;
        rateLimitUntil = Math.max(rateLimitUntil, Date.now() + (retryAfterSeconds + 2) * 1_000);
        await response.text();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Viral.app ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      return response.json();
    }
    throw new Error("Viral.app rate-limit retries exhausted");
  }

  async function worker() {
    while (next < todo.length) {
      const group = todo[next];
      next += 1;
      try {
        group.response = await fetchGroup(group);
        group.source = "live";
        liveCache[group.key] = group.response;
        const temporary = `${LIVE_CACHE_PATH}.${process.pid}.${next}.tmp`;
        writeFileSync(temporary, JSON.stringify(liveCache));
        await import("node:fs/promises").then(({ rename }) => rename(temporary, LIVE_CACHE_PATH));
      } catch (error) {
        group.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  await Promise.all([worker(), worker()]);

  const rows = reconciliation.candidates.map((candidate) => {
    const window = windowFor(candidate.publishedDate);
    const key = ["tiktok", candidate.viralTrackedAccountId, window.from, window.to].join("|");
    const group = groups.get(key);
    if (!group || group.error || !Array.isArray(group.response)) {
      return {
        ...candidate,
        window: {
          ...window,
          status: "error",
          views: null,
          responseRows: null,
          source: group?.source ?? null,
          error: group?.error ?? "missing Viral.app account mapping or response",
        },
      };
    }
    const match = group.response.find(
      (item) => String(item.platformVideoId) === String(candidate.platformVideoId),
    );
    if (match) {
      return {
        ...candidate,
        window: {
          ...window,
          status: "found",
          views: Number(match.viewCountInPeriod ?? 0),
          responseRows: group.response.length,
          source: group.source,
          error: null,
        },
      };
    }
    return {
      ...candidate,
      window: {
        ...window,
        status: group.response.length < 100 ? "complete_zero" : "unresolved_top100",
        views: group.response.length < 100 ? 0 : null,
        responseRows: group.response.length,
        source: group.source,
        error: null,
      },
    };
  });

  const statusCounts = Object.fromEntries(
    Object.entries(
      rows.reduce((counts, row) => {
        counts[row.window.status] = (counts[row.window.status] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );
  const summary = {
    candidates: rows.length,
    groups: groups.size,
    groupsFetchedLive: [...groups.values()].filter((group) => group.source === "live").length,
    groupsFromRecoveryCache: [...groups.values()].filter(
      (group) => group.source === "recovery-cache",
    ).length,
    groupsFromPriorLiveCache: [...groups.values()].filter(
      (group) => group.source === "prior-live-cache",
    ).length,
    found: statusCounts.found ?? 0,
    completeZero: statusCounts.complete_zero ?? 0,
    unresolvedTop100: statusCounts.unresolved_top100 ?? 0,
    errors: statusCounts.error ?? 0,
    recoveredViews: rows.reduce((total, row) => total + Number(row.window.views ?? 0), 0),
  };
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceReconciliation: RECONCILIATION_PATH,
        methodology:
          "One Viral.app account and one clipped first-seven-day date window per query; fewer than 100 returned rows makes an absent stable TikTok ID a complete zero, while exactly 100 remains unresolved.",
        summary,
        statusCounts,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    CSV_PATH,
    toCsv([
      [
        "Creator",
        "Handle",
        "Published date",
        "TikTok video ID",
        "URL",
        "Window from",
        "Window to",
        "Recovery status",
        "Views in period",
        "Response rows",
        "Response source",
        "Explicit GoTall mention",
        "#yap",
        "Caption",
      ],
      ...rows.map((row) => [
        row.creator,
        row.handle,
        row.publishedDate,
        row.platformVideoId,
        row.url,
        row.window.from,
        row.window.to,
        row.window.status,
        row.window.views ?? "",
        row.window.responseRows ?? "",
        row.window.source ?? "",
        row.mentionsGoTall ? "yes" : "no",
        row.hasYap ? "yes" : "no",
        row.caption,
      ]),
    ]),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
