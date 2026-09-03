import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalHeartbeat,
  evaluateCoverageMetrics,
  evaluateStatusFiles,
  nextSequence,
  parseCoverageMetrics,
  parseStatus,
  signHeartbeat,
} from "../reporter.mjs";

test("signing is deterministic over the exact body", () => {
  const args = {
    timestamp: "1788420000",
    nonce: "123e4567-e89b-42d3-a456-426614174000",
    monitorId: "creator-tracker-xps",
    body: '{"schemaVersion":1}',
  };
  assert.equal(canonicalHeartbeat(args).split("\n").length, 7);
  assert.match(signHeartbeat(args, "x".repeat(32)), /^v1=[0-9a-f]{64}$/);
  assert.notEqual(
    signHeartbeat(args, "x".repeat(32)),
    signHeartbeat({ ...args, body: `${args.body} ` }, "x".repeat(32)),
  );
});

test("status parsing and health keep coverage separate from runtime", () => {
  const now = 2_000;
  const good = (state = "succeeded") => ({ state, updatedAtEpoch: now - 10 });
  const statuses = {
    "collector-worker": good("running"),
    "scheduler-tick": good(),
    "instagram-scheduler": good(),
    "instagram-discovery": good(),
    "provider-reconcile": good(),
    "canonical-delivery": good(),
    "raw-verifier": good(),
    "dashboard-health": good("failed"),
  };
  assert.deepEqual(evaluateStatusFiles(statuses, now), {
    status: "degraded",
    issueCodes: ["coverage_unhealthy"],
  });
  statuses["scheduler-tick"] = { state: "failed", updatedAtEpoch: now - 700 };
  const failed = evaluateStatusFiles(statuses, now);
  assert.equal(failed.status, "failing");
  assert.ok(failed.issueCodes.includes("scheduler_failed"));
  assert.ok(failed.issueCodes.includes("scheduler_stale"));
  assert.deepEqual(parseStatus("format_version=1\nstate=running\nupdated_at_epoch=123\n"), {
    state: "running",
    updatedAtEpoch: 123,
  });
});

test("sequence persists monotonically", async () => {
  const root = await mkdtemp(join(tmpdir(), "creator-tracker-monitor-test-"));
  const path = join(root, "sequence");
  assert.equal(await nextSequence(path), 1);
  assert.equal(await nextSequence(path), 2);
  assert.equal(await readFile(path, "utf8"), "2\n");
});

test("coverage capacity and provider safety faults are paging failures", () => {
  const metrics = parseCoverageMetrics(
    "[tracker coverage] tiktok_profile_recovery=feasible " +
      "tiktok_target_capacity=infeasible " +
      "tiktok_target_clustered_window_misses=2 " +
      "tiktok_fallback_mode=auto tiktok_fallback_readiness=provider_telemetry_missing " +
      "instagram_configured=true instagram_credit_status=provider_telemetry_missing " +
      "missing_states=0 latest_tiktok_direct_age_seconds=10801\n",
  );
  assert.deepEqual(evaluateCoverageMetrics(metrics), [
    "instagram_credit_guard_not_ready",
    "latest_tiktok_direct_stale",
    "tiktok_paid_fallback_not_ready",
    "tiktok_target_capacity_infeasible",
    "tiktok_target_clustered_window_misses",
  ]);
  assert.deepEqual(
    evaluateCoverageMetrics(parseCoverageMetrics(
      "[tracker coverage] tiktok_profile_recovery=feasible " +
        "tiktok_target_capacity=feasible tiktok_target_clustered_window_misses=0 " +
        "tiktok_fallback_mode=auto tiktok_fallback_readiness=ready " +
        "instagram_configured=true instagram_credit_status=ready missing_states=0 " +
        "latest_tiktok_direct_age_seconds=3600\n",
    )),
    [],
  );
  assert.deepEqual(
    evaluateCoverageMetrics(parseCoverageMetrics(
      "[tracker coverage] tiktok_profile_recovery=feasible " +
        "tiktok_target_capacity=feasible tiktok_target_clustered_window_misses=0 " +
        "tiktok_fallback_mode=auto tiktok_fallback_readiness=ready " +
        "instagram_configured=true instagram_credit_status=ready missing_states=0\n",
    )),
    ["latest_tiktok_direct_age_invalid"],
  );
});

test("systemd service bind-mounts every tracker status directory read-only", async () => {
  const servicePath = fileURLToPath(
    new URL("../creator-tracker-monitor.service", import.meta.url),
  );
  const service = await readFile(servicePath, "utf8");
  for (const job of [
    "collector-worker",
    "scheduler-tick",
    "instagram-discovery",
    "instagram-scheduler",
    "provider-reconcile",
    "canonical-delivery",
    "raw-verifier",
    "dashboard-health",
  ]) {
    assert.match(
      service,
      new RegExp(`^BindReadOnlyPaths=/var/lib/creator-tracker/state/${job}$`, "m"),
    );
  }
  assert.match(service, /^PrivateMounts=true$/m);
  assert.match(service, /^User=creator-tracker-health$/m);
  assert.match(service, /^Group=creator-tracker-health$/m);
  assert.match(
    service,
    /^LoadCredential=role-env:\/etc\/creator-tracker\/credentials\/check-coverage\.env$/m,
  );
  assert.doesNotMatch(
    service,
    /^ReadOnlyPaths=.*\/var\/lib\/creator-tracker\/state(?:\s|$)/m,
  );
});
