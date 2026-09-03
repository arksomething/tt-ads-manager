import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTOPILOT_HEALTH_MAX_AGE_SECONDS,
  boundIssueCodes,
  canonicalHeartbeat,
  evaluateAutopilotHealth,
  evaluateCoverageMetrics,
  evaluateCoverageProbeResult,
  evaluateStatusFiles,
  evaluateUnitStates,
  nextSequence,
  parseAutopilotHealth,
  parseCoverageMetrics,
  parseStatus,
  requiredUnits,
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

test("fresh one-shot jobs remain healthy while starting or running", () => {
  const now = 2_000;
  const fresh = (state) => ({ state, updatedAtEpoch: now - 10 });
  const statuses = {
    "collector-worker": fresh("running"),
    "scheduler-tick": fresh("starting"),
    "instagram-scheduler": fresh("running"),
    "instagram-discovery": fresh("succeeded"),
    "provider-reconcile": fresh("running"),
    "canonical-delivery": fresh("starting"),
    "raw-verifier": fresh("succeeded"),
    "dashboard-health": fresh("succeeded"),
  };

  assert.deepEqual(evaluateStatusFiles(statuses, now), {
    status: "healthy",
    issueCodes: [],
  });

  statuses["canonical-delivery"] = fresh("stopping");
  assert.deepEqual(evaluateStatusFiles(statuses, now), {
    status: "failing",
    issueCodes: ["canonical_delivery_failed"],
  });
});

test("autopilot health accepts only the sanitized bounded contract", () => {
  const value = {
    format_version: 1,
    observed_at_epoch: 2_000,
    health: "failing",
    reason_codes: ["autopilot_incident_confirmed"],
  };
  assert.deepEqual(parseAutopilotHealth(JSON.stringify(value)), {
    observedAtEpoch: 2_000,
    status: "failing",
    issueCodes: ["autopilot_incident_confirmed"],
  });
  for (const invalid of [
    { ...value, release_id: "must-not-cross-boundary" },
    { ...value, issues: ["private-account-detail"] },
    { ...value, reason_codes: ["private_internal_reason"] },
    { ...value, observed_at_epoch: true },
    { ...value, reason_codes: [] },
    { ...value, reason_codes: ["autopilot_incident_confirmed", "autopilot_maintenance"] },
  ]) {
    assert.equal(parseAutopilotHealth(JSON.stringify(invalid)), null);
  }
  assert.deepEqual(parseAutopilotHealth(JSON.stringify({
    ...value,
    health: "healthy",
    reason_codes: [],
  })), {
    observedAtEpoch: 2_000,
    status: "healthy",
    issueCodes: [],
  });
});

test("autopilot missing, invalid, future, and 15-minute-old exports fail closed", () => {
  const now = 2_000;
  const exportWith = (overrides = {}) => JSON.stringify({
    format_version: 1,
    observed_at_epoch: now - 1,
    health: "degraded",
    reason_codes: ["autopilot_incident_pending"],
    ...overrides,
  });
  assert.deepEqual(evaluateAutopilotHealth(null, now), {
    status: "failing",
    issueCodes: ["autopilot_health_missing"],
  });
  assert.deepEqual(evaluateAutopilotHealth("not-json", now), {
    status: "failing",
    issueCodes: ["autopilot_health_invalid"],
  });
  assert.deepEqual(evaluateAutopilotHealth(exportWith({ observed_at_epoch: now + 61 }), now), {
    status: "failing",
    issueCodes: ["autopilot_health_invalid"],
  });
  assert.deepEqual(evaluateAutopilotHealth(exportWith({
    observed_at_epoch: now - AUTOPILOT_HEALTH_MAX_AGE_SECONDS,
  }), now), {
    status: "failing",
    issueCodes: ["autopilot_health_stale"],
  });
  assert.deepEqual(evaluateAutopilotHealth(exportWith(), now), {
    status: "degraded",
    issueCodes: ["autopilot_incident_pending"],
  });
});

