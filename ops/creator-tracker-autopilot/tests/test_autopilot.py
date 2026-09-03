#!/usr/bin/python3 -I
from __future__ import annotations

import importlib.util
from pathlib import Path
import stat
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
        "first_week_targets_imminent_uncovered": "0",
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

    def test_monitor_health_export_is_bounded_and_group_readable(self) -> None:
        private_status = {
            "format_version": 1,
            "observed_at_epoch": NOW,
            "state": "incident_pending",
            "streak": 3,
            "release_id": "secret-release",
            "app_commit": "secret-commit",
            "issues": ["private-account-specific-detail"],
            "detail": "private diagnostic detail",
            "codex": {"incident_id": "private-incident"},
        }
        expected = {
            "format_version": 1,
            "observed_at_epoch": NOW,
            "health": "degraded",
            "reason_codes": ["autopilot_incident_pending"],
        }
        self.assertEqual(autopilot.build_monitor_health_export(private_status), expected)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "status.json"
            safe_root = mock.Mock(
                st_mode=stat.S_IFDIR | 0o750,
                st_uid=0,
                st_gid=1234,
            )
            with mock.patch.multiple(
                autopilot,
                MONITOR_HEALTH_ROOT=root,
                MONITOR_HEALTH_FILE=target,
            ), mock.patch.object(
                autopilot.Path, "lstat", return_value=safe_root
            ), mock.patch.object(
                autopilot.grp, "getgrnam", return_value=mock.Mock(gr_gid=1234)
            ), mock.patch.object(autopilot.os, "fchown") as fchown:
                autopilot.publish_monitor_health(private_status)
            fchown.assert_called_once()
            self.assertEqual(fchown.call_args.args[1:], (0, 1234))
            self.assertEqual(target.stat().st_mode & 0o777, 0o640)
            self.assertEqual(target.read_text(), '{"format_version":1,"health":"degraded",'
                             '"observed_at_epoch":1800000000,'
                             '"reason_codes":["autopilot_incident_pending"]}\n')

    def test_monitor_health_export_maps_only_generic_states(self) -> None:
        cases = (
            ("healthy", 0, "healthy", []),
            ("maintenance", 0, "degraded", ["autopilot_maintenance"]),
            ("incident_pending", 1, "degraded", ["autopilot_incident_pending"]),
            ("incident_pending", 2, "degraded", ["autopilot_incident_pending"]),
            ("incident_pending", 3, "degraded", ["autopilot_incident_pending"]),
            ("codex_queued", 3, "degraded", ["autopilot_incident_pending"]),
            ("operator_required", 3, "failing", ["autopilot_operator_required"]),
            ("sentinel_state_invalid", 0, "failing", ["autopilot_integrity_failure"]),
            (
                "awaiting_initial_coverage_baseline",
                0,
                "degraded",
                ["autopilot_incident_pending"],
            ),
            ("unknown_future_state", 0, "failing", ["autopilot_integrity_failure"]),
        )
        for state, streak, health, reason_codes in cases:
            with self.subTest(state=state, streak=streak):
                export = autopilot.build_monitor_health_export(
                    {
                        "format_version": 1,
                        "observed_at_epoch": NOW,
                        "state": state,
                        "streak": streak,
                    }
                )
                self.assertEqual(set(export), {
                    "format_version", "observed_at_epoch", "health", "reason_codes"
                })
                self.assertEqual(export["health"], health)
                self.assertEqual(export["reason_codes"], reason_codes)

    def test_monitor_health_export_rejects_malformed_fields_and_unsafe_root(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "invalid monitor fields"):
            autopilot.build_monitor_health_export(
                {
                    "format_version": 1,
                    "observed_at_epoch": True,
                    "state": "healthy",
                    "streak": 0,
                }
            )
        with self.assertRaisesRegex(RuntimeError, "unsupported structure"):
            autopilot.build_monitor_health_export(
                {
                    "format_version": True,
                    "observed_at_epoch": NOW,
                    "state": "healthy",
                    "streak": 0,
                }
            )
        self.assertEqual(
            autopilot.build_monitor_health_export(
                {
                    "format_version": 1,
                    "observed_at_epoch": NOW,
                    "state": "healthy",
                    "streak": 3,
                }
            )["reason_codes"],
            ["autopilot_integrity_failure"],
        )
        unsafe_root = mock.Mock(
            st_mode=stat.S_IFDIR | 0o770,
            st_uid=0,
            st_gid=1234,
        )
        with mock.patch.object(
            autopilot.Path, "lstat", return_value=unsafe_root
        ), mock.patch.object(
            autopilot.grp, "getgrnam", return_value=mock.Mock(gr_gid=1234)
        ), self.assertRaisesRegex(RuntimeError, "directory is unsafe"):
            autopilot.publish_monitor_health(
                {
                    "format_version": 1,
                    "observed_at_epoch": NOW,
                    "state": "healthy",
                    "streak": 0,
                }
            )


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

    def test_imminent_uncovered_target_queues_both_authorized_scheduler_lanes(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["coverage"]["fields"]["first_week_targets_imminent_uncovered"] = "1"
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        expected = [
            {
                "kind": "start_scheduler_lane",
                "unit": autopilot.INSTAGRAM_SCHEDULER_UNIT,
            },
            {
                "kind": "start_scheduler_lane",
                "unit": autopilot.SCHEDULER_TICK_UNIT,
            },
        ]
        self.assertIn("first_week_target_imminent_uncovered", issues)
        self.assertEqual(actions, expected)

        selected, suppressed, _ = autopilot.select_automatic_actions(
            {}, actions, NOW
        )
        self.assertEqual(selected, [])
        self.assertEqual(len(suppressed), 2)
        self.assertTrue(
            all(
                item["detail"] == "automatic action awaiting confirmation"
                for item in suppressed
            )
        )
        previous = {
            "issue_streaks": {
                "first_week_target_imminent_uncovered": {
                    "count": 1,
                    "first_seen_epoch": NOW - 300,
                }
            }
        }
        selected, _, _ = autopilot.select_automatic_actions(
            previous, actions, NOW
        )
        self.assertEqual(selected, expected)
        for action in expected:
            self.assertEqual(
                autopilot.automatic_action_command(action),
                [
                    "/usr/bin/systemctl",
                    "start",
                    "--no-block",
                    action["unit"],
                ],
            )

    def test_imminent_target_action_requires_sealed_idle_service_and_live_timer(self) -> None:
        snapshot = healthy_snapshot()
        snapshot["coverage"]["fields"]["first_week_targets_imminent_uncovered"] = "1"
        snapshot["jobs"]["scheduler-tick"]["unit"]["active"] = "active"
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertIn("first_week_target_imminent_uncovered", issues)
        self.assertEqual(
            actions,
            [
                {
                    "kind": "start_scheduler_lane",
                    "unit": autopilot.INSTAGRAM_SCHEDULER_UNIT,
                }
            ],
        )

        snapshot["jobs"]["scheduler-tick"]["unit"]["active"] = "inactive"
        timer = autopilot.JOB_TIMER_UNITS["scheduler-tick"]
        snapshot["timers"][timer]["enabled"] = "disabled"
        actions, _ = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(
            actions,
            [
                {
                    "kind": "start_scheduler_lane",
                    "unit": autopilot.INSTAGRAM_SCHEDULER_UNIT,
                }
            ],
        )

        snapshot["coverage"]["fields"]["instagram_credit_status"] = "depleted"
        actions, _ = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(actions, [])

    def test_missing_imminent_target_telemetry_fails_closed_into_diagnosis(self) -> None:
        snapshot = healthy_snapshot()
        del snapshot["coverage"]["fields"]["first_week_targets_imminent_uncovered"]
        actions, issues = autopilot.evaluate_snapshot(snapshot)
        self.assertEqual(actions, [])
        self.assertIn("first_week_target_imminent_telemetry_missing", issues)

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

    def test_target_outcome_regression_is_scoped_to_accepted_baseline(self) -> None:
        snapshot = healthy_snapshot()
        key = "first_week_targets_enforced_missed"
        baseline = {
            item: int(snapshot["coverage"]["fields"][item])
            for item in autopilot.COVERAGE_REGRESSION_LIMITS
        }
        snapshot["coverage"]["fields"][key] = str(baseline[key] + 1)
        _, issues = autopilot.evaluate_snapshot(snapshot, baseline)
        self.assertIn(
            f"coverage_regressed:{key}:baseline={baseline[key]}", issues
        )

    def test_dispatched_target_regression_advances_baseline_once(self) -> None:
        snapshot = healthy_snapshot()
        key = "first_week_targets_current_enforced_outside_target"
        baseline = {
            item: int(snapshot["coverage"]["fields"][item])
            for item in autopilot.COVERAGE_REGRESSION_LIMITS
        }
        snapshot["coverage"]["fields"][key] = str(baseline[key] + 1)
        _, issues = autopilot.evaluate_snapshot(snapshot, baseline)
        issue = f"coverage_regressed:{key}:baseline={baseline[key]}"
        self.assertIn(issue, issues)

        state: dict = {}
        for _ in range(3):
            state, dispatch, _ = autopilot.update_incident_state(
                state, snapshot, [issue]
            )
            snapshot["observed_at_epoch"] += 300
        self.assertTrue(dispatch)

        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value=None,
        ):
            pending = autopilot.accept_dispatched_target_regressions(
                baseline, snapshot, state
            )
        self.assertEqual(pending[key], baseline[key])
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="operator_required",
        ):
            operator_pending = autopilot.accept_dispatched_target_regressions(
                baseline, snapshot, state
            )
            autopilot.fold_pipeline_notification_state(state, None)
        self.assertEqual(operator_pending[key], baseline[key])
        self.assertEqual(state["status"], "operator_required")
        self.assertIn(
            issue, autopilot.evaluate_snapshot(snapshot, operator_pending)[1]
        )

        # A second miss that lands while the first investigation runs must not
        # be blessed by the first incident's later status-only result.
        snapshot["coverage"]["fields"][key] = str(baseline[key] + 2)
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            accepted = autopilot.accept_dispatched_target_regressions(
                baseline, snapshot, state
            )
        self.assertEqual(accepted[key], baseline[key] + 1)
        _, repeated_issues = autopilot.evaluate_snapshot(snapshot, accepted)
        self.assertNotIn(issue, repeated_issues)

        snapshot["coverage"]["fields"][key] = str(accepted[key] + 1)
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            still_accepted = autopilot.accept_dispatched_target_regressions(
                accepted, snapshot, state
            )
        self.assertEqual(still_accepted[key], accepted[key])
        _, new_issues = autopilot.evaluate_snapshot(snapshot, accepted)
        self.assertIn(
            f"coverage_regressed:{key}:baseline={accepted[key]}", new_issues
        )

    def test_legacy_dispatched_target_regression_is_accepted(self) -> None:
        snapshot = healthy_snapshot()
        key = "first_week_targets_enforced_outside_target"
        current = int(snapshot["coverage"]["fields"][key])
        baseline = {
            item: int(snapshot["coverage"]["fields"][item])
            for item in autopilot.COVERAGE_REGRESSION_LIMITS
        }
        baseline[key] = current - 1
        previous = {
            "issue_streaks": {
                f"coverage_regressed:{key}": {
                    "count": 9,
                    "first_seen_epoch": NOW - 900,
                    "dispatched_at_epoch": NOW - 600,
                }
            },
            "dispatches": [
                {
                    "at_epoch": NOW - 600,
                    "fingerprint": "d" * 64,
                    "incident_id": "20260903T010000Z-" + "d" * 16,
                    "target_outcomes": {key: current},
                }
            ],
        }
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            accepted = autopilot.accept_dispatched_target_regressions(
                baseline, snapshot, previous
            )
        self.assertEqual(accepted[key], current)
        _, issues = autopilot.evaluate_snapshot(snapshot, accepted)
        self.assertFalse(
            any(issue.startswith(f"coverage_regressed:{key}") for issue in issues)
        )

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


