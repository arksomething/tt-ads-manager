#!/usr/bin/python3 -I
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True


MODULE_PATH = Path(__file__).resolve().parents[1] / "bin" / "creator-tracker-autopilot.py"
SPEC = importlib.util.spec_from_file_location("creator_tracker_autopilot", MODULE_PATH)
assert SPEC and SPEC.loader
autopilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(autopilot)


NOW = 1_800_000_000


def unit(*, active: str = "active", enabled: str = "enabled") -> dict:
    return {
        "load": "loaded",
        "active": active,
        "sub": "running",
        "enabled": enabled,
        "exit_status": "0",
        "fragment_path": "/etc/systemd/system/test.unit",
        "drop_in_paths": "",
        "needs_daemon_reload": "no",
        "integrity_ready": True,
    }


def healthy_snapshot() -> dict:
    fields = {
        "unresolved_tiktok": "8",
        "unresolved_instagram": "1",
        "overdue_tiktok_videos": "380",
        "overdue_instagram_videos": "0",
        "failed_tiktok_videos": "234",
        "first_week_targets_enforced_missed": "21",
        "first_week_targets_enforced_outside_target": "176",
        "first_week_targets_missing": "3",
        "first_week_targets_stale": "3",
        "first_week_targets_current_enforced_missed": "21",
        "first_week_targets_current_enforced_outside_target": "174",
        "tiktok_profile_recovery": "feasible",
        "tiktok_target_capacity": "feasible",
        "tiktok_target_clustered_window_misses": "0",
        "tiktok_fallback_mode": "auto",
        "tiktok_fallback_status": "ready",
        "instagram_configured": "true",
        "instagram_credit_status": "ready",
        "missing_states": "0",
        "latest_tiktok_direct_age_seconds": "120",
    }
    return {
        "format_version": 1,
        "observed_at_epoch": NOW,
        "release_id": "a" * 64,
        "release_path": "/opt/creator-tracker/releases/" + "a" * 64,
        "app_commit": "b" * 40,
        "release_identity_valid": True,
        "release_integrity": {"ready": True, "detail": "verified"},
        "activation": {
            "lock_valid": True,
            "lock_held": False,
            "marker_present": False,
        },
        "activation_in_progress": False,
        "maintenance_in_progress": False,
        "cutover": {"ready": True, "reason": "complete"},
        "storage_available_bytes": 50 * 1024**3,
        "worker": {
            "unit": unit(),
            "heartbeat_epoch": NOW - 30,
            "marker_state": "running",
        },
        "timers": {name: unit() for name in autopilot.TIMER_UNITS},
        "health_unit": unit(active="inactive"),
        "jobs": {
            role: {
                "service": service,
                "max_age_seconds": max_age,
                "success_epoch": NOW - min(max_age // 2, 60),
                "unit": unit(active="inactive"),
            }
            for role, (service, max_age) in autopilot.JOB_LIMITS.items()
        },
        "coverage": {"observed_at_epoch": NOW - 60, "fields": fields},
    }


class AtomicStateTests(unittest.TestCase):
    def test_atomic_json_normalizes_root_ownership(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "state.json"
            with mock.patch.object(autopilot.os, "fchown") as fchown:
                autopilot.atomic_json(target, {"format_version": 1})
            fchown.assert_called_once()
            self.assertEqual(fchown.call_args.args[1:], (0, 0))
            self.assertEqual(target.read_text(), '{"format_version":1}\n')


class EvaluateTests(unittest.TestCase):
    def test_known_historical_debt_is_not_an_incident(self) -> None:
        actions, issues = autopilot.evaluate_snapshot(healthy_snapshot())
        self.assertEqual(actions, [])
        self.assertEqual(issues, [])

    def test_disabled_timer_and_stale_worker_are_remediated(self) -> None:
        snapshot = healthy_snapshot()
        timer = autopilot.TIMER_UNITS[0]
        snapshot["timers"][timer] = unit(active="inactive", enabled="disabled")
        snapshot["worker"]["heartbeat_epoch"] = NOW - 999
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"timer_disabled:{timer}", issues)
        self.assertIn("worker_inactive_or_stale", issues)
        self.assertNotIn({"kind": "enable_timer", "unit": timer}, actions)
        self.assertIn(
            {"kind": "restart_worker", "unit": autopilot.WORKER_UNIT}, actions
        )

    def test_disabled_worker_is_operator_only(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["worker"]["unit"] = unit(active="inactive", enabled="disabled")
        snapshot["worker"]["heartbeat_epoch"] = 0
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"unit_disabled:{autopilot.WORKER_UNIT}", issues)
        self.assertNotIn("worker_inactive_or_stale", issues)
        self.assertEqual(actions, [])

    def test_stale_job_escalates_without_bypassing_timer_rate_limits(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["jobs"]["scheduler-tick"]["success_epoch"] = NOW - 9999
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("job_stale:scheduler-tick", issues)
        self.assertEqual(actions, [])

    def test_disabled_timer_does_not_turn_its_stale_job_into_code_incident(self) -> None:
        snapshot = healthy_snapshot()
        timer = autopilot.JOB_TIMER_UNITS["scheduler-tick"]
        snapshot["timers"][timer] = unit(active="inactive", enabled="disabled")
        snapshot["jobs"]["scheduler-tick"]["success_epoch"] = 0
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"timer_disabled:{timer}", issues)
        self.assertNotIn("job_stale:scheduler-tick", issues)

    def test_credit_guard_suppresses_downstream_instagram_job_staleness(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["coverage"]["fields"]["instagram_credit_status"] = "depleted"
        for role in ("instagram-scheduler", "instagram-discovery"):
            snapshot["jobs"][role]["success_epoch"] = 0
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("instagram_credit_guard_not_ready", issues)
        self.assertNotIn("job_stale:instagram-scheduler", issues)
        self.assertNotIn("job_stale:instagram-discovery", issues)

    def test_disabled_health_timer_suppresses_downstream_coverage_staleness(self) -> None:
        snapshot = healthy_snapshot()
        timer = "creator-tracker-dashboard-health.timer"
        snapshot["timers"][timer] = unit(active="inactive", enabled="disabled")
        snapshot["coverage"] = {"observed_at_epoch": None, "fields": {}}
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"timer_disabled:{timer}", issues)
        self.assertNotIn("coverage_snapshot_stale", issues)

    def test_inactive_health_timer_uses_timer_incident_not_coverage_incident(self) -> None:
        snapshot = healthy_snapshot()
        timer = "creator-tracker-dashboard-health.timer"
        snapshot["timers"][timer] = unit(active="inactive", enabled="enabled")
        snapshot["coverage"] = {"observed_at_epoch": None, "fields": {}}
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"timer_inactive:{timer}", issues)
        self.assertNotIn("coverage_snapshot_stale", issues)

    def test_credit_guard_problem_escalates_without_rearm(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["coverage"]["fields"]["instagram_credit_status"] = (
            "provider_telemetry_missing"
        )
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("instagram_credit_guard_not_ready", issues)
        self.assertEqual(actions, [])

    def test_activation_suppresses_all_actions_and_incidents(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["activation_in_progress"] = True
        snapshot["maintenance_in_progress"] = True
        snapshot["activation"]["lock_held"] = True
        snapshot["worker"]["heartbeat_epoch"] = 0
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(actions, [])
        self.assertEqual(issues, [])

    def test_capacity_and_three_hour_freshness_are_actionable(self) -> None:
        snapshot = healthy_snapshot()
        fields = snapshot["coverage"]["fields"]
        fields["tiktok_target_capacity"] = "infeasible"
        fields["latest_tiktok_direct_age_seconds"] = str(3 * 60 * 60 + 1)
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(actions, [])
        self.assertIn("tiktok_target_capacity_not_feasible", issues)
        self.assertIn("tiktok_direct_observation_stale", issues)

    def test_instagram_configuration_fails_closed(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["coverage"]["fields"]["instagram_configured"] = "false"
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("instagram_configuration_not_ready", issues)

    def test_unit_integrity_drift_blocks_remediation(self) -> None:
        snapshot = healthy_snapshot()
        timer = autopilot.TIMER_UNITS[0]
        snapshot["timers"][timer]["active"] = "inactive"
        snapshot["timers"][timer]["integrity_ready"] = False
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"unit_integrity_invalid:{timer}", issues)
        self.assertNotIn({"kind": "start_timer", "unit": timer}, actions)

    def test_worker_integrity_drift_suppresses_worker_code_incident(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["worker"]["unit"]["integrity_ready"] = False
        snapshot["worker"]["heartbeat_epoch"] = 0
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn(f"unit_integrity_invalid:{autopilot.WORKER_UNIT}", issues)
        self.assertNotIn("worker_inactive_or_stale", issues)
        self.assertEqual(actions, [])

    def test_invalid_fallback_mode_is_not_accepted(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["coverage"]["fields"]["tiktok_fallback_mode"] = "garbage"
        snapshot["coverage"]["fields"]["tiktok_fallback_status"] = "invalid_mode"
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("tiktok_fallback_configuration_invalid", issues)

    def test_missing_baseline_telemetry_is_not_accepted(self) -> None:
        snapshot = healthy_snapshot()
        del snapshot["coverage"]["fields"]["failed_tiktok_videos"]
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("coverage_baseline_telemetry_missing:failed_tiktok_videos", issues)

    def test_stale_activation_marker_is_not_hidden_by_cutover_grace(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["activation"]["marker_present"] = True
        snapshot["cutover"] = {"ready": False, "reason": "missing_marker"}
        snapshot["maintenance_in_progress"] = False
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(actions, [])
        self.assertIn("stale_activation_marker", issues)

    def test_cutover_failure_blocks_automatic_actions(self) -> None:
        snapshot = healthy_snapshot()
        timer = autopilot.TIMER_UNITS[0]
        snapshot["timers"][timer] = unit(active="inactive")
        snapshot["cutover"] = {"ready": False, "reason": "missing_marker"}
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(actions, [])
        self.assertIn("cutover_gate_not_ready", issues)

    def test_release_local_baseline_catches_new_coverage_debt(self) -> None:
        snapshot = healthy_snapshot()
        baseline = {
            key: int(snapshot["coverage"]["fields"][key])
            for key in autopilot.COVERAGE_REGRESSION_LIMITS
        }
        snapshot["coverage"]["fields"]["failed_tiktok_videos"] = "235"
        actions, issues = autopilot.evaluate_snapshot(snapshot, baseline)
        self.assertEqual(actions, [])
        self.assertIn("coverage_regressed:failed_tiktok_videos", issues)

    def test_automatic_actions_have_a_cooldown(self) -> None:
        action = {"kind": "restart_worker", "unit": autopilot.WORKER_UNIT}
        previous = {
            "issue_streaks": {
                "worker_inactive_or_stale": {"count": 4, "first_seen_epoch": NOW - 900}
            },
            "automatic_actions": [
                {"at_epoch": NOW - 60, "kind": action["kind"], "unit": action["unit"], "ok": True}
            ]
        }
        selected, suppressed, history = autopilot.select_automatic_actions(
            previous, [action], NOW
        )
        self.assertEqual(selected, [])
        self.assertEqual(len(suppressed), 1)
        self.assertEqual(suppressed[0]["detail"], "automatic action cooldown")
        self.assertEqual(len(history), 1)

    def test_automatic_action_waits_for_second_probe(self) -> None:
        action = {"kind": "restart_worker", "unit": autopilot.WORKER_UNIT}
        selected, suppressed, _ = autopilot.select_automatic_actions({}, [action], NOW)
        self.assertEqual(selected, [])
        self.assertEqual(suppressed[0]["detail"], "automatic action awaiting confirmation")
        previous = {
            "issue_streaks": {
                "worker_inactive_or_stale": {"count": 1, "first_seen_epoch": NOW - 300}
            }
        }
        selected, _, _ = autopilot.select_automatic_actions(previous, [action], NOW)
        self.assertEqual(selected, [action])

    def test_per_unit_daily_action_limit(self) -> None:
        action = {"kind": "restart_worker", "unit": autopilot.WORKER_UNIT}
        previous = {
            "issue_streaks": {
                "worker_inactive_or_stale": {"count": 4, "first_seen_epoch": NOW - 900}
            },
            "automatic_actions": [
                {
                    "at_epoch": NOW - 3600 * offset,
                    "kind": action["kind"],
                    "unit": action["unit"],
                    "ok": True,
                }
                for offset in (1, 2, 3)
            ],
        }
        selected, suppressed, _ = autopilot.select_automatic_actions(previous, [action], NOW)
        self.assertEqual(selected, [])
        self.assertEqual(suppressed[0]["detail"], "per-unit daily automatic action limit")

    def test_coverage_baseline_survives_application_release(self) -> None:
        snapshot = healthy_snapshot()
        previous = {
            "coverage_baseline_release": "c" * 64,
            "coverage_baseline": {"failed_tiktok_videos": 200},
        }
        baseline = autopilot.next_coverage_baseline(previous, snapshot)
        self.assertEqual(baseline["failed_tiktok_videos"], 200)


class DispatchTests(unittest.TestCase):
    def test_dispatches_only_on_third_consecutive_fingerprint(self) -> None:
        snapshot = healthy_snapshot()
        issues = ["worker_inactive_or_stale"]
        state: dict = {}
        for expected_streak in (1, 2):
            state, dispatch, incident_id = autopilot.update_incident_state(
                state, snapshot, issues
            )
            self.assertEqual(state["streak"], expected_streak)
            self.assertFalse(dispatch)
            self.assertIsNone(incident_id)
            snapshot["observed_at_epoch"] += 300
        state, dispatch, incident_id = autopilot.update_incident_state(
            state, snapshot, issues
        )
        self.assertTrue(dispatch)
        self.assertRegex(incident_id or "", autopilot.INCIDENT_RE)

    def test_cooldown_deduplicates_same_incident(self) -> None:
        snapshot = healthy_snapshot()
        issues = ["coverage_snapshot_stale"]
        current_fingerprint = autopilot.fingerprint(snapshot["release_id"], issues)
        state = {
            "issue_streaks": {
                "coverage_snapshot_stale": {
                    "count": 9,
                    "first_seen_epoch": NOW - 600,
                }
            },
            "dispatches": [
                {
                    "fingerprint": current_fingerprint,
                    "at_epoch": NOW - 60,
                    "incident_id": "old",
                }
            ],
        }
        state, dispatch, incident_id = autopilot.update_incident_state(
            state, snapshot, issues
        )
        self.assertFalse(dispatch)
        self.assertIsNone(incident_id)
        self.assertEqual(len(state["dispatches"]), 1)

    def test_dispatch_fingerprint_excludes_new_transient_issue(self) -> None:
        snapshot = healthy_snapshot()
        persistent = "coverage_snapshot_stale"
        transient = "job_stale:scheduler-tick"
        previous = {
            "issue_streaks": {
                persistent: {"count": 2, "first_seen_epoch": NOW - 600},
            }
        }
        state, dispatch, _ = autopilot.update_incident_state(
            previous, snapshot, [persistent, transient]
        )
        self.assertTrue(dispatch)
        self.assertEqual(state["dispatch_issues"], [persistent])
        self.assertEqual(
            state["fingerprint"], autopilot.fingerprint(snapshot["release_id"], [persistent])
        )

    def test_operator_only_issue_never_spends_a_codex_dispatch(self) -> None:
        snapshot = healthy_snapshot()
        state: dict = {}
        for _ in range(4):
            state, dispatch, incident_id = autopilot.update_incident_state(
                state, snapshot, ["instagram_credit_guard_not_ready"]
            )
            self.assertFalse(dispatch)
            self.assertIsNone(incident_id)
            snapshot["observed_at_epoch"] += 300
        self.assertEqual(state["status"], "operator_required")

    def test_low_storage_vetoes_codex_dispatch(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["storage_available_bytes"] = 0
        state: dict = {}
        issues = ["coverage_snapshot_stale", "storage_reserve_low_or_unknown"]
        for _ in range(4):
            state, dispatch, incident_id = autopilot.update_incident_state(
                state, snapshot, issues
            )
            self.assertFalse(dispatch)
            self.assertIsNone(incident_id)
            snapshot["observed_at_epoch"] += 300

    def test_operator_issue_does_not_change_code_incident_fingerprint(self) -> None:
        snapshot = healthy_snapshot()
        code_issue = "worker_inactive_or_stale"
        state: dict = {}
        for _ in range(3):
            state, dispatch, _ = autopilot.update_incident_state(state, snapshot, [code_issue])
            snapshot["observed_at_epoch"] += 300
        self.assertTrue(dispatch)
        previous_fingerprint = state["fingerprint"]
        state, dispatch, _ = autopilot.update_incident_state(
            state, snapshot, [code_issue, "instagram_credit_guard_not_ready"]
        )
        self.assertFalse(dispatch)
        self.assertEqual(state["fingerprint"], previous_fingerprint)

    def test_capacity_churn_needs_45_minutes_before_dispatch(self) -> None:
        snapshot = healthy_snapshot()
        state: dict = {}
        issue = "tiktok_target_capacity_not_feasible"
        for elapsed in (0, 300, 1800):
            snapshot["observed_at_epoch"] = NOW + elapsed
            state, dispatch, _ = autopilot.update_incident_state(state, snapshot, [issue])
            self.assertFalse(dispatch)
        snapshot["observed_at_epoch"] = NOW + 45 * 60
        state, dispatch, _ = autopilot.update_incident_state(state, snapshot, [issue])
        self.assertTrue(dispatch)

    def test_continuous_issue_dispatches_only_once(self) -> None:
        snapshot = healthy_snapshot()
        state: dict = {}
        issue = "coverage_snapshot_stale"
        dispatches = 0
        for offset in range(0, 48 * 60 * 60, 300):
            snapshot["observed_at_epoch"] = NOW + offset
            state, dispatch, _ = autopilot.update_incident_state(state, snapshot, [issue])
            dispatches += int(dispatch)
        self.assertEqual(dispatches, 1)

    def test_cleared_issue_can_start_a_new_episode(self) -> None:
        snapshot = healthy_snapshot()
        state: dict = {}
        issue = "coverage_snapshot_stale"
        for offset in (0, 300, 600):
            snapshot["observed_at_epoch"] = NOW + offset
            state, _, _ = autopilot.update_incident_state(state, snapshot, [issue])
        self.assertIn("dispatched_at_epoch", state["issue_streaks"][issue])
        snapshot["observed_at_epoch"] = NOW + 900
        state, dispatch, _ = autopilot.update_incident_state(state, snapshot, [])
        self.assertFalse(dispatch)
        for offset in (7 * 3600, 7 * 3600 + 300, 7 * 3600 + 600):
            snapshot["observed_at_epoch"] = NOW + offset
            state, dispatch, _ = autopilot.update_incident_state(state, snapshot, [issue])
        self.assertTrue(dispatch)

    def test_issue_streak_saturates_at_state_validation_limit(self) -> None:
        snapshot = healthy_snapshot()
        previous = {
            "issue_streaks": {
                "coverage_snapshot_stale": {
                    "count": 10_000,
                    "first_seen_epoch": NOW - 100_000,
                    "dispatched_at_epoch": NOW - 90_000,
                }
            }
        }
        state, dispatch, _ = autopilot.update_incident_state(
            previous, snapshot, ["coverage_snapshot_stale"]
        )
        self.assertFalse(dispatch)
        self.assertEqual(state["issue_streaks"]["coverage_snapshot_stale"]["count"], 10_000)

    def test_unsafe_activation_state_never_reserves_dispatch(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["activation"]["marker_present"] = True
        state: dict = {}
        for _ in range(4):
            state, dispatch, incident_id = autopilot.update_incident_state(
                state, snapshot, ["coverage_snapshot_stale"]
            )
            self.assertFalse(dispatch)
            self.assertIsNone(incident_id)
            snapshot["observed_at_epoch"] += 300


class StateValidationTests(unittest.TestCase):
    def test_accepts_strict_partial_baseline_only_during_bootstrap(self) -> None:
        state = {
            "format_version": 1,
            "dispatches": [],
            "automatic_actions": [],
            "coverage_baseline": {"failed_tiktok_videos": 10},
            "coverage_baseline_release": "a" * 64,
            "last_probe_epoch": NOW,
            "status": "awaiting_baseline",
            "fingerprint": None,
            "streak": 0,
        }
        self.assertIsNone(autopilot.state_shape_error(state))
        state["status"] = "healthy"
        self.assertIsNotNone(autopilot.state_shape_error(state))

    def test_rejects_null_safety_histories(self) -> None:
        self.assertIsNotNone(
            autopilot.state_shape_error({"format_version": 1, "dispatches": None})
        )
        self.assertIsNotNone(
            autopilot.state_shape_error({"format_version": 1, "automatic_actions": None})
        )

    def test_rejects_truncated_initialized_state(self) -> None:
        self.assertIsNotNone(
            autopilot.state_shape_error(
                {
                    "format_version": 1,
                    "dispatches": [],
                    "automatic_actions": [],
                    "coverage_baseline": {},
                }
            )
        )

    def test_accepts_complete_state_with_reserved_action(self) -> None:
        self.assertIsNone(
            autopilot.state_shape_error(
                {
                    "format_version": 1,
                    "dispatches": [],
                    "automatic_actions": [
                        {
                            "at_epoch": NOW,
                            "kind": "restart_worker",
                            "unit": autopilot.WORKER_UNIT,
                            "ok": None,
                        }
                    ],
                    "coverage_baseline": {key: 0 for key in autopilot.COVERAGE_REGRESSION_LIMITS},
                    "coverage_baseline_release": "a" * 64,
                    "last_probe_epoch": NOW,
                    "status": "healthy",
                    "fingerprint": None,
                    "streak": 0,
                }
            )
        )

    def test_rejects_malformed_pending_outbox(self) -> None:
        self.assertIsNotNone(
            autopilot.state_shape_error(
                {
                    "format_version": 1,
                    "pending_incident": {"incident_id": "bad"},
                }
            )
        )


class ActivationDeadmanTests(unittest.TestCase):
    def test_stuck_activation_stops_blinding_monitor(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["activation"]["lock_held"] = True
        snapshot["activation"]["marker_present"] = False
        snapshot["maintenance_in_progress"] = True
        previous = {
            "activation_lock_first_seen_epoch": NOW
            - autopilot.ACTIVATION_WITHOUT_MARKER_MAX_SECONDS
            - 1
        }
        autopilot.apply_activation_deadman(previous, snapshot)
        self.assertFalse(snapshot["maintenance_in_progress"])
        _, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("activation_lock_stuck", issues)


class TrustedReportOutcomeTests(unittest.TestCase):
    @staticmethod
    def result(status: str, recommendation: str, changed_files: list[str]) -> bytes:
        return (
            autopilot.json.dumps(
                {
                    "status": status,
                    "production_recommendation": recommendation,
                    "changed_files": changed_files,
                }
            )
            + "\n"
        ).encode()

    def test_trusted_actionable_outcomes_are_terminal(self) -> None:
        cases = (
            ("no_action", "none", []),
            ("external_or_data_issue", "operator_action_required", []),
            ("verified_candidate", "review_candidate", ["src/sync/fix.ts"]),
        )
        for status, recommendation, changed_files in cases:
            with self.subTest(status=status):
                self.assertTrue(
                    autopilot.trusted_report_is_terminal(
                        b"0\n", self.result(status, recommendation, changed_files)
                    )
                )

    def test_failed_or_untrusted_outcomes_are_retryable(self) -> None:
        self.assertFalse(
            autopilot.trusted_report_is_terminal(
                b"1\n", self.result("no_action", "none", [])
            )
        )
        self.assertFalse(
            autopilot.trusted_report_is_terminal(
                b"0\n", self.result("failed", "operator_action_required", [])
            )
        )
        self.assertFalse(
            autopilot.trusted_report_is_terminal(
                b"0\n", self.result("needs_human", "operator_action_required", [])
            )
        )
        self.assertFalse(
            autopilot.trusted_report_is_terminal(
                b"0\n", self.result("verified_candidate", "review_candidate", [])
            )
        )


class PipelineRoutingTests(unittest.TestCase):
    def pipeline_paths(self, root: Path) -> dict[str, Path]:
        paths = {
            "QUEUE_DIR": root / "queue",
            "INBOX_DIR": root / "inbox",
            "DEAD_LETTER_DIR": root / "dead-letter",
            "PRODUCING_DIR": root / "producing",
            "READY_DIR": root / "ready",
            "VERIFICATION_PROCESSING_DIR": root / "verification" / "processing",
            "VERIFICATION_REJECTED_DIR": root / "verification" / "rejected",
            "REPORTS_DIR": root / "reports",
        }
        for path in paths.values():
            path.mkdir(parents=True, exist_ok=True)
        return paths

    def test_incomplete_producing_attempt_retries_codex_after_reboot(self) -> None:
        incident = "20260903T010000Z-" + "e" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            (paths["INBOX_DIR"] / f"{incident}.json").write_text("{}\n")
            (paths["PRODUCING_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ), mock.patch.object(
                autopilot, "verify_autopilot_artifacts", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot, "verify_autopilot_unit", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot,
                "run",
                return_value=autopilot.subprocess.CompletedProcess([], 0, "", ""),
            ) as run_mock:
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertEqual(result["component"], "codex")
            self.assertEqual(run_mock.call_args.args[0][-1], autopilot.AGENT_UNIT)

    def test_two_incomplete_producing_attempts_dead_letter_after_reboot(self) -> None:
        incident = "20260903T010000Z-" + "8" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            inbox = paths["INBOX_DIR"] / f"{incident}.json"
            inbox.write_text("{}\n")
            (paths["PRODUCING_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            (paths["PRODUCING_DIR"] / f"{incident}.attempt.DEF456").mkdir()
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ), mock.patch.object(autopilot, "run") as run_mock:
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertIsNone(result)
            run_mock.assert_not_called()
            self.assertFalse(inbox.exists())
            self.assertTrue((paths["DEAD_LETTER_DIR"] / inbox.name).exists())

    def test_ready_attempt_starts_verifier_not_second_codex_run(self) -> None:
        incident = "20260903T010000Z-" + "a" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            (paths["INBOX_DIR"] / f"{incident}.json").write_text("{}\n")
            (paths["READY_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ), mock.patch.object(
                autopilot, "verify_autopilot_artifacts", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot, "verify_autopilot_unit", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot,
                "run",
                return_value=autopilot.subprocess.CompletedProcess([], 0, "", ""),
            ) as run_mock:
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertEqual(result["component"], "verifier")
            self.assertEqual(run_mock.call_args.args[0][-1], autopilot.VERIFIER_UNIT)

    def test_active_verifier_blocks_duplicate_codex_run(self) -> None:
        incident = "20260903T010000Z-" + "b" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            (paths["INBOX_DIR"] / f"{incident}.json").write_text("{}\n")
            (paths["READY_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            def snapshot(unit_name: str) -> dict:
                return {
                    "active": "active" if unit_name == autopilot.VERIFIER_UNIT else "inactive"
                }
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", side_effect=snapshot
            ), mock.patch.object(
                autopilot, "verify_autopilot_artifacts", return_value=(True, "verified")
            ):
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertFalse(result["requested"])
            self.assertEqual(result["component"], "verifier")

    def test_rejected_attempt_dead_letters_without_rerunning_codex(self) -> None:
        incident = "20260903T010000Z-" + "c" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            inbox = paths["INBOX_DIR"] / f"{incident}.json"
            inbox.write_text("{}\n")
            (paths["VERIFICATION_REJECTED_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ):
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertIsNone(result)
            self.assertFalse(inbox.exists())
            self.assertTrue((paths["DEAD_LETTER_DIR"] / inbox.name).exists())

    def test_one_failed_completed_attempt_gets_one_bounded_retry(self) -> None:
        incident = "20260903T010000Z-" + "f" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            (paths["INBOX_DIR"] / f"{incident}.json").write_text("{}\n")
            (paths["REPORTS_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ), mock.patch.object(
                autopilot, "verify_autopilot_artifacts", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot, "verify_autopilot_unit", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot,
                "run",
                return_value=autopilot.subprocess.CompletedProcess([], 0, "", ""),
            ) as run_mock:
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertEqual(result["component"], "codex")
            self.assertEqual(run_mock.call_args.args[0][-1], autopilot.AGENT_UNIT)

    def test_two_failed_completed_attempts_dead_letter_without_looping(self) -> None:
        incident = "20260903T010000Z-" + "9" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            inbox = paths["INBOX_DIR"] / f"{incident}.json"
            inbox.write_text("{}\n")
            (paths["REPORTS_DIR"] / f"{incident}.attempt.ABC123").mkdir()
            (paths["REPORTS_DIR"] / f"{incident}.attempt.DEF456").mkdir()
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ), mock.patch.object(autopilot, "run") as run_mock:
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertIsNone(result)
            run_mock.assert_not_called()
            self.assertFalse(inbox.exists())
            self.assertTrue((paths["DEAD_LETTER_DIR"] / inbox.name).exists())

    def test_codex_does_not_start_when_downstream_verifier_unit_is_invalid(self) -> None:
        incident = "20260903T010000Z-" + "d" * 16
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.pipeline_paths(Path(temporary))
            (paths["INBOX_DIR"] / f"{incident}.json").write_text("{}\n")
            def verify_unit(unit_name: str) -> tuple[bool, str]:
                if unit_name == autopilot.VERIFIER_UNIT:
                    return False, "verifier drift"
                return True, "verified"
            with mock.patch.multiple(autopilot, **paths), mock.patch.object(
                autopilot, "unit_snapshot", return_value={"active": "inactive"}
            ), mock.patch.object(
                autopilot, "verify_autopilot_artifacts", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot, "verify_autopilot_unit", side_effect=verify_unit
            ), mock.patch.object(autopilot, "run") as run_mock:
                result = autopilot.start_agent_if_queued(healthy_snapshot())
            self.assertFalse(result["ok"])
            self.assertEqual(result["component"], "verifier")
            run_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
