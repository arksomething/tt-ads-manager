#!/usr/bin/env node

import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

export const HEARTBEAT_PATH = "/api/v1/creator-tracker/heartbeat";
export const MONITOR_ID = "creator-tracker-xps";
const STATE_ROOT = process.env.CREATOR_TRACKER_MONITOR_STATE_DIRECTORY
  ?? "/var/lib/creator-tracker-monitor";
const TRACKER_STATE_ROOT = process.env.CREATOR_TRACKER_STATE_DIRECTORY
  ?? "/var/lib/creator-tracker/state";
const SEQUENCE_PATH = `${STATE_ROOT}/sequence`;
const BOOT_ID_PATH = process.env.CREATOR_TRACKER_BOOT_ID_PATH
  ?? "/proc/sys/kernel/random/boot_id";
const CURRENT_RELEASE_PATH = process.env.CREATOR_TRACKER_CURRENT_RELEASE_PATH
  ?? "/opt/creator-tracker/current/RELEASE_ID";
const COVERAGE_COMMAND = process.env.CREATOR_TRACKER_COVERAGE_COMMAND
  ?? "/opt/creator-tracker/current/bin/check-coverage";
const REQUEST_TIMEOUT_MS = 10_000;
const COVERAGE_TIMEOUT_MS = 20_000;
const MAX_LATEST_TIKTOK_DIRECT_AGE_SECONDS = 3 * 60 * 60;

const requiredUnits = [
  "creator-tracker-worker.service",
  "creator-tracker-roster-refresh.timer",
  "creator-tracker-scheduler-tick.timer",
  "creator-tracker-instagram-discovery.timer",
  "creator-tracker-instagram-scheduler.timer",
  "creator-tracker-provider-reconcile.timer",
  "creator-tracker-canonical-delivery.timer",
  "creator-tracker-raw-verifier.timer",
  "creator-tracker-dashboard-health.timer",
];

function safeIssueCode(value) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

async function optionalText(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EACCES") return null;
    throw error;
  }
}

export function parseStatus(text) {
  if (typeof text !== "string") return null;
  const result = Object.create(null);
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  const updatedAtEpoch = Number(result.updated_at_epoch);
  if (result.format_version !== "1" || !Number.isSafeInteger(updatedAtEpoch)) {
    return null;
  }
  return { state: result.state ?? "", updatedAtEpoch };
}

export function evaluateStatusFiles(statuses, nowEpochSeconds) {
  const failing = new Set();
  const degraded = new Set();
  const checks = [
    ["collector-worker", 120, "worker"],
    ["scheduler-tick", 600, "scheduler"],
    ["instagram-scheduler", 600, "instagram_scheduler"],
    ["instagram-discovery", 5_400, "instagram_discovery"],
    ["provider-reconcile", 50_400, "provider_reconcile"],
    ["canonical-delivery", 600, "canonical_delivery"],
    ["raw-verifier", 900, "raw_verifier"],
  ];
  for (const [job, maximumAge, code] of checks) {
    const status = statuses[job];
    if (status == null) {
      failing.add(`${code}_missing`);
      continue;
    }
    if (nowEpochSeconds - status.updatedAtEpoch > maximumAge) {
      failing.add(`${code}_stale`);
    }
    const expectedState = job === "collector-worker" ? "running" : "succeeded";
    if (status.state !== expectedState) failing.add(`${code}_failed`);
  }
  const coverage = statuses["dashboard-health"];
  if (coverage == null) {
    degraded.add("coverage_status_missing");
  } else {
    if (nowEpochSeconds - coverage.updatedAtEpoch > 600) {
      degraded.add("coverage_status_stale");
    }
    if (coverage.state !== "succeeded") degraded.add("coverage_unhealthy");
  }
  return {
    status: failing.size > 0 ? "failing" : degraded.size > 0 ? "degraded" : "healthy",
    issueCodes: [...failing, ...degraded].filter(safeIssueCode).sort(),
  };
}