class InitialBaselineTests(unittest.TestCase):
    @staticmethod
    def partial_snapshot(observed_at_epoch: int = NOW) -> tuple[dict, dict[str, int]]:
        snapshot = healthy_snapshot()
        snapshot["observed_at_epoch"] = observed_at_epoch
        del snapshot["coverage"]["fields"]["failed_tiktok_videos"]
        baseline = autopilot.next_coverage_baseline({}, snapshot)
        return snapshot, baseline

    @staticmethod
    def waiting_state(record: dict[str, int], baseline: dict[str, int]) -> dict:
        return {
            "format_version": 1,
            "dispatches": [],
            "automatic_actions": [],
            "coverage_baseline": baseline,
            "coverage_baseline_release": "a" * 64,
            "last_probe_epoch": record["first_seen_epoch"],
            "status": "awaiting_baseline",
            "fingerprint": None,
            "streak": 0,
            "issue_streaks": {autopilot.INITIAL_BASELINE_ISSUE: record},
        }

    def test_normal_bootstrap_is_silent_then_enters_normal_incident_flow(self) -> None:
        snapshot, baseline = self.partial_snapshot()
        waiting, actions, issues, first = autopilot.initial_baseline_probe(
            {}, snapshot, baseline
        )
        self.assertTrue(waiting)
        self.assertEqual(actions, [])
        self.assertEqual(issues, [autopilot.INITIAL_BASELINE_ISSUE])
        self.assertEqual(first["count"], 1)

        previous = self.waiting_state(first, baseline)
        waiting, _, _, second = autopilot.initial_baseline_probe(
            previous, snapshot, baseline
        )
        self.assertTrue(waiting)
        self.assertEqual(second["count"], 2)

        previous = self.waiting_state(second, baseline)
        previous["last_probe_epoch"] = snapshot["observed_at_epoch"]
        waiting, actions, issues, third = autopilot.initial_baseline_probe(
            previous, snapshot, baseline
        )
        self.assertFalse(waiting)
        self.assertEqual(third["count"], autopilot.INITIAL_BASELINE_MAX_PROBES)
        self.assertIn(autopilot.INITIAL_BASELINE_ISSUE, issues)
        self.assertIn(
            "coverage_baseline_telemetry_missing:failed_tiktok_videos", issues
        )

        state, dispatch, _ = autopilot.update_incident_state(
            previous, snapshot, issues
        )
        self.assertTrue(dispatch)
        self.assertEqual(state["status"], "codex_queued")
        state["automatic_actions"] = []
        state["coverage_baseline"] = baseline
        state["coverage_baseline_release"] = snapshot["release_id"]
        self.assertIsNone(autopilot.state_shape_error(state))

    def test_bootstrap_age_bound_does_not_require_three_tightly_spaced_probes(self) -> None:
        snapshot, baseline = self.partial_snapshot()
        first_seen = NOW - autopilot.INITIAL_BASELINE_MAX_AGE_SECONDS
        previous = self.waiting_state(
            {"count": 1, "first_seen_epoch": first_seen}, baseline
        )
        waiting, _, issues, _ = autopilot.initial_baseline_probe(
            previous, snapshot, baseline
        )
        self.assertFalse(waiting)
        self.assertIn(autopilot.INITIAL_BASELINE_ISSUE, issues)

    def test_release_and_unit_faults_bypass_bootstrap_wait(self) -> None:
        snapshot, baseline = self.partial_snapshot()
        snapshot["release_integrity"] = {"ready": False, "detail": "drift"}
        timer = autopilot.TIMER_UNITS[0]
        snapshot["timers"][timer]["active"] = "inactive"
        waiting, actions, issues, first = autopilot.initial_baseline_probe(
            {}, snapshot, baseline
        )
        self.assertFalse(waiting)
        self.assertEqual(first["count"], 1)
        self.assertIn("release_integrity_invalid", issues)
        self.assertIn(f"timer_inactive:{timer}", issues)
        self.assertIn({"kind": "start_timer", "unit": timer}, actions)
        self.assertNotIn(
            "coverage_baseline_telemetry_missing:failed_tiktok_videos", issues
        )


