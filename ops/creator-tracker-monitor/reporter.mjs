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
const AUTOPILOT_HEALTH_PATH = process.env.CREATOR_TRACKER_AUTOPILOT_HEALTH_PATH
  ?? "/var/lib/creator-tracker-autopilot-health/status.json";
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
const MAX_HEARTBEAT_ISSUE_CODES = 32;
export const AUTOPILOT_HEALTH_MAX_AGE_SECONDS = 15 * 60;

export const requiredUnits = [
  "creator-tracker-worker.service",
  "creator-tracker-autopilot.timer",
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

export function boundIssueCodes(codes) {
  const unique = new Set(Array.isArray(codes) ? codes : []);
  const valid = [...unique]
    .filter((code) => typeof code === "string" && safeIssueCode(code))
    .filter((code) => code !== "issue_codes_truncated")
    .sort();
  const needsMarker = valid.length !== unique.size || valid.length > MAX_HEARTBEAT_ISSUE_CODES;
  if (!needsMarker) return valid;
  return [
    ...valid.slice(0, MAX_HEARTBEAT_ISSUE_CODES - 1),
    "issue_codes_truncated",
  ].sort();
}

const autopilotReasonCodes = new Set([
  "autopilot_incident_confirmed",
  "autopilot_incident_pending",
  "autopilot_integrity_failure",
  "autopilot_maintenance",
  "autopilot_operator_required",
]);

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

export function parseAutopilotHealth(text) {
  if (typeof text !== "string") return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value == null || Array.isArray(value) || typeof value !== "object") return null;
  const keys = Object.keys(value).sort();
  if (keys.join("\n") !== [
    "format_version",
    "health",
    "observed_at_epoch",
    "reason_codes",
  ].join("\n")) return null;
  if (value.format_version !== 1) return null;
  if (!Number.isSafeInteger(value.observed_at_epoch) || value.observed_at_epoch <= 0) {
    return null;
  }
  if (!["healthy", "degraded", "failing"].includes(value.health)) return null;
  if (
    !Array.isArray(value.reason_codes) ||
    value.reason_codes.length > 1 ||
    value.reason_codes.some((code) => typeof code !== "string" || !autopilotReasonCodes.has(code)) ||
    new Set(value.reason_codes).size !== value.reason_codes.length
  ) return null;
  if ((value.health === "healthy") !== (value.reason_codes.length === 0)) return null;
  return {
    observedAtEpoch: value.observed_at_epoch,
    status: value.health,
    issueCodes: [...value.reason_codes],
  };
}