export function parseCoverageMetrics(text) {
  if (typeof text !== "string") return null;
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("[tracker coverage] "));
  if (!line) return null;
  const metrics = Object.create(null);
  for (const token of line.slice("[tracker coverage] ".length).split(/\s+/)) {
    const index = token.indexOf("=");
    if (index <= 0) continue;
    metrics[token.slice(0, index)] = token.slice(index + 1);
  }
  return metrics;
}

function nonnegativeInteger(value) {
  if (!/^\d+$/.test(value ?? "")) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function evaluateCoverageMetrics(metrics) {
  const issues = new Set();
  if (metrics == null) {
    issues.add("coverage_probe_invalid");
    return [...issues];
  }
  if (metrics.tiktok_profile_recovery !== "feasible") {
    issues.add("tiktok_profile_recovery_infeasible");
  }
  if (metrics.tiktok_target_capacity !== "feasible") {
    issues.add("tiktok_target_capacity_infeasible");
  }
  const clusteredMisses = nonnegativeInteger(
    metrics.tiktok_target_clustered_window_misses,
  );
  if (clusteredMisses == null) {
    issues.add("tiktok_target_clustered_window_misses_invalid");
  } else if (clusteredMisses > 0) {
    issues.add("tiktok_target_clustered_window_misses");
  }
  if (
    metrics.tiktok_fallback_mode === "auto" &&
    metrics.tiktok_fallback_readiness !== "ready"
  ) {
    issues.add("tiktok_paid_fallback_not_ready");
  }
  if (
    metrics.instagram_configured === "true" &&
    metrics.instagram_credit_status !== "ready"
  ) {
    issues.add("instagram_credit_guard_not_ready");
  }
  const missingStates = nonnegativeInteger(metrics.missing_states);
  if (missingStates == null) {
    issues.add("tracker_missing_states_invalid");
  } else if (missingStates > 0) {
    issues.add("tracker_missing_states");
  }
  const latestTikTokDirectAge = nonnegativeInteger(
    metrics.latest_tiktok_direct_age_seconds,
  );
  if (latestTikTokDirectAge == null) {
    issues.add("latest_tiktok_direct_age_invalid");
  } else if (latestTikTokDirectAge > MAX_LATEST_TIKTOK_DIRECT_AGE_SECONDS) {
    issues.add("latest_tiktok_direct_stale");
  }
  return [...issues].sort();
}

function collectCriticalCoverage() {
  const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
  if (!credentialDirectory?.startsWith("/run/credentials/")) {
    return ["coverage_probe_credentials_missing"];
  }
  const result = spawnSync(COVERAGE_COMMAND, [], {
    encoding: "utf8",
    env: { CREDENTIALS_DIRECTORY: credentialDirectory },
    maxBuffer: 1024 * 1024,
    timeout: COVERAGE_TIMEOUT_MS,
  });
  if (result.error || result.signal) return ["coverage_probe_failed"];
  return evaluateCoverageMetrics(parseCoverageMetrics(result.stdout));
}

export function canonicalHeartbeat({ timestamp, nonce, monitorId, body }) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return [
    "v1",
    timestamp,
    nonce,
    monitorId,
    "POST",
    HEARTBEAT_PATH,
    bodyHash,
  ].join("\n");
}

export function signHeartbeat(args, secret) {
  return `v1=${createHmac("sha256", secret)
    .update(canonicalHeartbeat(args))
    .digest("hex")}`;
}