class AutomaticSchedulerExecutionTests(unittest.TestCase):
    @staticmethod
    def actions() -> list[dict[str, str]]:
        return [
            {
                "kind": "start_scheduler_lane",
                "unit": autopilot.INSTAGRAM_SCHEDULER_UNIT,
            },
            {
                "kind": "start_scheduler_lane",
                "unit": autopilot.SCHEDULER_TICK_UNIT,
            },
        ]

    def execute(
        self, fields: dict[str, str], unit_states: dict[str, dict] | None = None
    ) -> tuple[list[dict], mock.Mock]:
        snapshot = healthy_snapshot()
        with tempfile.TemporaryDirectory() as temporary:
            activation_lock = Path(temporary) / "activation.lock"
            activation_lock.write_text("\n")
            activation_lock.chmod(0o600)
            real_lstat = Path.lstat

            def safe_lstat(path: Path):
                info = real_lstat(path)
                if path == activation_lock:
                    return mock.Mock(
                        st_uid=0,
                        st_gid=0,
                        st_nlink=1,
                        st_mode=stat.S_IFREG | 0o600,
                    )
                return info

            def current_unit_state(name: str) -> dict:
                if unit_states and name in unit_states:
                    return unit_states[name]
                if name in autopilot.IMMINENT_TARGET_SCHEDULER_UNITS:
                    return {"load": "loaded", "active": "inactive"}
                return {
                    "load": "loaded",
                    "enabled": "enabled",
                    "active": "active",
                }

            run_result = autopilot.subprocess.CompletedProcess([], 0, "", "")
            with mock.patch.multiple(
                autopilot,
                ACTIVATION_LOCK=activation_lock,
            ), mock.patch.object(
                autopilot.Path, "lstat", autospec=True, side_effect=safe_lstat
            ), mock.patch.object(
                autopilot.os.path, "lexists", return_value=False
            ), mock.patch.object(
                autopilot, "release_identity",
                return_value=(
                    snapshot["release_id"],
                    True,
                    snapshot["release_path"],
                ),
            ), mock.patch.object(
                autopilot, "latest_activation_epoch", return_value=NOW - 3600
            ), mock.patch.object(
                autopilot, "cutover_gate_snapshot", return_value={"ready": True}
            ), mock.patch.object(
                autopilot, "verify_installed_release", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot, "verify_effective_unit", return_value=(True, "verified")
            ), mock.patch.object(
                autopilot, "unit_snapshot", side_effect=current_unit_state
            ), mock.patch.object(
                autopilot,
                "latest_coverage",
                return_value={"observed_at_epoch": NOW - 30, "fields": fields},
            ), mock.patch.object(
                autopilot.time, "time", return_value=NOW
            ), mock.patch.object(
                autopilot, "run", return_value=run_result
            ) as run_mock:
                results = autopilot.execute_actions(snapshot, self.actions())
        return results, run_mock

    def test_starts_both_still_authorized_sealed_lanes_without_blocking(self) -> None:
        fields = healthy_snapshot()["coverage"]["fields"]
        fields["first_week_targets_imminent_uncovered"] = "1"
        results, run_mock = self.execute(fields)
        self.assertTrue(all(item["ok"] for item in results))
        self.assertEqual(
            [call.args[0] for call in run_mock.call_args_list],
            [
                [
                    "/usr/bin/systemctl",
                    "start",
                    "--no-block",
                    autopilot.INSTAGRAM_SCHEDULER_UNIT,
                ],
                [
                    "/usr/bin/systemctl",
                    "start",
                    "--no-block",
                    autopilot.SCHEDULER_TICK_UNIT,
                ],
            ],
        )

    def test_rechecks_credit_and_timer_gates_before_launch(self) -> None:
        fields = healthy_snapshot()["coverage"]["fields"]
        fields["first_week_targets_imminent_uncovered"] = "1"
        fields["instagram_credit_status"] = "depleted"
        tiktok_timer = autopilot.JOB_TIMER_UNITS["scheduler-tick"]
        results, run_mock = self.execute(
            fields,
            {
                tiktok_timer: {
                    "load": "loaded",
                    "enabled": "disabled",
                    "active": "inactive",
                }
            },
        )
        self.assertFalse(any(item["ok"] for item in results))
        self.assertIn("provider gates", results[0]["detail"])
        self.assertIn("no longer enabled and active", results[1]["detail"])
        run_mock.assert_not_called()


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

    def test_daily_budget_reserves_a_third_independent_incident(self) -> None:
        snapshot = healthy_snapshot()
        issue = "tiktok_target_capacity_not_feasible"
        previous = {
            "issue_streaks": {
                issue: {
                    "count": 2,
                    "first_seen_epoch": NOW
                    - autopilot.DISPATCH_MIN_AGE_SECONDS[issue],
                }
            },
            "dispatches": [
                {
                    "fingerprint": str(index) * 64,
                    "at_epoch": NOW - index * 60,
                    "incident_id": f"20260903T00000{index}Z-{str(index) * 16}",
                }
                for index in (1, 2)
            ],
        }
        state, dispatch, incident_id = autopilot.update_incident_state(
            previous, snapshot, [issue]
        )
        self.assertTrue(dispatch)
        self.assertRegex(incident_id or "", autopilot.INCIDENT_RE)
        self.assertEqual(len(state["dispatches"]), 3)

    def test_daily_budget_blocks_a_fourth_independent_incident(self) -> None:
        snapshot = healthy_snapshot()
        issue = "tiktok_target_capacity_not_feasible"
        previous = {
            "issue_streaks": {
                issue: {
                    "count": 2,
                    "first_seen_epoch": NOW
                    - autopilot.DISPATCH_MIN_AGE_SECONDS[issue],
                }
            },
            "dispatches": [
                {
                    "fingerprint": str(index) * 64,
                    "at_epoch": NOW - index * 60,
                    "incident_id": f"20260903T00000{index}Z-{str(index) * 16}",
                }
                for index in (1, 2, 3)
            ],
        }
        state, dispatch, incident_id = autopilot.update_incident_state(
            previous, snapshot, [issue]
        )
        self.assertFalse(dispatch)
        self.assertIsNone(incident_id)
        self.assertEqual(len(state["dispatches"]), 3)

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
    def test_accepts_strict_partial_baseline_only_during_bounded_bootstrap(self) -> None:
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
        state["status"] = "incident_pending"
        state["fingerprint"] = "d" * 64
        state["streak"] = 3
        state["issue_streaks"] = {
            autopilot.INITIAL_BASELINE_ISSUE: {
                "count": 3,
                "first_seen_epoch": NOW - 600,
            }
        }
        self.assertIsNone(autopilot.state_shape_error(state))
        del state["issue_streaks"][autopilot.INITIAL_BASELINE_ISSUE]
        state["status"] = "healthy"
        state["fingerprint"] = None
        state["streak"] = 0
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
        current_fingerprint = "d" * 64
        incident_id = "20260903T010000Z-" + "d" * 16
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
                    "status": "incident_pending",
                    "fingerprint": current_fingerprint,
                    "streak": 1,
                    "issue_streaks": {
                        "coverage_snapshot_stale": {
                            "count": 1,
                            "first_seen_epoch": NOW,
                        }
                    },
                    "status_only_retry": {
                        "fingerprint": current_fingerprint,
                        "incident_id": incident_id,
                        "investigations": 1,
                        "issues": ["coverage_snapshot_stale"],
                        "retry_after_epoch": NOW + 3600,
                    },
                    "current_incident": {
                        "fingerprint": current_fingerprint,
                        "incident_id": incident_id,
                        "at_epoch": NOW - 300,
                        "target_outcomes": {},
                    },
                }
            )
        )

    def test_rejects_unbounded_status_only_retry(self) -> None:
        state = {
            "format_version": 1,
            "dispatches": [],
            "automatic_actions": [],
            "coverage_baseline": {
                key: 0 for key in autopilot.COVERAGE_REGRESSION_LIMITS
            },
            "coverage_baseline_release": "a" * 64,
            "last_probe_epoch": NOW,
            "status": "incident_pending",
            "fingerprint": "d" * 64,
            "streak": 1,
            "issue_streaks": {
                "coverage_snapshot_stale": {
                    "count": 1,
                    "first_seen_epoch": NOW,
                }
            },
            "status_only_retry": {
                "fingerprint": "d" * 64,
                "incident_id": "20260903T010000Z-" + "d" * 16,
                "investigations": autopilot.MAX_STATUS_ONLY_INVESTIGATIONS + 1,
                "issues": ["coverage_snapshot_stale"],
                "retry_after_epoch": NOW + 3600,
            },
        }
        self.assertIsNotNone(autopilot.state_shape_error(state))

    def test_operator_requirement_must_match_current_operator_state(self) -> None:
        current_fingerprint = "e" * 64
        state = {
            "format_version": 1,
            "dispatches": [],
            "automatic_actions": [],
            "coverage_baseline": {
                key: 0 for key in autopilot.COVERAGE_REGRESSION_LIMITS
            },
            "coverage_baseline_release": "a" * 64,
            "last_probe_epoch": NOW,
            "status": "operator_required",
            "fingerprint": current_fingerprint,
            "streak": 3,
            "issue_streaks": {
                "coverage_snapshot_stale": {
                    "count": 3,
                    "first_seen_epoch": NOW - 600,
                    "dispatched_at_epoch": NOW - 300,
                }
            },
            "operator_requirement": {
                "fingerprint": current_fingerprint,
                "incident_id": "20260903T010000Z-" + "e" * 16,
                "reason": "trusted_report",
            },
        }
        self.assertIsNone(autopilot.state_shape_error(state))
        state["operator_requirement"] = {
            **state["operator_requirement"],
            "fingerprint": "f" * 64,
        }
        self.assertIsNotNone(autopilot.state_shape_error(state))
        state["operator_requirement"]["fingerprint"] = current_fingerprint
        state["status"] = "healthy"
        self.assertIsNotNone(autopilot.state_shape_error(state))

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
    def result(
        status: str,
        recommendation: str,
        changed_files: list[str],
        operator_action: str | None = "none",
    ) -> bytes:
        value = {
            "status": status,
            "production_recommendation": recommendation,
            "changed_files": changed_files,
        }
        if operator_action is not None:
            value["operator_action"] = operator_action
        return (autopilot.json.dumps(value) + "\n").encode()

    def test_trusted_actionable_outcomes_are_terminal(self) -> None:
        cases = (
            ("no_action", "none", [], "none", "status_only"),
            ("external_or_data_issue", "none", [], "none", "status_only"),
            (
                "external_or_data_issue",
                "operator_action_required",
                [],
                "restore_tiktok_access",
                "operator_required",
            ),
            (
                "verified_candidate",
                "review_candidate",
                ["src/sync/fix.ts"],
                "review_candidate",
                "operator_required",
            ),
        )
        for status, recommendation, changed_files, operator_action, disposition in cases:
            with self.subTest(status=status):
                result = self.result(
                    status, recommendation, changed_files, operator_action
                )
                self.assertTrue(
                    autopilot.trusted_report_is_terminal(
                        b"0\n", result
                    )
                )
                self.assertEqual(
                    autopilot.trusted_report_disposition(b"0\n", result),
                    disposition,
                )

    def test_legacy_external_result_without_concrete_action_is_status_only(self) -> None:
        result = self.result(
            "external_or_data_issue", "operator_action_required", [], None
        )
        self.assertEqual(
            autopilot.trusted_report_disposition(b"0\n", result), "status_only"
        )

    def test_complete_trusted_failures_require_operator(self) -> None:
        cases = (
            (b"1\n", self.result("no_action", "none", [])),
            (b"0\n", self.result("failed", "operator_action_required", [])),
            (b"0\n", self.result("needs_human", "operator_action_required", [])),
        )
        for trusted_exit, result in cases:
            with self.subTest(trusted_exit=trusted_exit, result=result):
                self.assertEqual(
                    autopilot.trusted_report_disposition(trusted_exit, result),
                    "operator_required",
                )
                self.assertTrue(
                    autopilot.trusted_report_is_terminal(trusted_exit, result)
                )

    def test_malformed_or_incoherent_reports_are_not_trusted(self) -> None:
        self.assertIsNone(
            autopilot.trusted_report_disposition(
                b"bad\n", self.result("no_action", "none", [])
            )
        )
        self.assertFalse(
            autopilot.trusted_report_is_terminal(
                b"0\n",
                self.result(
                    "verified_candidate", "review_candidate", [], "review_candidate"
                ),
            )
        )