export function evaluateAutopilotHealth(text, nowEpochSeconds) {
  if (text == null) {
    return { status: "failing", issueCodes: ["autopilot_health_missing"] };
  }
  const health = parseAutopilotHealth(text);
  if (
    health == null ||
    !Number.isSafeInteger(nowEpochSeconds) ||
    health.observedAtEpoch > nowEpochSeconds + 60
  ) {
    return { status: "failing", issueCodes: ["autopilot_health_invalid"] };
  }
  if (nowEpochSeconds - health.observedAtEpoch >= AUTOPILOT_HEALTH_MAX_AGE_SECONDS) {
    return { status: "failing", issueCodes: ["autopilot_health_stale"] };
  }
  return { status: health.status, issueCodes: health.issueCodes };
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
    const stateIsHealthy = job === "collector-worker"
      ? status.state === "running"
      : ["succeeded", "starting", "running"].includes(status.state);
    if (!stateIsHealthy) failing.add(`${code}_failed`);
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
  const imminentUncovered = nonnegativeInteger(
    metrics.first_week_targets_imminent_uncovered,
  );
  if (imminentUncovered == null) {
    issues.add("first_week_targets_imminent_uncovered_invalid");
  } else if (imminentUncovered > 0) {
    issues.add("first_week_target_imminent_uncovered");
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

const coverageSnapshotContentionSignatures = [
  "ReadOnlySnapshotConcurrentMutationError: Read-only database snapshot source changed while it was captured.",
  "ReadOnlySnapshotUncheckpointedWalError: Read-only database snapshots require a fully checkpointed database.",
];

function isCoverageSnapshotContention(status, stderr) {
  if (status !== 1 || stderr === "") return false;
  const lines = stderr.split(/\r?\n/);
  const signatureIndexes = lines.flatMap((line, index) =>
    coverageSnapshotContentionSignatures.includes(line) ? [index] : [],
  );
  if (signatureIndexes.length !== 1) return false;
  const signatureIndex = signatureIndexes[0];
  if (lines.length === 1) return true;

  const prefix = lines.slice(0, signatureIndex);
  while (prefix.at(-1) === "") prefix.pop();
  if (
    prefix.length !== 0 &&
    !(
      prefix.length === 3 &&
      /^(?:\[eval\]|(?:file:\/\/)?\/|node:).+:\d+(?::\d+)?$/.test(prefix[0]) &&
      prefix[1].length > 0 &&
      prefix[1].length <= 8_192 &&
      /^\s*\^~*\s*$/.test(prefix[2])
    )
  ) {
    return false;
  }

  const suffix = lines.slice(signatureIndex + 1);
  while (suffix[0] === "") suffix.shift();
  while (suffix.at(-1) === "") suffix.pop();
  if (!/^Node\.js v\d+\.\d+\.\d+$/.test(suffix.at(-1) ?? "")) return false;
  suffix.pop();
  while (suffix.at(-1) === "") suffix.pop();
  return suffix.length > 0 && suffix.every((line) => /^\s{4}at .+$/.test(line));
}

export function evaluateCoverageProbeResult(result) {
  if (result?.error || result?.signal) {
    return { status: "failing", issueCodes: ["coverage_probe_failed"] };
  }
  const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : "";
  const snapshotContended = isCoverageSnapshotContention(result?.status, stderr);
  const metrics = parseCoverageMetrics(result?.stdout);
  if (metrics != null) {
    const issueCodes = evaluateCoverageMetrics(metrics);
    const unexpectedRuntimeFailure =
      ![0, 1].includes(result?.status) || (stderr !== "" && !snapshotContended);
    if (unexpectedRuntimeFailure) {
      return {
        status: "failing",
        issueCodes: [...new Set([...issueCodes, "coverage_probe_failed"])].sort(),
      };
    }
    if (issueCodes.length === 0 && snapshotContended) {
      return {
        status: "degraded",
        issueCodes: ["coverage_probe_snapshot_contended"],
      };
    }
    return {
      status: issueCodes.length > 0 ? "failing" : "healthy",
      issueCodes,
    };
  }
  if (result?.status !== 0 && snapshotContended) {
    return {
      status: "degraded",
      issueCodes: ["coverage_probe_snapshot_contended"],
    };
  }
  if (stderr !== "") {
    return { status: "failing", issueCodes: ["coverage_probe_failed"] };
  }
  return { status: "failing", issueCodes: ["coverage_probe_invalid"] };
}

function collectCriticalCoverage() {
  const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
  if (!credentialDirectory?.startsWith("/run/credentials/")) {
    return { status: "failing", issueCodes: ["coverage_probe_credentials_missing"] };
  }
  const result = spawnSync(COVERAGE_COMMAND, [], {
    encoding: "utf8",
    env: { CREDENTIALS_DIRECTORY: credentialDirectory },
    maxBuffer: 1024 * 1024,
    timeout: COVERAGE_TIMEOUT_MS,
  });
  return evaluateCoverageProbeResult(result);
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

function unitIsEnabled(unit) {
  return spawnSync("/usr/bin/systemctl", ["is-enabled", "--quiet", unit], {
    stdio: "ignore",
    timeout: 5_000,
  }).status === 0;
}

export function evaluateUnitStates(states) {
  const issues = [];
  for (const unit of requiredUnits) {
    const suffix = unit.replaceAll(/[.-]/g, "_");
    if (states[unit]?.active !== true) issues.push(`unit_inactive_${suffix}`);
    if (states[unit]?.enabled !== true) issues.push(`unit_disabled_${suffix}`);
  }
  return issues.sort();
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
  const nowEpochSeconds = Math.floor(Date.now() / 1_000);
  const statuses = Object.create(null);
  const [, autopilotText] = await Promise.all([
    Promise.all(jobs.map(async (job) => {
      statuses[job] = parseStatus(await optionalText(`${TRACKER_STATE_ROOT}/${job}/status`));
    })),
    optionalText(AUTOPILOT_HEALTH_PATH),
  ]);
  const health = evaluateStatusFiles(statuses, nowEpochSeconds);
  const unitStates = Object.fromEntries(requiredUnits.map((unit) => [unit, {
    active: unitIsActive(unit),
    enabled: unitIsEnabled(unit),
  }]));
  const unitIssues = evaluateUnitStates(unitStates);
  if (unitIssues.length > 0) {
    health.status = "failing";
    health.issueCodes.push(...unitIssues);
  }
  const autopilotHealth = evaluateAutopilotHealth(autopilotText, nowEpochSeconds);
  if (autopilotHealth.status === "failing") {
    health.status = "failing";
  } else if (autopilotHealth.status === "degraded" && health.status === "healthy") {
    health.status = "degraded";
  }
  health.issueCodes.push(...autopilotHealth.issueCodes);
  const criticalCoverage = collectCriticalCoverage();
  if (criticalCoverage.status === "failing") {
    health.status = "failing";
  } else if (criticalCoverage.status === "degraded" && health.status === "healthy") {
    health.status = "degraded";
  }
  health.issueCodes.push(...criticalCoverage.issueCodes);
  health.issueCodes = boundIssueCodes(health.issueCodes);
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