test("disabled units page and the autopilot timer is mandatory", () => {
  assert.ok(requiredUnits.includes("creator-tracker-autopilot.timer"));
  const states = Object.fromEntries(requiredUnits.map((unit) => [unit, {
    active: true,
    enabled: true,
  }]));
  assert.deepEqual(evaluateUnitStates(states), []);
  states["creator-tracker-autopilot.timer"].enabled = false;
  assert.deepEqual(evaluateUnitStates(states), [
    "unit_disabled_creator_tracker_autopilot_timer",
  ]);
  states["creator-tracker-worker.service"].active = false;
  assert.deepEqual(evaluateUnitStates(states), [
    "unit_disabled_creator_tracker_autopilot_timer",
    "unit_inactive_creator_tracker_worker_service",
  ]);
});

test("heartbeat issue codes stay within the receiver contract under broad failure", () => {
  const broadFailure = [
    "autopilot_incident_confirmed",
    "first_week_target_imminent_uncovered",
    ...Array.from({ length: 43 }, (_, index) => `synthetic_failure_${String(index).padStart(2, "0")}`),
  ];
  const bounded = boundIssueCodes(broadFailure);
  assert.equal(bounded.length, 32);
  assert.equal(new Set(bounded).size, bounded.length);
  assert.ok(bounded.includes("autopilot_incident_confirmed"));
  assert.ok(bounded.includes("first_week_target_imminent_uncovered"));
  assert.ok(bounded.includes("issue_codes_truncated"));
  assert.deepEqual(boundIssueCodes(["healthy_code", "healthy_code"]), ["healthy_code"]);
  assert.deepEqual(boundIssueCodes(["valid_code", "NOT SAFE"]), [
    "issue_codes_truncated",
    "valid_code",
  ]);
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
      "first_week_targets_imminent_uncovered=0 " +
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
        "first_week_targets_imminent_uncovered=0 " +
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
        "first_week_targets_imminent_uncovered=0 " +
        "tiktok_fallback_mode=auto tiktok_fallback_readiness=ready " +
        "instagram_configured=true instagram_credit_status=ready missing_states=0\n",
    )),
    ["latest_tiktok_direct_age_invalid"],
  );
});

test("imminent uncovered first-week targets fail closed without paging historical debt", () => {
  const base =
    "[tracker coverage] tiktok_profile_recovery=feasible " +
    "tiktok_target_capacity=feasible tiktok_target_clustered_window_misses=0 " +
    "tiktok_fallback_mode=auto tiktok_fallback_readiness=ready " +
    "instagram_configured=true instagram_credit_status=ready missing_states=0 " +
    "latest_tiktok_direct_age_seconds=60 overdue_tiktok_videos=4302 " +
    "unresolved_tiktok=4 unresolved_instagram=7";
  assert.deepEqual(evaluateCoverageMetrics(parseCoverageMetrics(`${base}\n`)), [
    "first_week_targets_imminent_uncovered_invalid",
  ]);
  assert.deepEqual(evaluateCoverageMetrics(parseCoverageMetrics(
    `${base} first_week_targets_imminent_uncovered=unknown\n`,
  )), ["first_week_targets_imminent_uncovered_invalid"]);
  assert.deepEqual(evaluateCoverageMetrics(parseCoverageMetrics(
    `${base} first_week_targets_imminent_uncovered=1\n`,
  )), ["first_week_target_imminent_uncovered"]);
  assert.deepEqual(evaluateCoverageMetrics(parseCoverageMetrics(
    `${base} first_week_targets_imminent_uncovered=0\n`,
  )), []);
});