class PipelineNotificationTests(unittest.TestCase):
    @staticmethod
    def dispatched_state() -> dict:
        issue = "coverage_snapshot_stale"
        release_id = "a" * 64
        current_fingerprint = autopilot.fingerprint(release_id, [issue])
        incident_id = "20260903T010000Z-" + "a" * 16
        return {
            "status": "incident_pending",
            "fingerprint": current_fingerprint,
            "streak": 4,
            "last_probe_epoch": NOW,
            "issues": [issue],
            "issue_streaks": {
                issue: {
                    "count": 4,
                    "first_seen_epoch": NOW - 900,
                    "dispatched_at_epoch": NOW - 300,
                }
            },
            "dispatches": [
                {
                    "at_epoch": NOW - 300,
                    "fingerprint": current_fingerprint,
                    "incident_id": incident_id,
                }
            ],
            "current_incident": {
                "fingerprint": current_fingerprint,
                "incident_id": incident_id,
                "at_epoch": NOW - 300,
                "target_outcomes": {},
            },
        }

    def test_active_and_status_only_pipeline_states_do_not_page(self) -> None:
        active = self.dispatched_state()
        with mock.patch.object(
            autopilot, "trusted_report_disposition_for_incident", return_value=None
        ), mock.patch.object(
            autopilot, "dead_letter_incident_exists", return_value=False
        ), mock.patch.object(
            autopilot, "incident_pipeline_has_work", return_value=True
        ):
            autopilot.fold_pipeline_notification_state(active, {"ok": True})
        self.assertEqual(active["status"], "codex_queued")
        self.assertNotIn("operator_requirement", active)

        diagnosed = self.dispatched_state()
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            autopilot.fold_pipeline_notification_state(diagnosed, None)
        self.assertEqual(diagnosed["status"], "incident_pending")
        self.assertNotIn("operator_requirement", diagnosed)
        self.assertEqual(
            diagnosed["status_only_retry"]["retry_after_epoch"],
            NOW + autopilot.STATUS_ONLY_RETRY_COOLDOWN_SECONDS,
        )

    def test_status_only_gets_one_cooled_down_reinvestigation_then_stays_silent(self) -> None:
        state = self.dispatched_state()
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            autopilot.fold_pipeline_notification_state(state, None)
            issue = state["issues"][0]
            self.assertIn(
                "dispatched_at_epoch", state["issue_streaks"][issue]
            )

            state["last_probe_epoch"] += autopilot.STATUS_ONLY_RETRY_COOLDOWN_SECONDS
            autopilot.fold_pipeline_notification_state(state, None)
            self.assertNotIn(
                "dispatched_at_epoch", state["issue_streaks"][issue]
            )

        snapshot = healthy_snapshot()
        snapshot["observed_at_epoch"] = state["last_probe_epoch"] + 300
        retried, dispatch, second_incident = autopilot.update_incident_state(
            state, snapshot, [issue]
        )
        self.assertTrue(dispatch)
        self.assertIsNotNone(second_incident)
        self.assertNotEqual(
            second_incident, state["status_only_retry"]["incident_id"]
        )

        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            autopilot.fold_pipeline_notification_state(retried, None)
            self.assertEqual(
                retried["status_only_retry"]["investigations"],
                autopilot.MAX_STATUS_ONLY_INVESTIGATIONS,
            )
            retried["last_probe_epoch"] += (
                autopilot.STATUS_ONLY_RETRY_COOLDOWN_SECONDS * 2
            )
            autopilot.fold_pipeline_notification_state(retried, None)

        self.assertEqual(retried["status"], "incident_pending")
        self.assertIn(
            "dispatched_at_epoch", retried["issue_streaks"][issue]
        )
        self.assertNotIn("operator_requirement", retried)

    def test_status_only_retry_survives_pruned_dispatch_history_after_reboot(self) -> None:
        state = self.dispatched_state()
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            autopilot.fold_pipeline_notification_state(state, None)
            incident_id = state["status_only_retry"]["incident_id"]
            state["dispatches"] = []
            state["last_probe_epoch"] += (
                autopilot.STATUS_ONLY_RETRY_COOLDOWN_SECONDS + 24 * 60 * 60
            )
            self.assertEqual(
                autopilot.current_dispatched_incident_id(state), incident_id
            )
            autopilot.fold_pipeline_notification_state(state, None)

        issue = state["issues"][0]
        self.assertNotIn(
            "dispatched_at_epoch", state["issue_streaks"][issue]
        )
        self.assertEqual(state["status"], "incident_pending")

    def test_status_only_retry_survives_target_baseline_fingerprint_reduction(self) -> None:
        target_issue = (
            "coverage_regressed:"
            "first_week_targets_current_enforced_outside_target:baseline=174"
        )
        ongoing_issue = "tiktok_direct_observation_stale"
        release_id = "a" * 64
        combined_fingerprint = autopilot.fingerprint(
            release_id, [target_issue, ongoing_issue]
        )
        incident_id = "20260903T010000Z-" + combined_fingerprint[:16]
        state = {
            "status": "incident_pending",
            "fingerprint": combined_fingerprint,
            "streak": 3,
            "last_probe_epoch": NOW,
            "issues": [target_issue, ongoing_issue],
            "issue_streaks": {
                issue: {
                    "count": 3,
                    "first_seen_epoch": NOW - 600,
                    "dispatched_at_epoch": NOW - 300,
                }
                for issue in (target_issue, ongoing_issue)
            },
            "dispatches": [
                {
                    "at_epoch": NOW - 300,
                    "fingerprint": combined_fingerprint,
                    "incident_id": incident_id,
                    "target_outcomes": {
                        "first_week_targets_current_enforced_outside_target": 175
                    },
                }
            ],
            "current_incident": {
                "fingerprint": combined_fingerprint,
                "incident_id": incident_id,
                "at_epoch": NOW - 300,
                "target_outcomes": {
                    "first_week_targets_current_enforced_outside_target": 175
                },
            },
        }
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            autopilot.fold_pipeline_notification_state(state, None)
            snapshot = healthy_snapshot()
            snapshot["observed_at_epoch"] = NOW + 300
            snapshot["coverage"]["fields"][
                "first_week_targets_current_enforced_outside_target"
            ] = "175"
            snapshot["coverage"]["fields"]["latest_tiktok_direct_age_seconds"] = str(
                autopilot.TIKTOK_DIRECT_MAX_AGE + 1
            )
            baseline = {
                key: int(snapshot["coverage"]["fields"][key])
                for key in autopilot.COVERAGE_REGRESSION_LIMITS
            }
            baseline[
                "first_week_targets_current_enforced_outside_target"
            ] = 174
            accepted = autopilot.accept_dispatched_target_regressions(
                baseline, snapshot, state
            )
            _, reduced_issues = autopilot.evaluate_snapshot(snapshot, accepted)
            reduced, dispatch, _ = autopilot.update_incident_state(
                state, snapshot, reduced_issues
            )
        self.assertFalse(dispatch)
        self.assertNotIn(target_issue, reduced_issues)
        self.assertIn(ongoing_issue, reduced_issues)
        self.assertNotIn("current_incident", reduced)
        self.assertEqual(
            reduced["status_only_retry"]["issues"], [ongoing_issue]
        )
        self.assertEqual(
            reduced["status_only_retry"]["fingerprint"],
            reduced["fingerprint"],
        )

        reduced["last_probe_epoch"] = reduced["status_only_retry"][
            "retry_after_epoch"
        ]
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="status_only",
        ):
            autopilot.fold_pipeline_notification_state(reduced, None)
        self.assertNotIn(
            "dispatched_at_epoch",
            reduced["issue_streaks"][ongoing_issue],
        )
        self.assertEqual(reduced["status"], "incident_pending")

    def test_operator_outcome_survives_more_than_24_hours_offline(self) -> None:
        issue = "coverage_snapshot_stale"
        for disposition, dead_letter, expected_reason in (
            ("operator_required", False, "trusted_report"),
            (None, True, "dead_letter"),
        ):
            with self.subTest(reason=expected_reason):
                previous = self.dispatched_state()
                old_dispatch_epoch = NOW - 25 * 60 * 60
                previous["dispatches"][0]["at_epoch"] = old_dispatch_epoch
                previous["current_incident"]["at_epoch"] = old_dispatch_epoch
                previous["issue_streaks"][issue][
                    "first_seen_epoch"
                ] = old_dispatch_epoch - 300
                previous["issue_streaks"][issue][
                    "dispatched_at_epoch"
                ] = old_dispatch_epoch
                state, dispatch, _ = autopilot.update_incident_state(
                    previous, healthy_snapshot(), [issue]
                )
                self.assertFalse(dispatch)
                self.assertEqual(state["dispatches"], [])
                self.assertEqual(
                    autopilot.current_dispatched_incident_id(state),
                    previous["current_incident"]["incident_id"],
                )
                with mock.patch.object(
                    autopilot,
                    "trusted_report_disposition_for_incident",
                    return_value=disposition,
                ), mock.patch.object(
                    autopilot,
                    "dead_letter_incident_exists",
                    return_value=dead_letter,
                ):
                    autopilot.fold_pipeline_notification_state(state, None)
                self.assertEqual(state["status"], "operator_required")
                self.assertEqual(
                    state["operator_requirement"]["reason"], expected_reason
                )

    def test_verified_operator_outcome_and_dead_letter_page(self) -> None:
        for disposition, dead_letter, expected_reason in (
            ("operator_required", False, "trusted_report"),
            (None, True, "dead_letter"),
        ):
            with self.subTest(reason=expected_reason):
                state = self.dispatched_state()
                with mock.patch.object(
                    autopilot,
                    "trusted_report_disposition_for_incident",
                    return_value=disposition,
                ), mock.patch.object(
                    autopilot,
                    "dead_letter_incident_exists",
                    return_value=dead_letter,
                ):
                    autopilot.fold_pipeline_notification_state(state, None)
                self.assertEqual(state["status"], "operator_required")
                self.assertEqual(
                    state["operator_requirement"]["reason"], expected_reason
                )

    def test_pipeline_failure_pages_but_unrelated_or_budget_limited_state_does_not(self) -> None:
        state = self.dispatched_state()
        with mock.patch.object(
            autopilot, "trusted_report_disposition_for_incident", return_value=None
        ), mock.patch.object(
            autopilot, "dead_letter_incident_exists", return_value=False
        ):
            autopilot.fold_pipeline_notification_state(state, {"ok": False})
        self.assertEqual(state["status"], "operator_required")
        self.assertEqual(
            state["operator_requirement"]["reason"], "pipeline_unavailable"
        )

        budget_limited = {
            "status": "incident_pending",
            "fingerprint": "b" * 64,
            "streak": 10,
            "issues": ["coverage_snapshot_stale"],
            "dispatches": self.dispatched_state()["dispatches"],
        }
        autopilot.fold_pipeline_notification_state(budget_limited, None)
        self.assertEqual(budget_limited["status"], "incident_pending")
        self.assertNotIn("operator_requirement", budget_limited)

    def test_dispatched_orphan_without_pipeline_evidence_requires_operator(self) -> None:
        state = self.dispatched_state()
        with mock.patch.object(
            autopilot, "trusted_report_disposition_for_incident", return_value=None
        ), mock.patch.object(
            autopilot, "dead_letter_incident_exists", return_value=False
        ), mock.patch.object(
            autopilot, "incident_pipeline_has_work", return_value=False
        ):
            autopilot.fold_pipeline_notification_state(state, None)
        self.assertEqual(state["status"], "operator_required")
        self.assertEqual(
            state["operator_requirement"]["reason"], "pipeline_unavailable"
        )

    def test_rejected_attempt_without_inbox_requires_operator(self) -> None:
        state = self.dispatched_state()
        incident_id = state["current_incident"]["incident_id"]
        with tempfile.TemporaryDirectory() as temporary:
            rejected = Path(temporary) / "rejected"
            rejected.mkdir()
            (rejected / f"{incident_id}.attempt.ABC123").mkdir()
            with mock.patch.object(
                autopilot, "VERIFICATION_REJECTED_DIR", rejected
            ), mock.patch.object(
                autopilot,
                "trusted_report_disposition_for_incident",
                return_value=None,
            ), mock.patch.object(
                autopilot, "dead_letter_incident_exists", return_value=False
            ):
                autopilot.fold_pipeline_notification_state(state, None)
        self.assertEqual(state["status"], "operator_required")
        self.assertEqual(
            state["operator_requirement"]["reason"], "rejected_attempt"
        )

    def test_final_report_directory_is_not_active_pipeline_work(self) -> None:
        incident_id = self.dispatched_state()["current_incident"]["incident_id"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = {
                "QUEUE_DIR": root / "queue",
                "INBOX_DIR": root / "inbox",
                "PROCESSING_DIR": root / "processing",
                "PRODUCING_DIR": root / "producing",
                "READY_DIR": root / "ready",
                "VERIFICATION_PROCESSING_DIR": root / "verification-processing",
                "REPORTS_DIR": root / "reports",
            }
            for path in paths.values():
                path.mkdir()
            (paths["REPORTS_DIR"] / f"{incident_id}.attempt.ABC123").mkdir()
            with mock.patch.multiple(autopilot, **paths):
                self.assertFalse(autopilot.incident_pipeline_has_work(incident_id))

    def test_recent_dispatch_is_migrated_to_durable_current_incident(self) -> None:
        previous = self.dispatched_state()
        expected = previous.pop("current_incident")
        issue = previous["issues"][0]
        state, dispatch, _ = autopilot.update_incident_state(
            previous, healthy_snapshot(), [issue]
        )
        self.assertFalse(dispatch)
        self.assertEqual(state["current_incident"], expected)

    def test_operator_latch_survives_same_fingerprint_and_clears_on_resolution(self) -> None:
        issue = "coverage_snapshot_stale"
        snapshot = healthy_snapshot()
        current_fingerprint = autopilot.fingerprint(snapshot["release_id"], [issue])
        incident_id = "20260903T010000Z-" + "a" * 16
        previous = {
            "issue_streaks": {
                issue: {
                    "count": 4,
                    "first_seen_epoch": NOW - 900,
                    "dispatched_at_epoch": NOW - 600,
                }
            },
            "dispatches": [
                {
                    "at_epoch": NOW - 600,
                    "fingerprint": current_fingerprint,
                    "incident_id": incident_id,
                }
            ],
            "operator_requirement": {
                "fingerprint": current_fingerprint,
                "incident_id": incident_id,
                "reason": "trusted_report",
            },
        }
        state, dispatch, _ = autopilot.update_incident_state(
            previous, snapshot, [issue]
        )
        self.assertFalse(dispatch)
        self.assertEqual(state["status"], "operator_required")
        self.assertEqual(state["operator_requirement"], previous["operator_requirement"])

        resolved, _, _ = autopilot.update_incident_state(state, snapshot, [])
        self.assertEqual(resolved["status"], "healthy")
        self.assertNotIn("operator_requirement", resolved)

    def test_operator_outcome_survives_same_probe_fingerprint_reduction(self) -> None:
        surviving_issue = "coverage_snapshot_stale"
        cleared_issue = "tiktok_direct_observation_stale"
        release_id = "a" * 64
        combined_fingerprint = autopilot.fingerprint(
            release_id, [surviving_issue, cleared_issue]
        )
        incident_id = "20260903T010000Z-" + combined_fingerprint[:16]
        previous = {
            "status": "codex_queued",
            "fingerprint": combined_fingerprint,
            "streak": 4,
            "last_probe_epoch": NOW,
            "issues": [surviving_issue, cleared_issue],
            "issue_streaks": {
                issue: {
                    "count": 4,
                    "first_seen_epoch": NOW - 900,
                    "dispatched_at_epoch": NOW - 300,
                }
                for issue in (surviving_issue, cleared_issue)
            },
            "dispatches": [
                {
                    "at_epoch": NOW - 300,
                    "fingerprint": combined_fingerprint,
                    "incident_id": incident_id,
                }
            ],
            "current_incident": {
                "fingerprint": combined_fingerprint,
                "incident_id": incident_id,
                "at_epoch": NOW - 300,
                "target_outcomes": {},
            },
        }
        with mock.patch.object(
            autopilot,
            "trusted_report_disposition_for_incident",
            return_value="operator_required",
        ):
            autopilot.fold_pipeline_notification_state(previous, None)
        self.assertEqual(previous["status"], "operator_required")

        snapshot = healthy_snapshot()
        snapshot["observed_at_epoch"] = NOW + 300
        state, dispatch, _ = autopilot.update_incident_state(
            previous, snapshot, [surviving_issue]
        )
        self.assertFalse(dispatch)
        self.assertEqual(state["status"], "operator_required")
        self.assertEqual(
            state["operator_requirement"],
            {
                "fingerprint": state["fingerprint"],
                "incident_id": incident_id,
                "reason": "trusted_report",
            },
        )
        self.assertEqual(state["current_incident"]["incident_id"], incident_id)

        resolved, _, _ = autopilot.update_incident_state(state, snapshot, [])
        self.assertEqual(resolved["status"], "healthy")
        self.assertNotIn("operator_requirement", resolved)


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

    def test_one_untrusted_finalized_attempt_gets_one_bounded_retry(self) -> None:
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

    def test_two_untrusted_finalized_attempts_dead_letter_without_looping(self) -> None:
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