export async function nextSequence(path = SEQUENCE_PATH) {
  let previous = 0;
  const existing = await optionalText(path);
  if (existing != null) {
    previous = Number(existing);
    if (!Number.isSafeInteger(previous) || previous < 0) {
      throw new Error("Monitor sequence state is invalid.");
    }
  }
  const next = previous + 1;
  if (!Number.isSafeInteger(next)) throw new Error("Monitor sequence overflowed.");
  const temporary = `${path}.tmp.${process.pid}`;
  await writeFile(temporary, `${next}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  return next;
}

function unitIsActive(unit) {
  return spawnSync("/usr/bin/systemctl", ["is-active", "--quiet", unit], {
    stdio: "ignore",
    timeout: 5_000,
  }).status === 0;
}

async function readMonitorSecret() {
  const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
  if (!credentialDirectory?.startsWith("/run/credentials/")) {
    throw new Error("Monitor credential directory is unavailable.");
  }
  const secret = (await readFile(`${credentialDirectory}/monitor-secret`, "utf8")).trim();
  if (Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 512) {
    throw new Error("Monitor secret must be 32..512 UTF-8 bytes.");
  }
  return secret;
}

async function collectHealth() {
  const jobs = [
    "collector-worker",
    "scheduler-tick",
    "instagram-scheduler",
    "instagram-discovery",
    "provider-reconcile",
    "canonical-delivery",
    "raw-verifier",
    "dashboard-health",
  ];
  const statuses = Object.create(null);
  await Promise.all(jobs.map(async (job) => {
    statuses[job] = parseStatus(await optionalText(`${TRACKER_STATE_ROOT}/${job}/status`));
  }));
  const health = evaluateStatusFiles(statuses, Math.floor(Date.now() / 1_000));
  for (const unit of requiredUnits) {
    if (!unitIsActive(unit)) {
      health.status = "failing";
      health.issueCodes.push(`unit_inactive_${unit.replaceAll(/[.-]/g, "_")}`);
    }
  }
  const criticalCoverageIssues = collectCriticalCoverage();
  if (criticalCoverageIssues.length > 0) {
    health.status = "failing";
    health.issueCodes.push(...criticalCoverageIssues);
  }
  health.issueCodes = [...new Set(health.issueCodes)].sort();
  return health;
}

async function main() {
  const endpoint = new URL(process.env.CREATOR_TRACKER_MONITOR_ENDPOINT ?? "");
  if (endpoint.protocol !== "https:" || endpoint.pathname !== HEARTBEAT_PATH || endpoint.search) {
    throw new Error(`Monitor endpoint must be HTTPS with exact path ${HEARTBEAT_PATH}.`);
  }
  const [secret, bootId, releaseId, sequence, health] = await Promise.all([
    readMonitorSecret(),
    optionalText(BOOT_ID_PATH),
    optionalText(CURRENT_RELEASE_PATH),
    nextSequence(),
    collectHealth(),
  ]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(bootId ?? "")) {
    throw new Error("Host boot ID is invalid.");
  }
  if (releaseId != null && !/^[A-Za-z0-9._:-]{1,128}$/.test(releaseId)) {
    throw new Error("Tracker release ID is invalid.");
  }
  const body = JSON.stringify({
    schemaVersion: 1,
    monitorId: MONITOR_ID,
    bootId,
    sequence,
    observedAt: new Date().toISOString(),
    status: health.status,
    issueCodes: health.issueCodes,
    releaseId,
  });
  if (Buffer.byteLength(body, "utf8") > 8_192) throw new Error("Heartbeat is too large.");
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomUUID();
  const signature = signHeartbeat({ timestamp, nonce, monitorId: MONITOR_ID, body }, secret);
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "x-gotall-monitor-id": MONITOR_ID,
      "x-gotall-monitor-timestamp": timestamp,
      "x-gotall-monitor-nonce": nonce,
      "x-gotall-monitor-signature": signature,
    },
    body,
  });
  if (!response.ok) throw new Error(`Heartbeat receiver returned HTTP ${response.status}.`);
  await response.body?.cancel();
  process.stdout.write(`creator-tracker-monitor: ${health.status}; ${health.issueCodes.length} issue(s); sequence=${sequence}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`creator-tracker-monitor: ${error instanceof Error ? error.message : "unknown failure"}\n`);
    process.exitCode = 1;
  });
}