test("proven snapshot contention degrades while valid imminent metrics still page", () => {
  const contentions = [
    "ReadOnlySnapshotUncheckpointedWalError: " +
      "Read-only database snapshots require a fully checkpointed database.",
    "ReadOnlySnapshotConcurrentMutationError: " +
      "Read-only database snapshot source changed while it was captured.",
  ];
  for (const contention of contentions) {
    assert.deepEqual(evaluateCoverageProbeResult({
      status: 1,
      signal: null,
      stdout: "",
      stderr: contention,
    }), {
      status: "degraded",
      issueCodes: ["coverage_probe_snapshot_contended"],
    });
    assert.deepEqual(evaluateCoverageProbeResult({
      status: 1,
      signal: null,
      stdout: "",
      stderr:
        "file:///opt/creator-tracker/current/app/src/db/connection-safety.ts:637\n" +
        "    throw new ReadOnlySnapshotConcurrentMutationError(message);\n" +
        "    ^\n\n" +
        `${contention}\n` +
        "    at captureSnapshot (/opt/creator-tracker/current/app/src/db/connection-safety.ts:637:11)\n" +
        "    at runCoverageCheck (/opt/creator-tracker/current/app/scripts/check-owned-tracker-coverage.ts:249:9)\n\n" +
        "Node.js v24.20.0\n",
    }), {
      status: "degraded",
      issueCodes: ["coverage_probe_snapshot_contended"],
    });
  }
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 1,
    signal: null,
    stdout: "",
    stderr: "Error: unrelated coverage failure",
  }), {
    status: "failing",
    issueCodes: ["coverage_probe_failed"],
  });
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 2,
    signal: null,
    stdout: "",
    stderr: contentions[0],
  }), {
    status: "failing",
    issueCodes: ["coverage_probe_failed"],
  });
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 1,
    signal: null,
    stdout: "",
    stderr: `${contentions[0]}\nError: unrelated fatal failure`,
  }), {
    status: "failing",
    issueCodes: ["coverage_probe_failed"],
  });

  const validImminent =
    "[tracker coverage] tiktok_profile_recovery=feasible " +
    "tiktok_target_capacity=feasible tiktok_target_clustered_window_misses=0 " +
    "first_week_targets_imminent_uncovered=1 " +
    "tiktok_fallback_mode=auto tiktok_fallback_readiness=ready " +
    "instagram_configured=true instagram_credit_status=ready missing_states=0 " +
    "latest_tiktok_direct_age_seconds=60\n";
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 1,
    signal: null,
    stdout: validImminent,
    stderr: contentions[0],
  }), {
    status: "failing",
    issueCodes: ["first_week_target_imminent_uncovered"],
  });
  const validHealthy = validImminent.replace(
    "first_week_targets_imminent_uncovered=1",
    "first_week_targets_imminent_uncovered=0",
  );
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 1,
    signal: null,
    stdout: validHealthy,
    stderr: "",
  }), {
    status: "healthy",
    issueCodes: [],
  });
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 1,
    signal: null,
    stdout: validHealthy,
    stderr: "Error: failed after emitting metrics",
  }), {
    status: "failing",
    issueCodes: ["coverage_probe_failed"],
  });
  assert.deepEqual(evaluateCoverageProbeResult({
    status: 1,
    signal: null,
    stdout: validHealthy,
    stderr: `${contentions[0]}\nError: failed after contention`,
  }), {
    status: "failing",
    issueCodes: ["coverage_probe_failed"],
  });
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
  assert.match(
    service,
    /^BindReadOnlyPaths=\/var\/lib\/creator-tracker-autopilot-health$/m,
  );
  assert.match(
    service,
    /^InaccessiblePaths=-\/var\/lib\/creator-tracker-autopilot$/m,
  );
  assert.match(service, /^CapabilityBoundingSet=$/m);
  assert.match(service, /^AmbientCapabilities=$/m);
  assert.doesNotMatch(
    service,
    /^ReadOnlyPaths=.*\/var\/lib\/creator-tracker\/state(?:\s|$)/m,
  );
});

test("installer requires a readable sanitized export and live autopilot timer", async () => {
  const installPath = fileURLToPath(new URL("../install.sh", import.meta.url));
  const install = await readFile(installPath, "utf8");
  assert.match(install, /root:creator-tracker-health:750/);
  assert.match(install, /root:creator-tracker-health:640:1/);
  assert.match(
    install,
    /install -d -o root -g creator-tracker-health -m 0750 "\$health_root"/,
  );
  assert.match(
    install,
    /systemctl start creator-tracker-autopilot\.service \|\| true/,
  );
  assert.match(
    install,
    /runuser -u creator-tracker-health -- \/usr\/bin\/python3 -I - "\$health_file"/,
  );
  assert.match(
    install,
    /systemctl is-enabled --quiet creator-tracker-autopilot\.timer/,
  );
  assert.match(
    install,
    /systemctl is-active --quiet creator-tracker-autopilot\.timer/,
  );
  assert.ok(
    install.indexOf("install -d -o root -g creator-tracker-health") <
      install.indexOf("systemctl start creator-tracker-autopilot.service"),
  );
  assert.ok(
    install.indexOf("systemctl stop creator-tracker-monitor.timer") <
      install.indexOf("systemctl daemon-reload"),
  );
  assert.ok(
    install.indexOf("systemctl start creator-tracker-autopilot.service") <
      install.indexOf("systemctl enable --now creator-tracker-monitor.timer"),
  );
});
