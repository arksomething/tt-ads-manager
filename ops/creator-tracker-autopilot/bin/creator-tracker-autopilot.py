#!/usr/bin/python3 -I
"""Actionable incident detection for the laptop-hosted creator tracker.

The normal dashboard health check intentionally reports inherited coverage debt.
This sentinel instead detects new operational regressions, applies a very small
allowlist of reversible systemd repairs, and queues a sandboxed Codex diagnosis
only after the same problem survives three consecutive probes.
"""

from __future__ import annotations

import argparse
import calendar
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat as stat_module
import subprocess
import sys
import time
from typing import Any


STATE_ROOT = Path("/var/lib/creator-tracker-autopilot")
TRACKER_STATE_ROOT = Path("/var/lib/creator-tracker/state")
SELECTOR = Path("/opt/creator-tracker/current")
ACTIVATION_MARKER = Path("/opt/creator-tracker/ACTIVATION_IN_PROGRESS")
ACTIVATION_LOCK = Path("/opt/creator-tracker/activation.lock")
STATE_FILE = STATE_ROOT / "state.json"
STATUS_FILE = STATE_ROOT / "status.json"
LOCK_FILE = Path("/run/creator-tracker-autopilot/root/probe.lock")
QUEUE_DIR = STATE_ROOT / "queue"
INBOX_DIR = STATE_ROOT / "inbox"
DEAD_LETTER_DIR = STATE_ROOT / "dead-letter"
PRODUCING_DIR = STATE_ROOT / "producing"
READY_DIR = STATE_ROOT / "ready"
VERIFICATION_PROCESSING_DIR = STATE_ROOT / "verification" / "processing"
VERIFICATION_REJECTED_DIR = STATE_ROOT / "verification" / "rejected"
REPORTS_DIR = STATE_ROOT / "reports"
CUTOVER_STATE_ROOT = TRACKER_STATE_ROOT / "cutover-completeness"
ACTIVATION_HISTORY = Path("/opt/creator-tracker/activation-history.tsv")

WORKER_UNIT = "creator-tracker-worker.service"
AGENT_UNIT = "creator-tracker-codex-incident.service"
VERIFIER_UNIT = "creator-tracker-codex-verifier.service"
HEALTH_UNIT = "creator-tracker-dashboard-health.service"

REPORT_HASHED_FILES = (
    "incident.json",
    "processed-incident.json",
    "prompt.md",
    "events.jsonl",
    "stderr.log",
    "codex-result.json",
    "candidate.patch",
    "git-status.txt",
    "changed-paths.txt",
    "changed-paths.nul",
    "base-app-commit",
    "base-release-id",
    "codex-exit-code",
    "candidate-policy.json",
    "READY-SHA256SUMS",
    "READY",
    "result.json",
    "trusted-candidate-policy.json",
    "trusted-verification.log",
    "trusted-verification-exit",
    "verifier-attempts",
)

TIMER_UNITS = (
    "creator-tracker-roster-refresh.timer",
    "creator-tracker-scheduler-tick.timer",
    "creator-tracker-instagram-discovery.timer",
    "creator-tracker-instagram-scheduler.timer",
    "creator-tracker-provider-reconcile.timer",
    "creator-tracker-canonical-delivery.timer",
    "creator-tracker-raw-verifier.timer",
    "creator-tracker-dashboard-health.timer",
)

# These limits are deliberately looser than the ordinary schedules. A missed
# tick gets room to recover on its own before the sentinel intervenes.
JOB_LIMITS = {
    "scheduler-tick": ("creator-tracker-scheduler-tick.service", 15 * 60),
    "roster-refresh": ("creator-tracker-roster-refresh.service", 2 * 60 * 60),
    "instagram-scheduler": ("creator-tracker-instagram-scheduler.service", 30 * 60),
    "instagram-discovery": ("creator-tracker-instagram-discovery.service", 2 * 60 * 60),
    "provider-reconcile": ("creator-tracker-provider-reconcile.service", 16 * 60 * 60),
    "canonical-delivery": ("creator-tracker-canonical-delivery.service", 15 * 60),
    "raw-verifier": ("creator-tracker-raw-verifier.service", 30 * 60),
}

JOB_TIMER_UNITS = {
    "scheduler-tick": "creator-tracker-scheduler-tick.timer",
    "roster-refresh": "creator-tracker-roster-refresh.timer",
    "instagram-scheduler": "creator-tracker-instagram-scheduler.timer",
    "instagram-discovery": "creator-tracker-instagram-discovery.timer",
    "provider-reconcile": "creator-tracker-provider-reconcile.timer",
    "canonical-delivery": "creator-tracker-canonical-delivery.timer",
    "raw-verifier": "creator-tracker-raw-verifier.timer",
}

RELEASE_RE = re.compile(r"^/opt/creator-tracker/releases/([0-9a-f]{64})$")
INCIDENT_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$")
ATTEMPT_RE = re.compile(
    r"^(?P<incident>[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16})\.attempt\.[A-Za-z0-9]{6}$"
)
DISPATCH_STREAK = 3
DISPATCH_MIN_AGE_SECONDS = {
    "tiktok_target_capacity_not_feasible": 45 * 60,
    "tiktok_clustered_window_misses": 45 * 60,
}
DISPATCH_COOLDOWN_SECONDS = 6 * 60 * 60
MAX_DISPATCHES_PER_DAY = 3
MAX_CODEX_ATTEMPTS_PER_INCIDENT = 2
ACTION_COOLDOWN_SECONDS = 30 * 60
MAX_AUTOMATIC_ACTIONS_PER_DAY = 12
MAX_AUTOMATIC_ACTIONS_PER_UNIT_PER_DAY = 3
ACTION_CONFIRMATION_PROBES = 2
CUTOVER_GRACE_SECONDS = 2 * 60 * 60
ACTIVATION_WITH_MARKER_MAX_SECONDS = 2 * 60 * 60
ACTIVATION_WITHOUT_MARKER_MAX_SECONDS = 70 * 60
WORKER_HEARTBEAT_MAX_AGE = 5 * 60
COVERAGE_MAX_AGE = 30 * 60
TIKTOK_DIRECT_MAX_AGE = 3 * 60 * 60
STORAGE_MIN_FREE_BYTES = 20 * 1024 * 1024 * 1024

AUTOPILOT_MANIFEST = Path(
    "/usr/local/share/creator-tracker-autopilot/artifact-manifest.json"
)
AUTOPILOT_ARTIFACTS = {
    "/usr/local/libexec/creator-tracker-autopilot": 0o555,
    "/usr/local/libexec/creator-tracker-codex-incident": 0o555,
    "/usr/local/libexec/creator-tracker-codex-verifier": 0o555,
    "/usr/local/libexec/creator-tracker-validate-codex-result": 0o555,
    "/usr/local/share/creator-tracker-autopilot/PROMPT.md": 0o444,
    "/usr/local/share/creator-tracker-autopilot/result.schema.json": 0o444,
    "/usr/local/share/creator-tracker-autopilot/autopilot.config.toml": 0o444,
    "/opt/creator-tracker-autopilot/codex/0.149.0/SHA256SUMS": 0o444,
    "/etc/systemd/system/creator-tracker-autopilot.service": 0o644,
    "/etc/systemd/system/creator-tracker-autopilot.timer": 0o644,
    "/etc/systemd/system/creator-tracker-codex-incident.service": 0o644,
    "/etc/systemd/system/creator-tracker-codex-verifier.service": 0o644,
    "/etc/tmpfiles.d/creator-tracker-autopilot.conf": 0o644,
}

REPORT_FILE_LIMITS = {
    "events.jsonl": 128 * 1024 * 1024,
    "stderr.log": 32 * 1024 * 1024,
    "candidate.patch": 32 * 1024 * 1024,
    "git-status.txt": 8 * 1024 * 1024,
    "changed-paths.txt": 8 * 1024 * 1024,
    "changed-paths.nul": 8 * 1024 * 1024,
    "prompt.md": 4 * 1024 * 1024,
    "incident.json": 2 * 1024 * 1024,
    "processed-incident.json": 2 * 1024 * 1024,
    "codex-result.json": 1024 * 1024,
    "candidate-policy.json": 1024 * 1024,
    "result.json": 1024 * 1024,
    "trusted-candidate-policy.json": 1024 * 1024,
    "trusted-verification.log": 128 * 1024 * 1024,
    "READY-SHA256SUMS": 64 * 1024,
    "READY": 4096,
}
REPORT_TOTAL_SIZE_LIMIT = 384 * 1024 * 1024

# These are release-local best-observed baselines, not fabricated absolutes.
# They catch new coverage debt without treating the inherited starting debt as
# a fresh incident. Deltas allow small normal queue movement to settle.
COVERAGE_REGRESSION_LIMITS = {
    "unresolved_tiktok": 2,
    "unresolved_instagram": 2,
    "overdue_tiktok_videos": 25,
    "overdue_instagram_videos": 5,
    "failed_tiktok_videos": 0,
    "first_week_targets_enforced_missed": 0,
    "first_week_targets_enforced_outside_target": 0,
    "first_week_targets_current_enforced_missed": 0,
    "first_week_targets_current_enforced_outside_target": 0,
}

# These target-quality counters describe completed observation-window outcomes.
# Unlike unresolved/overdue work, a miss cannot be repaired back out of the
# aggregate, and a current miss can remain visible until the video freezes. A
# regression therefore needs edge-triggered semantics: confirm and dispatch it
# once, then advance the accepted baseline to the exact value captured by that
# durable dispatch. Including the baseline in the issue identity makes a later
# increment a new incident even if it happens before a clean probe in between.
TARGET_OUTCOME_REGRESSION_COUNTERS = frozenset(
    {
        "first_week_targets_enforced_missed",
        "first_week_targets_enforced_outside_target",
        "first_week_targets_current_enforced_missed",
        "first_week_targets_current_enforced_outside_target",
    }
)

OPERATOR_ONLY_ISSUE_PREFIXES = (
    "activation_lock_invalid",
    "activation_lock_stuck",
    "cutover_gate_not_ready",
    "instagram_configuration_not_ready",
    "instagram_credit_guard_not_ready",
    "release_identity_invalid",
    "release_integrity_invalid",
    "stale_activation_marker",
    "storage_reserve_low_or_unknown",
    "tiktok_paid_fallback_not_ready",
    "timer_disabled:",
    "timer_missing:",
    "unit_integrity_invalid:",
    "unit_disabled:",
)


def run(
    command: list[str],
    *,
    timeout: int = 30,
    check: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=check,
            input=input_text,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
        )
    except subprocess.TimeoutExpired as error:
        return subprocess.CompletedProcess(command, 124, error.stdout or "", "command timed out")
    except OSError as error:
        return subprocess.CompletedProcess(command, 126, "", f"command failed: {error}")


def atomic_json(path: Path, value: Any, *, mode: int = 0o640) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        # STATE_ROOT is intentionally setgid for the Codex handoff group. Keep
        # every root-authored state/queue file root-owned despite that inherited
        # group, matching the loader's fail-closed trust boundary.
        try:
            os.fchown(descriptor, 0, 0)
        except OSError:
            os.close(descriptor)
            raise
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_json(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def state_shape_error(state: Any) -> str | None:
    if not isinstance(state, dict) or state.get("format_version") != 1:
        return "unsupported structure"
    required = {
        "format_version",
        "dispatches",
        "automatic_actions",
        "coverage_baseline",
        "coverage_baseline_release",
        "last_probe_epoch",
        "status",
        "fingerprint",
        "streak",
    }
    if not required.issubset(state):
        return "initialized state is missing required safety fields"
    if (
        not isinstance(state.get("last_probe_epoch"), int)
        or state["last_probe_epoch"] < 0
        or state.get("status")
        not in {
            "awaiting_baseline",
            "healthy",
            "maintenance",
            "incident_pending",
            "operator_required",
            "codex_queued",
        }
        or not isinstance(state.get("streak"), int)
        or state["streak"] < 0
        or (
            state.get("fingerprint") is not None
            and re.fullmatch(r"[0-9a-f]{64}", str(state.get("fingerprint"))) is None
        )
        or (
            state.get("coverage_baseline_release") is not None
            and re.fullmatch(r"[0-9a-f]{64}", str(state.get("coverage_baseline_release"))) is None
        )
    ):
        return "initialized state metadata is invalid"
    for key in ("dispatches", "automatic_actions"):
        value = state.get(key, [])
        if not isinstance(value, list) or len(value) > 100:
            return f"{key} must be a bounded list"
        for item in value:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("at_epoch"), int)
                or item["at_epoch"] < 0
            ):
                return f"{key} contains an invalid record"
    for item in state.get("dispatches", []):
        if (
            re.fullmatch(r"[0-9a-f]{64}", str(item.get("fingerprint", ""))) is None
            or INCIDENT_RE.fullmatch(str(item.get("incident_id", ""))) is None
        ):
            return "dispatches contains an invalid identity"
    for item in state.get("automatic_actions", []):
        if (
            not isinstance(item.get("kind"), str)
            or item.get("kind") not in {"start_timer", "restart_worker"}
            or not isinstance(item.get("unit"), str)
            or item.get("unit") not in {*TIMER_UNITS, WORKER_UNIT}
            or (item.get("ok") is not None and not isinstance(item.get("ok"), bool))
        ):
            return "automatic_actions contains an invalid action"
    streaks = state.get("issue_streaks", {})
    if not isinstance(streaks, dict) or len(streaks) > 500:
        return "issue_streaks must be a bounded object"
    for issue, record in streaks.items():
        if (
            not isinstance(issue, str)
            or not isinstance(record, dict)
            or not isinstance(record.get("count"), int)
            or not 0 <= record["count"] <= 10_000
            or not isinstance(record.get("first_seen_epoch"), int)
            or record["first_seen_epoch"] < 0
        ):
            return "issue_streaks contains an invalid record"
        dispatched_at = record.get("dispatched_at_epoch")
        if dispatched_at is not None and (
            not isinstance(dispatched_at, int) or dispatched_at < record["first_seen_epoch"]
        ):
            return "issue_streaks contains an invalid dispatch marker"
    baseline = state.get("coverage_baseline", {})
    expected_baseline = set(COVERAGE_REGRESSION_LIMITS)
    baseline_keys = set(baseline) if isinstance(baseline, dict) else set()
    baseline_shape_ready = (
        baseline_keys.issubset(expected_baseline)
        if state.get("status") == "awaiting_baseline"
        else baseline_keys == expected_baseline
    )
    if not isinstance(baseline, dict) or not baseline_shape_ready:
        return "coverage_baseline is incomplete or contains unknown fields"
    if any(not isinstance(value, int) or value < 0 for value in baseline.values()):
        return "coverage_baseline contains an invalid value"
    activation_first = state.get("activation_lock_first_seen_epoch")
    if activation_first is not None and (
        not isinstance(activation_first, int) or activation_first < 0
    ):
        return "activation lock history is invalid"
    if state.get("status") in {"incident_pending", "operator_required", "codex_queued"} and not state.get(
        "issue_streaks"
    ):
        return "incident state is missing issue streak history"
    pending = state.get("pending_incident")
    if pending is not None:
        if (
            not isinstance(pending, dict)
            or pending.get("format_version") != 1
            or INCIDENT_RE.fullmatch(str(pending.get("incident_id", ""))) is None
            or re.fullmatch(r"[0-9a-f]{64}", str(pending.get("fingerprint", ""))) is None
            or not isinstance(pending.get("snapshot"), dict)
            or not isinstance(pending.get("issues"), list)
            or not all(isinstance(issue, str) for issue in pending["issues"])
        ):
            return "pending incident outbox is invalid"
    return None


def load_probe_state() -> tuple[dict[str, Any], str | None]:
    """Load trusted state without silently resetting safety histories."""
    try:
        state_stat = STATE_FILE.lstat()
    except FileNotFoundError:
        if STATUS_FILE.exists() or STATUS_FILE.is_symlink():
            return {}, "state file disappeared after initialization"
        return {}, None
    except OSError as error:
        return {}, f"state file cannot be inspected: {error}"
    if (
        STATE_FILE.is_symlink()
        or not STATE_FILE.is_file()
        or state_stat.st_uid != 0
        or state_stat.st_gid != 0
        or state_stat.st_nlink != 1
        or state_stat.st_mode & 0o777 != 0o640
        or state_stat.st_size > 2 * 1024 * 1024
    ):
        return {}, "state file ownership, type, mode, or size is unsafe"
    try:
        with STATE_FILE.open("r", encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return {}, f"state file is unreadable: {error}"
    shape_error = state_shape_error(state)
    if shape_error is not None:
        return {}, f"state file has an invalid structure: {shape_error}"
    return state, None


def marker_fields(path: Path) -> tuple[dict[str, str], str | None]:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        info = os.fstat(descriptor)
        if (
            not stat_module.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_size > 64 * 1024
        ):
            os.close(descriptor)
            return {}, "unsafe_marker"
        with os.fdopen(descriptor, "rb") as handle:
            raw = handle.read(64 * 1024 + 1)
        if len(raw) > 64 * 1024:
            return {}, "unsafe_marker"
        fields: dict[str, str] = {}
        for line in raw.decode("utf-8").splitlines():
            if "=" not in line:
                return {}, "malformed_marker"
            field, value = line.split("=", 1)
            if field in fields:
                return {}, "duplicate_marker_field"
            fields[field] = value
        return fields, None
    except (OSError, UnicodeDecodeError):
        return {}, "missing_marker"


def marker_epoch(role: str, filename: str, key: str) -> tuple[int | None, str | None]:
    fields, error = marker_fields(TRACKER_STATE_ROOT / role / filename)
    if error is not None:
        return None, error
    try:
        raw = fields.get(key)
        if raw is None or not raw.isdigit():
            return None, "missing_marker_epoch"
        return int(raw), fields.get("state")
    except (TypeError, ValueError):
        return None, "invalid_marker_epoch"


def latest_activation_epoch(release_id: str | None) -> int | None:
    if release_id is None:
        return None
    try:
        stat = ACTIVATION_HISTORY.lstat()
        if (
            not ACTIVATION_HISTORY.is_file()
            or ACTIVATION_HISTORY.is_symlink()
            or stat.st_nlink != 1
            or stat.st_uid != 0
            or stat.st_gid != 0
            or stat.st_mode & 0o777 != 0o600
            or stat.st_size > 4 * 1024 * 1024
        ):
            return None
        matched: int | None = None
        for line in ACTIVATION_HISTORY.read_text(encoding="utf-8").splitlines():
            parts = line.split("\t")
            if len(parts) != 4 or parts[2] != release_id:
                continue
            matched = calendar.timegm(time.strptime(parts[0], "%Y-%m-%dT%H:%M:%SZ"))
        return matched
    except (OSError, ValueError):
        return None


def cutover_gate_snapshot(
    release_id: str | None,
    release_path: str,
    activation_epoch: int | None,
    now_epoch: int,
) -> dict[str, Any]:
    base = {
        "ready": False,
        "reason": "unavailable",
        "activation_epoch": activation_epoch,
    }
    if release_id is None or release_path == "unavailable":
        return base
    marker_path = CUTOVER_STATE_ROOT / "success"
    result_path = CUTOVER_STATE_ROOT / "result.json"
    try:
        marker_stat = marker_path.lstat()
        if (
            marker_path.is_symlink()
            or not marker_path.is_file()
            or marker_stat.st_nlink != 1
            or marker_stat.st_uid != 0
            or marker_stat.st_mode & 0o777 != 0o440
        ):
            return {**base, "reason": "cutover_marker_unsafe"}
    except OSError:
        return {**base, "reason": "missing_marker"}
    marker, marker_error = marker_fields(marker_path)
    if marker_error is not None:
        return {**base, "reason": marker_error}
    expected_marker_keys = {
        "format_version",
        "status",
        "release_id",
        "producer_run_id",
        "capture_set_id",
        "expected_pages",
        "frozen_first_outbox_id",
        "frozen_last_outbox_id",
        "projection_summary",
        "result_sha256",
        "completed_at_epoch",
    }
    if set(marker) != expected_marker_keys:
        return {**base, "reason": "cutover_marker_fields_invalid"}
    if (
        marker.get("format_version") != "2"
        or marker.get("status") != "complete"
        or marker.get("release_id") != release_id
        or re.fullmatch(r"[0-9a-f]{64}", marker.get("result_sha256", "")) is None
    ):
        return {**base, "reason": "cutover_marker_identity_invalid"}
    completed_raw = marker.get("completed_at_epoch", "")
    if not completed_raw.isdigit():
        return {**base, "reason": "cutover_marker_time_invalid"}
    completed_epoch = int(completed_raw)
    if (
        activation_epoch is None
        or completed_epoch < activation_epoch
        or completed_epoch > now_epoch + 60
    ):
        return {**base, "reason": "cutover_marker_not_bound_to_activation"}
    try:
        result_stat = result_path.lstat()
        if (
            not result_path.is_file()
            or result_path.is_symlink()
            or result_stat.st_nlink != 1
            or result_stat.st_uid != 0
            or result_stat.st_mode & 0o777 != 0o440
            or result_stat.st_size > 65_536
        ):
            return {**base, "reason": "cutover_result_unsafe"}
        result_bytes = result_path.read_bytes()
        if hashlib.sha256(result_bytes).hexdigest() != marker["result_sha256"]:
            return {**base, "reason": "cutover_result_hash_mismatch"}
        result = json.loads(result_bytes.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {**base, "reason": "cutover_result_unreadable"}
    outbox = result.get("outbox") if isinstance(result, dict) else None
    projection = result.get("projection") if isinstance(result, dict) else None
    try:
        projection_summary = ":".join(
            str(projection[key]["expected"])
            for key in (
                "sourceRows",
                "creators",
                "accounts",
                "videos",
                "observations",
                "cadenceSuppressed",
            )
        )
    except (KeyError, TypeError):
        return {**base, "reason": "cutover_result_projection_invalid"}
    if (
        result.get("event") != "creator_tracker_provider_cutover_completeness_v1"
        or result.get("status") != "complete"
        or result.get("reason") != "COMPLETE"
        or result.get("selectedBy") != "producer_run_id"
        or result.get("producerRunId") != marker["producer_run_id"]
        or result.get("captureSetId") != marker["capture_set_id"]
        or result.get("deliveryPending") is not False
        or result.get("rawAttestationPending") is not False
        or result.get("centralChecked") is not True
        or not isinstance(outbox, dict)
        or str(outbox.get("expected")) != marker["expected_pages"]
        or outbox.get("delivered") != outbox.get("expected")
        or outbox.get("pending") != 0
        or outbox.get("leased") != 0
        or outbox.get("retry") != 0
        or str(result.get("frozenFirstOutboxId")) != marker["frozen_first_outbox_id"]
        or str(result.get("frozenLastOutboxId")) != marker["frozen_last_outbox_id"]
        or projection_summary != marker["projection_summary"]
    ):
        return {**base, "reason": "cutover_result_validation_failed"}
    return {**base, "ready": True, "reason": "complete"}


def unit_snapshot(unit: str) -> dict[str, Any]:
    result = run(
        [
            "/usr/bin/systemctl",
            "show",
            unit,
            "--property=LoadState",
            "--property=ActiveState",
            "--property=SubState",
            "--property=UnitFileState",
            "--property=ExecMainStatus",
            "--property=FragmentPath",
            "--property=DropInPaths",
            "--property=NeedDaemonReload",
        ]
    )
    fields: dict[str, str] = {}
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                fields[key] = value
    return {
        "load": fields.get("LoadState", "unknown"),
        "active": fields.get("ActiveState", "unknown"),
        "sub": fields.get("SubState", "unknown"),
        "enabled": fields.get("UnitFileState", "unknown"),
        "exit_status": fields.get("ExecMainStatus", "unknown"),
        "fragment_path": fields.get("FragmentPath", ""),
        "drop_in_paths": fields.get("DropInPaths", ""),
        "needs_daemon_reload": fields.get("NeedDaemonReload", "unknown"),
    }


def unit_integrity_ready(unit: str, release_path: str, effective: dict[str, Any]) -> bool:
    expected = Path(release_path) / "systemd" / unit
    actual = Path("/etc/systemd/system") / unit
    try:
        expected_stat = expected.lstat()
        actual_stat = actual.lstat()
        return (
            not expected.is_symlink()
            and expected.is_file()
            and expected_stat.st_uid == 0
            and expected_stat.st_gid == 0
            and expected_stat.st_nlink == 1
            and not actual.is_symlink()
            and actual.is_file()
            and actual_stat.st_uid == 0
            and actual_stat.st_gid == 0
            and actual_stat.st_nlink == 1
            and actual_stat.st_mode & 0o777 == 0o644
            and actual.read_bytes() == expected.read_bytes()
            and effective.get("fragment_path") == str(actual)
            and effective.get("drop_in_paths") == ""
            and effective.get("needs_daemon_reload") == "no"
        )
    except OSError:
        return False


def parse_coverage_message(message: str) -> dict[str, str]:
    prefix = "[tracker coverage] "
    if not message.startswith(prefix):
        return {}
    parsed: dict[str, str] = {}
    for token in message[len(prefix) :].split():
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        if re.fullmatch(r"[a-z0-9_]+", key) and re.fullmatch(r"[A-Za-z0-9_./:-]+", value):
            parsed[key] = value
    return parsed


def latest_coverage(now_epoch: int) -> dict[str, Any]:
    result = run(
        [
            "/usr/bin/journalctl",
            "-u",
            HEALTH_UNIT,
            "--since",
            f"@{max(0, now_epoch - COVERAGE_MAX_AGE)}",
            "--output=json",
            "--no-pager",
            "--lines=500",
        ],
        timeout=45,
    )
    latest: dict[str, Any] = {"observed_at_epoch": None, "fields": {}}
    if result.returncode != 0:
        return latest
    for line in result.stdout.splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = row.get("MESSAGE")
        if not isinstance(message, str):
            continue
        fields = parse_coverage_message(message)
        if not fields:
            continue
        raw_timestamp = row.get("__REALTIME_TIMESTAMP") or row.get("_SOURCE_REALTIME_TIMESTAMP")
        try:
            timestamp = int(str(raw_timestamp)) // 1_000_000
        except (TypeError, ValueError):
            timestamp = now_epoch
        if latest["observed_at_epoch"] is None or timestamp >= latest["observed_at_epoch"]:
            latest = {"observed_at_epoch": timestamp, "fields": fields}
    return latest


def release_identity() -> tuple[str | None, bool, str]:
    try:
        resolved = str(SELECTOR.resolve(strict=True))
        match = RELEASE_RE.fullmatch(resolved)
        if match is None:
            return None, False, resolved
        release_id = match.group(1)
        release_file = Path(resolved) / "RELEASE_ID"
        app_file = Path(resolved) / "APP_COMMIT"
        if release_file.is_symlink() or app_file.is_symlink():
            return release_id, False, resolved
        if release_file.read_text(encoding="utf-8").strip() != release_id:
            return release_id, False, resolved
        app_commit = app_file.read_text(encoding="utf-8").strip()
        if re.fullmatch(r"[0-9a-f]{40}(?:[0-9a-f]{24})?", app_commit) is None:
            return release_id, False, resolved
        return release_id, True, resolved
    except OSError:
        return None, False, "unavailable"


def activation_snapshot() -> dict[str, Any]:
    marker_present = os.path.lexists(ACTIVATION_MARKER)
    try:
        stat = ACTIVATION_LOCK.lstat()
        if (
            ACTIVATION_LOCK.is_symlink()
            or not ACTIVATION_LOCK.is_file()
            or stat.st_nlink != 1
            or stat.st_uid != 0
            or stat.st_gid != 0
            or stat.st_mode & 0o777 != 0o600
        ):
            return {"lock_valid": False, "lock_held": False, "marker_present": marker_present}
        descriptor = os.open(ACTIVATION_LOCK, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                held = False
            except BlockingIOError:
                held = True
        finally:
            os.close(descriptor)
        return {"lock_valid": True, "lock_held": held, "marker_present": marker_present}
    except OSError:
        return {"lock_valid": False, "lock_held": False, "marker_present": marker_present}


def apply_activation_deadman(previous: dict[str, Any], snapshot: dict[str, Any]) -> int | None:
    """Suppress remediation only for a bounded, observable activation window."""
    activation = snapshot.get("activation")
    if not isinstance(activation, dict) or not activation.get("lock_held"):
        return None
    now = int(snapshot["observed_at_epoch"])
    prior_first = previous.get("activation_lock_first_seen_epoch")
    first_seen = prior_first if isinstance(prior_first, int) and 0 <= prior_first <= now else now
    held_age = now - first_seen
    marker_present = activation.get("marker_present") is True
    max_age = (
        ACTIVATION_WITH_MARKER_MAX_SECONDS
        if marker_present
        else ACTIVATION_WITHOUT_MARKER_MAX_SECONDS
    )
    stuck = held_age > max_age
    activation["held_since_epoch"] = first_seen
    activation["held_age_seconds"] = held_age
    activation["stuck"] = stuck
    snapshot["activation_in_progress"] = True
    snapshot["maintenance_in_progress"] = not stuck
    return first_seen


def collect_snapshot(now_epoch: int | None = None) -> dict[str, Any]:
    now = int(time.time()) if now_epoch is None else now_epoch
    release_id, release_valid, release_path = release_identity()
    selector_identity: dict[str, int] | None = None
    try:
        selector_stat = SELECTOR.lstat()
        if SELECTOR.is_symlink() and selector_stat.st_uid == 0 and selector_stat.st_gid == 0:
            selector_identity = {
                "inode": selector_stat.st_ino,
                "mtime_ns": selector_stat.st_mtime_ns,
            }
        else:
            release_valid = False
    except OSError:
        release_valid = False
    heartbeat_epoch, worker_state = marker_epoch("collector-worker", "status", "updated_at_epoch")
    jobs: dict[str, Any] = {}
    for role, (service, max_age) in JOB_LIMITS.items():
        success_epoch, _ = marker_epoch(role, "success", "at_epoch")
        failure_fields, _ = marker_fields(TRACKER_STATE_ROOT / role / "failure")
        failure_epoch_raw = failure_fields.get("at_epoch", "")
        failure_exit_raw = failure_fields.get("exit_code", "")
        job_unit = unit_snapshot(service)
        job_unit["integrity_ready"] = unit_integrity_ready(service, release_path, job_unit)
        jobs[role] = {
            "service": service,
            "max_age_seconds": max_age,
            "success_epoch": success_epoch,
            "last_failure_epoch": int(failure_epoch_raw) if failure_epoch_raw.isdigit() else None,
            "last_failure_exit_code": int(failure_exit_raw) if failure_exit_raw.isdigit() else None,
            "unit": job_unit,
        }
    try:
        storage_available = shutil.disk_usage(TRACKER_STATE_ROOT).free
    except OSError:
        storage_available = None
    app_commit = None
    if release_valid:
        try:
            app_commit = (Path(release_path) / "APP_COMMIT").read_text(encoding="utf-8").strip()
        except OSError:
            release_valid = False
    activation_epoch = latest_activation_epoch(release_id)
    cutover = cutover_gate_snapshot(release_id, release_path, activation_epoch, now)
    activation = activation_snapshot()
    recent_uncutover_activation = (
        not cutover["ready"]
        and not activation["marker_present"]
        and isinstance(activation_epoch, int)
        and 0 <= now - activation_epoch <= CUTOVER_GRACE_SECONDS
    )
    worker_unit = unit_snapshot(WORKER_UNIT)
    worker_unit["integrity_ready"] = unit_integrity_ready(
        WORKER_UNIT, release_path, worker_unit
    )
    timer_units: dict[str, dict[str, Any]] = {}
    for unit in TIMER_UNITS:
        effective = unit_snapshot(unit)
        effective["integrity_ready"] = unit_integrity_ready(unit, release_path, effective)
        timer_units[unit] = effective
    health_unit = unit_snapshot(HEALTH_UNIT)
    health_unit["integrity_ready"] = unit_integrity_ready(
        HEALTH_UNIT, release_path, health_unit
    )
    snapshot = {
        "format_version": 1,
        "observed_at_epoch": now,
        "release_id": release_id,
        "release_path": release_path,
        "app_commit": app_commit,
        "release_identity_valid": release_valid,
        "selector_identity": selector_identity,
        "activation": activation,
        "activation_in_progress": activation["lock_held"],
        "maintenance_in_progress": activation["lock_held"] or recent_uncutover_activation,
        "cutover": cutover,
        "storage_available_bytes": storage_available,
        "worker": {
            "unit": worker_unit,
            "heartbeat_epoch": heartbeat_epoch,
            "marker_state": worker_state,
        },
        "timers": timer_units,
        "health_unit": health_unit,
        "jobs": jobs,
        "coverage": latest_coverage(now),
    }
    release_integrity, release_integrity_detail = verify_installed_release(snapshot)
    snapshot["release_integrity"] = {
        "ready": release_integrity,
        "detail": release_integrity_detail,
    }
    return snapshot


def integer_field(fields: dict[str, str], key: str) -> int | None:
    value = fields.get(key)
    return int(value) if value is not None and value.isdigit() else None


def coverage_regression_issue(key: str, baseline_value: int) -> str:
    if key in TARGET_OUTCOME_REGRESSION_COUNTERS:
        return f"coverage_regressed:{key}:baseline={baseline_value}"
    return f"coverage_regressed:{key}"


def accept_dispatched_target_regressions(
    baseline: dict[str, int], snapshot: dict[str, Any], incident_state: dict[str, Any]
) -> dict[str, int]:
    """Advance irreversible target counters only after a durable dispatch reservation.

    Exact legacy issue names are accepted too. That is the one-time migration
    path for incidents dispatched before baseline-scoped issue identities were
    introduced; it prevents an already-reported historical miss from launching
    Codex forever.
    """
    output = dict(baseline)
    fields = snapshot.get("coverage", {}).get("fields", {})
    streaks = incident_state.get("issue_streaks", {})
    if not isinstance(fields, dict) or not isinstance(streaks, dict):
        return output
    for key in TARGET_OUTCOME_REGRESSION_COUNTERS:
        current = integer_field(fields, key)
        accepted = output.get(key)
        if current is None or not isinstance(accepted, int) or current <= accepted:
            continue
        legacy_issue = f"coverage_regressed:{key}"
        scoped_issue = coverage_regression_issue(key, accepted)
        dispatched = any(
            isinstance(issue, str)
            # A scoped dispatch may acknowledge only the baseline it actually
            # observed. If the counter rose again before the next clean probe,
            # the old dispatch must not silently bless that newer outcome.
            and (issue == legacy_issue or issue == scoped_issue)
            and isinstance(record, dict)
            and isinstance(record.get("dispatched_at_epoch"), int)
            for issue, record in streaks.items()
        )
        if dispatched:
            output[key] = current
    return output


def evaluate_snapshot(
    snapshot: dict[str, Any], coverage_baseline: dict[str, int] | None = None
) -> tuple[list[dict[str, str]], list[str]]:
    """Return allowlisted operational actions and actionable issue codes."""
    if snapshot.get("maintenance_in_progress"):
        return [], []
    actions: list[dict[str, str]] = []
    issues: list[str] = []
    now = int(snapshot["observed_at_epoch"])

    if not snapshot.get("release_identity_valid"):
        issues.append("release_identity_invalid")
    if snapshot.get("release_integrity", {}).get("ready") is not True:
        issues.append("release_integrity_invalid")

    activation = snapshot.get("activation", {})
    if not activation.get("lock_valid"):
        issues.append("activation_lock_invalid")
    if activation.get("stuck"):
        issues.append("activation_lock_stuck")
    if activation.get("marker_present") and not activation.get("lock_held"):
        issues.append("stale_activation_marker")

    cutover_ready = snapshot.get("cutover", {}).get("ready") is True
    if not cutover_ready:
        issues.append("cutover_gate_not_ready")

    storage = snapshot.get("storage_available_bytes")
    storage_ready = isinstance(storage, int) and storage >= STORAGE_MIN_FREE_BYTES
    if not storage_ready:
        issues.append("storage_reserve_low_or_unknown")

    for timer, unit in snapshot.get("timers", {}).items():
        timer_integrity_ready = unit.get("integrity_ready") is True
        if not timer_integrity_ready:
            issues.append(f"unit_integrity_invalid:{timer}")
        if unit.get("load") != "loaded":
            issues.append(f"timer_missing:{timer}")
            continue
        if unit.get("enabled") != "enabled":
            issues.append(f"timer_disabled:{timer}")
        elif unit.get("active") != "active":
            issues.append(f"timer_inactive:{timer}")
            if timer_integrity_ready:
                actions.append({"kind": "start_timer", "unit": timer})

    worker = snapshot.get("worker", {})
    worker_unit = worker.get("unit", {})
    worker_integrity_ready = worker_unit.get("integrity_ready") is True
    if not worker_integrity_ready:
        issues.append(f"unit_integrity_invalid:{WORKER_UNIT}")
    if worker_unit.get("enabled") != "enabled":
        issues.append(f"unit_disabled:{WORKER_UNIT}")
    heartbeat = worker.get("heartbeat_epoch")
    worker_fresh = (
        isinstance(heartbeat, int)
        and 0 <= now - heartbeat <= WORKER_HEARTBEAT_MAX_AGE
        and worker.get("marker_state") == "running"
    )
    if worker_integrity_ready and worker_unit.get("enabled") == "enabled" and (
        worker_unit.get("active") != "active" or not worker_fresh
    ):
        issues.append("worker_inactive_or_stale")
        actions.append({"kind": "restart_worker", "unit": WORKER_UNIT})

    for role, job in snapshot.get("jobs", {}).items():
        job_unit = job.get("unit", {})
        if job_unit.get("integrity_ready") is not True:
            issues.append(f"unit_integrity_invalid:{job.get('service', role)}")
        timer_name = JOB_TIMER_UNITS.get(role)
        timer_unit = snapshot.get("timers", {}).get(timer_name, {})
        scheduling_ready = (
            timer_name is not None
            and timer_unit.get("load") == "loaded"
            and timer_unit.get("enabled") == "enabled"
            and timer_unit.get("active") == "active"
            and timer_unit.get("integrity_ready") is True
            and job_unit.get("load") == "loaded"
            and job_unit.get("integrity_ready") is True
        )
        # A disabled, missing, stopped, or drifted timer is already reported by
        # its operator-safe unit issue. Do not reinterpret the resulting stale
        # marker as an application-code incident and spend a Codex run during
        # intentional maintenance.
        if not scheduling_ready:
            continue
        coverage_fields = snapshot.get("coverage", {}).get("fields", {})
        if role in {"instagram-scheduler", "instagram-discovery"} and (
            not isinstance(coverage_fields, dict)
            or coverage_fields.get("instagram_configured") != "true"
            or coverage_fields.get("instagram_credit_status") != "ready"
        ):
            continue
        success_epoch = job.get("success_epoch")
        max_age = job.get("max_age_seconds")
        fresh = (
            isinstance(success_epoch, int)
            and isinstance(max_age, int)
            and 0 <= now - success_epoch <= max_age
        )
        if fresh:
            continue
        issues.append(f"job_stale:{role}")

    coverage = snapshot.get("coverage", {})
    coverage_epoch = coverage.get("observed_at_epoch")
    fields = coverage.get("fields") if isinstance(coverage.get("fields"), dict) else {}
    health_timer = snapshot.get("timers", {}).get(
        "creator-tracker-dashboard-health.timer", {}
    )
    health_unit = snapshot.get("health_unit", {})
    if health_unit.get("integrity_ready") is not True:
        issues.append(f"unit_integrity_invalid:{HEALTH_UNIT}")
    health_schedule_available = (
        health_timer.get("load") == "loaded"
        and health_timer.get("enabled") == "enabled"
        and health_timer.get("active") == "active"
        and health_timer.get("integrity_ready") is True
        and health_unit.get("load") == "loaded"
        and health_unit.get("integrity_ready") is True
    )
    if not health_schedule_available:
        pass
    elif (
        not isinstance(coverage_epoch, int)
        or not 0 <= now - coverage_epoch <= COVERAGE_MAX_AGE
    ):
        issues.append("coverage_snapshot_stale")
    elif fields:
        if fields.get("tiktok_target_capacity") != "feasible":
            issues.append("tiktok_target_capacity_not_feasible")
        if fields.get("tiktok_profile_recovery") != "feasible":
            issues.append("tiktok_profile_recovery_not_feasible")
        fallback_mode = fields.get("tiktok_fallback_mode")
        fallback_status = fields.get("tiktok_fallback_status")
        if fallback_mode not in {"off", "auto", "force"}:
            issues.append("tiktok_fallback_configuration_invalid")
        elif fallback_mode == "off" and fallback_status != "off":
            issues.append("tiktok_fallback_configuration_invalid")
        elif fallback_mode in {"auto", "force"} and fallback_status != "ready":
            issues.append("tiktok_paid_fallback_not_ready")
        if fields.get("instagram_configured") != "true":
            issues.append("instagram_configuration_not_ready")
        elif fields.get("instagram_credit_status") != "ready":
            issues.append("instagram_credit_guard_not_ready")
        latest_tiktok = integer_field(fields, "latest_tiktok_direct_age_seconds")
        if latest_tiktok is None or latest_tiktok > TIKTOK_DIRECT_MAX_AGE:
            issues.append("tiktok_direct_observation_stale")
        clustered_misses = integer_field(fields, "tiktok_target_clustered_window_misses")
        if clustered_misses is None or clustered_misses > 0:
            issues.append("tiktok_clustered_window_misses")
        missing_states = integer_field(fields, "missing_states")
        if missing_states is None or missing_states > 0:
            issues.append("creator_tracking_states_missing")
        missing_targets = integer_field(fields, "first_week_targets_missing")
        stale_targets = integer_field(fields, "first_week_targets_stale")
        if missing_targets is None or stale_targets is None:
            issues.append("first_week_target_telemetry_missing")
        elif missing_targets > 10 or stale_targets > 10:
            issues.append("first_week_target_materialization_regressed")
        for key, allowed_delta in COVERAGE_REGRESSION_LIMITS.items():
            current_value = integer_field(fields, key)
            baseline_value = (coverage_baseline or {}).get(key)
            if current_value is None:
                issues.append(f"coverage_baseline_telemetry_missing:{key}")
            elif (
                isinstance(current_value, int)
                and isinstance(baseline_value, int)
                and current_value > baseline_value + allowed_delta
            ):
                issues.append(coverage_regression_issue(key, baseline_value))
    else:
        issues.append("coverage_snapshot_invalid")

    if (
        not cutover_ready
        or activation.get("marker_present")
        or activation.get("lock_held")
        or not activation.get("lock_valid")
        or not storage_ready
    ):
        actions = []
    unique_actions = {(item["kind"], item["unit"]): item for item in actions}
    return list(unique_actions.values()), sorted(set(issues))


def next_coverage_baseline(previous: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, int]:
    raw_previous = previous.get("coverage_baseline")
    # The underlying production database survives application releases, so the
    # best-observed baseline must survive them too. Resetting here would bless a
    # regression introduced by a new release on its first probe.
    baseline = raw_previous if isinstance(raw_previous, dict) else {}
    fields = snapshot.get("coverage", {}).get("fields", {})
    output: dict[str, int] = {}
    for key in COVERAGE_REGRESSION_LIMITS:
        current = integer_field(fields, key) if isinstance(fields, dict) else None
        prior = baseline.get(key) if isinstance(baseline.get(key), int) else None
        if current is not None:
            output[key] = current if prior is None else min(prior, current)
        elif prior is not None:
            output[key] = prior
    return output


def fingerprint(release_id: str | None, issues: list[str]) -> str:
    encoded = json.dumps(
        {"release_id": release_id or "none", "issues": sorted(issues)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def codex_actionable_issue(issue: str) -> bool:
    return not any(issue.startswith(prefix) for prefix in OPERATOR_ONLY_ISSUE_PREFIXES)


def update_incident_state(
    previous: dict[str, Any], snapshot: dict[str, Any], issues: list[str]
) -> tuple[dict[str, Any], bool, str | None]:
    now = int(snapshot["observed_at_epoch"])
    if not isinstance(previous, dict):
        previous = {}
    recent_dispatches = [
        item
        for item in previous.get("dispatches", [])[:MAX_DISPATCHES_PER_DAY * 4]
        if isinstance(item, dict)
        and isinstance(item.get("at_epoch"), int)
        and 0 <= now - item["at_epoch"] < 24 * 60 * 60
    ]
    state: dict[str, Any] = {
        "format_version": 1,
        "dispatches": recent_dispatches,
        "last_probe_epoch": now,
    }
    if snapshot.get("maintenance_in_progress"):
        state.update({"status": "maintenance", "fingerprint": None, "streak": 0})
        return state, False, None
    if not issues:
        state.update({"status": "healthy", "fingerprint": None, "streak": 0})
        return state, False, None

    prior_streaks = previous.get("issue_streaks")
    if not isinstance(prior_streaks, dict):
        prior_streaks = {}
    issue_streaks: dict[str, dict[str, int]] = {}
    for issue in issues:
        prior = prior_streaks.get(issue)
        prior_count = prior.get("count", 0) if isinstance(prior, dict) else 0
        prior_first = prior.get("first_seen_epoch", now) if isinstance(prior, dict) else now
        if not isinstance(prior_count, int) or not 0 <= prior_count <= 10_000:
            prior_count = 0
        if not isinstance(prior_first, int) or prior_first > now:
            prior_first = now
        record = {
            "count": min(10_000, prior_count + 1),
            "first_seen_epoch": prior_first,
        }
        prior_dispatched = prior.get("dispatched_at_epoch") if isinstance(prior, dict) else None
        if isinstance(prior_dispatched, int) and prior_dispatched >= prior_first:
            record["dispatched_at_epoch"] = prior_dispatched
        issue_streaks[issue] = record
    persistent_issues = sorted(
        issue
        for issue, value in issue_streaks.items()
        if value["count"] >= DISPATCH_STREAK
        and now - value["first_seen_epoch"] >= DISPATCH_MIN_AGE_SECONDS.get(issue, 0)
    )
    codex_issues = [issue for issue in persistent_issues if codex_actionable_issue(issue)]
    undispatched_codex_issues = [
        issue
        for issue in codex_issues
        if "dispatched_at_epoch" not in issue_streaks[issue]
    ]
    streak = max(value["count"] for value in issue_streaks.values())
    fingerprint_issues = codex_issues or persistent_issues or issues
    current_fingerprint = fingerprint(snapshot.get("release_id"), fingerprint_issues)
    state.update(
        {
            "status": "incident_pending" if codex_issues or not persistent_issues else "operator_required",
            "fingerprint": current_fingerprint,
            "streak": streak,
            "first_seen_epoch": min(value["first_seen_epoch"] for value in issue_streaks.values()),
            "issues": issues,
            "issue_streaks": issue_streaks,
        }
    )
    same_dispatches = [
        item
        for item in recent_dispatches
        if item.get("fingerprint") == current_fingerprint
        and now - int(item["at_epoch"]) < DISPATCH_COOLDOWN_SECONDS
    ]
    activation = snapshot.get("activation", {})
    snapshot_safe_for_dispatch = (
        snapshot.get("release_identity_valid") is True
        and snapshot.get("release_integrity", {}).get("ready") is True
        and snapshot.get("cutover", {}).get("ready") is True
        and activation.get("lock_valid") is True
        and activation.get("lock_held") is False
        and activation.get("marker_present") is False
        and isinstance(snapshot.get("storage_available_bytes"), int)
        and snapshot["storage_available_bytes"] >= STORAGE_MIN_FREE_BYTES
    )
    dispatch = (
        bool(undispatched_codex_issues)
        and snapshot_safe_for_dispatch
        and not same_dispatches
        and len(recent_dispatches) < MAX_DISPATCHES_PER_DAY
    )
    if dispatch:
        incident_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now)) + "-" + current_fingerprint[:16]
        state["dispatches"].append(
            {"at_epoch": now, "fingerprint": current_fingerprint, "incident_id": incident_id}
        )
        for issue in codex_issues:
            issue_streaks[issue]["dispatched_at_epoch"] = now
        state["status"] = "codex_queued"
        state["dispatch_issues"] = codex_issues
        return state, True, incident_id
    return state, False, None


def select_automatic_actions(
    previous: dict[str, Any], actions: list[dict[str, str]], now: int
) -> tuple[list[dict[str, str]], list[dict[str, Any]], list[dict[str, Any]]]:
    raw_history = previous.get("automatic_actions", []) if isinstance(previous, dict) else []
    history = [
        item
        for item in raw_history[:MAX_AUTOMATIC_ACTIONS_PER_DAY * 4]
        if isinstance(item, dict)
        and isinstance(item.get("at_epoch"), int)
        and 0 <= now - item["at_epoch"] < 24 * 60 * 60
    ]
    selected: list[dict[str, str]] = []
    suppressed: list[dict[str, Any]] = []
    prior_streaks = previous.get("issue_streaks", {}) if isinstance(previous, dict) else {}
    for action in actions:
        required_issue = (
            "worker_inactive_or_stale"
            if action.get("kind") == "restart_worker"
            else f"timer_inactive:{action.get('unit')}"
        )
        prior_streak = prior_streaks.get(required_issue, {}) if isinstance(prior_streaks, dict) else {}
        prior_count = prior_streak.get("count", 0) if isinstance(prior_streak, dict) else 0
        if not isinstance(prior_count, int) or prior_count < ACTION_CONFIRMATION_PROBES - 1:
            suppressed.append(
                {"action": action, "ok": False, "detail": "automatic action awaiting confirmation"}
            )
            continue
        matching = [
            item
            for item in history
            if item.get("kind") == action.get("kind") and item.get("unit") == action.get("unit")
        ]
        if matching and now - max(int(item["at_epoch"]) for item in matching) < ACTION_COOLDOWN_SECONDS:
            suppressed.append({"action": action, "ok": False, "detail": "automatic action cooldown"})
            continue
        if len(history) + len(selected) >= MAX_AUTOMATIC_ACTIONS_PER_DAY:
            suppressed.append({"action": action, "ok": False, "detail": "daily automatic action limit"})
            continue
        if len(matching) >= MAX_AUTOMATIC_ACTIONS_PER_UNIT_PER_DAY:
            suppressed.append(
                {"action": action, "ok": False, "detail": "per-unit daily automatic action limit"}
            )
            continue
        selected.append(action)
    return selected, suppressed, history


def verify_installed_release(snapshot: dict[str, Any]) -> tuple[bool, str]:
    release_id = snapshot.get("release_id")
    release_path = snapshot.get("release_path")
    if not isinstance(release_id, str) or not isinstance(release_path, str):
        return False, "release identity unavailable"
    verifier = Path(release_path) / "bin" / "verify-release"
    if not verifier.is_file() or verifier.is_symlink():
        return False, "sealed verifier unavailable"
    result = run(
        [str(verifier), "--installed", release_path, release_id],
        timeout=120,
    )
    summary = (result.stdout + result.stderr).strip()[-1000:]
    return result.returncode == 0, summary


def verify_effective_unit(snapshot: dict[str, Any], unit: str) -> tuple[bool, str]:
    release_path = snapshot.get("release_path")
    if not isinstance(release_path, str) or unit not in {*TIMER_UNITS, WORKER_UNIT}:
        return False, "unit is not allowlisted"
    expected = Path(release_path) / "systemd" / unit
    actual = Path("/etc/systemd/system") / unit
    try:
        actual_stat = actual.lstat()
        expected_stat = expected.lstat()
        if (
            actual.is_symlink()
            or expected.is_symlink()
            or not actual.is_file()
            or not expected.is_file()
            or actual_stat.st_uid != 0
            or actual_stat.st_gid != 0
            or actual_stat.st_nlink != 1
            or actual_stat.st_mode & 0o777 != 0o644
            or expected_stat.st_uid != 0
            or expected_stat.st_gid != 0
            or expected_stat.st_nlink != 1
            or actual.read_bytes() != expected.read_bytes()
        ):
            return False, "installed unit does not exactly match the sealed release"
    except OSError as error:
        return False, f"unit verification failed: {error}"
    effective = unit_snapshot(unit)
    if (
        effective.get("load") != "loaded"
        or effective.get("fragment_path") != str(actual)
        or effective.get("drop_in_paths") != ""
        or effective.get("needs_daemon_reload") != "no"
    ):
        return False, "effective unit has drift, a drop-in, or a pending daemon reload"
    return True, "verified"


def execute_actions(snapshot: dict[str, Any], actions: list[dict[str, str]]) -> list[dict[str, Any]]:
    if not actions:
        return []
    try:
        lock_stat = ACTIVATION_LOCK.lstat()
        if (
            ACTIVATION_LOCK.is_symlink()
            or not ACTIVATION_LOCK.is_file()
            or lock_stat.st_uid != 0
            or lock_stat.st_gid != 0
            or lock_stat.st_nlink != 1
            or lock_stat.st_mode & 0o777 != 0o600
        ):
            raise OSError("activation lock is unsafe")
        activation_fd = os.open(ACTIVATION_LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        return [{"action": item, "ok": False, "detail": str(error)} for item in actions]
    try:
        try:
            fcntl.flock(activation_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return [{"action": item, "ok": False, "detail": "activation lock is held"} for item in actions]
        current_release, valid, current_path = release_identity()
        activation_epoch = latest_activation_epoch(current_release)
        current_cutover = cutover_gate_snapshot(
            current_release, current_path, activation_epoch, int(snapshot["observed_at_epoch"])
        )
        if (
            os.path.lexists(ACTIVATION_MARKER)
            or not valid
            or current_release != snapshot.get("release_id")
            or current_path != snapshot.get("release_path")
            or not current_cutover.get("ready")
        ):
            return [{"action": item, "ok": False, "detail": "activation or cutover state changed"} for item in actions]
        verified, verification_detail = verify_installed_release(snapshot)
        if not verified:
            return [
                {"action": item, "ok": False, "detail": f"release verification failed: {verification_detail}"}
                for item in actions
            ]
        results: list[dict[str, Any]] = []
        for item in actions:
            kind = item.get("kind")
            unit = item.get("unit")
            command: list[str] | None = None
            unit_verified, unit_detail = verify_effective_unit(snapshot, str(unit))
            if not unit_verified:
                results.append({"action": item, "ok": False, "detail": unit_detail})
                continue
            if kind == "start_timer" and unit in set(TIMER_UNITS):
                command = ["/usr/bin/systemctl", "start", unit]
            elif kind == "restart_worker" and unit == WORKER_UNIT:
                command = ["/usr/bin/systemctl", "restart", unit]
            if command is None:
                results.append({"action": item, "ok": False, "detail": "action rejected by allowlist"})
                continue
            result = run(command, timeout=60)
            results.append(
                {
                    "action": item,
                    "ok": result.returncode == 0,
                    "detail": (result.stdout + result.stderr).strip()[-1000:],
                }
            )
        return results
    finally:
        os.close(activation_fd)


def queue_incident(
    incident_id: str,
    snapshot: dict[str, Any],
    issues: list[str],
    remediation: list[dict[str, Any]],
    *,
    incident_fingerprint: str | None = None,
    observed_issues: list[str] | None = None,
) -> Path:
    incident = build_incident_payload(
        incident_id,
        snapshot,
        issues,
        remediation,
        incident_fingerprint=incident_fingerprint,
        observed_issues=observed_issues,
    )
    return queue_incident_payload(incident)


def build_incident_payload(
    incident_id: str,
    snapshot: dict[str, Any],
    issues: list[str],
    remediation: list[dict[str, Any]],
    *,
    incident_fingerprint: str | None = None,
    observed_issues: list[str] | None = None,
) -> dict[str, Any]:
    if INCIDENT_RE.fullmatch(incident_id) is None:
        raise ValueError("unsafe incident id")
    return {
        "format_version": 1,
        "incident_id": incident_id,
        "created_at_epoch": snapshot["observed_at_epoch"],
        "release_id": snapshot.get("release_id"),
        "app_commit": snapshot.get("app_commit"),
        "fingerprint": incident_fingerprint or fingerprint(snapshot.get("release_id"), issues),
        "issues": issues,
        "observed_issues": observed_issues if observed_issues is not None else issues,
        "automatic_remediation": remediation,
        "snapshot": snapshot,
        "boundaries": {
            "provider_credit_rearm_allowed": False,
            "production_database_mutation_allowed": False,
            "production_deployment_allowed": False,
            "payout_or_payment_changes_allowed": False,
        },
    }


def queue_incident_payload(incident: dict[str, Any]) -> Path:
    incident_id = incident.get("incident_id")
    if (
        not isinstance(incident_id, str)
        or INCIDENT_RE.fullmatch(incident_id) is None
        or incident.get("format_version") != 1
    ):
        raise ValueError("unsafe incident payload")
    path = QUEUE_DIR / f"{incident_id}.json"
    atomic_json(path, incident)
    return path


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish_incident_handoff(queued_path: Path, target: Path) -> bool:
    """Publish a pre-owned inbox file atomically, retaining the queue until durable."""
    service = pwd.getpwnam("creator-tracker-codex")
    group = grp.getgrnam("creator-tracker-codex")
    source_bytes = queued_path.read_bytes()
    if target.exists() or target.is_symlink():
        stat = target.lstat()
        if (
            not target.is_symlink()
            and target.is_file()
            and stat.st_uid == 0
            and stat.st_gid == group.gr_gid
            and stat.st_nlink == 1
            and stat.st_mode & 0o777 == 0o440
            and target.read_bytes() == source_bytes
        ):
            queued_path.unlink()
            _fsync_directory(QUEUE_DIR)
            return True
        return False
    temporary = INBOX_DIR / f".{target.name}.{os.getpid()}.{time.time_ns()}.tmp"
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o440,
    )
    try:
        os.fchown(descriptor, 0, group.gr_gid)
        os.fchmod(descriptor, 0o440)
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(source_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, target)
        _fsync_directory(INBOX_DIR)
        queued_path.unlink()
        _fsync_directory(QUEUE_DIR)
        return True
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _read_safe_regular(
    path: Path, *, owner_uid: int, owner_gid: int, mode: int, limit: int
) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        if (
            not stat_module.S_ISREG(info.st_mode)
            or info.st_uid != owner_uid
            or info.st_gid != owner_gid
            or info.st_nlink != 1
            or stat_module.S_IMODE(info.st_mode) != mode
            or info.st_size > limit
        ):
            raise OSError(f"unsafe file metadata: {path}")
        output = bytearray()
        while chunk := os.read(descriptor, min(1024 * 1024, limit + 1 - len(output))):
            output.extend(chunk)
            if len(output) > limit:
                raise OSError(f"file exceeds size limit: {path}")
        return bytes(output)
    finally:
        os.close(descriptor)


def _digest_safe_regular(
    path: Path, *, owner_uid: int, owner_gid: int, mode: int, limit: int
) -> tuple[str, int]:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        if (
            not stat_module.S_ISREG(info.st_mode)
            or info.st_uid != owner_uid
            or info.st_gid != owner_gid
            or info.st_nlink != 1
            or stat_module.S_IMODE(info.st_mode) != mode
            or info.st_size > limit
        ):
            raise OSError(f"unsafe file metadata: {path}")
        digest = hashlib.sha256()
        consumed = 0
        while chunk := os.read(descriptor, 1024 * 1024):
            consumed += len(chunk)
            if consumed > limit:
                raise OSError(f"file exceeds size limit: {path}")
            digest.update(chunk)
        return digest.hexdigest(), consumed
    finally:
        os.close(descriptor)


def _attempt_directories(root: Path, incident_id: str) -> list[Path]:
    if INCIDENT_RE.fullmatch(incident_id) is None or not root.exists():
        return []
    output: list[Path] = []
    try:
        candidates = root.iterdir()
        for path in candidates:
            match = ATTEMPT_RE.fullmatch(path.name)
            if match is None or match.group("incident") != incident_id:
                continue
            info = path.lstat()
            if not path.is_symlink() and stat_module.S_ISDIR(info.st_mode):
                output.append(path)
    except OSError:
        return []
    return sorted(output)


def _all_attempt_directories(root: Path) -> list[Path]:
    if not root.exists():
        return []
    output: list[Path] = []
    try:
        for path in root.iterdir():
            if ATTEMPT_RE.fullmatch(path.name) is None:
                continue
            info = path.lstat()
            if not path.is_symlink() and stat_module.S_ISDIR(info.st_mode):
                output.append(path)
    except OSError:
        return []
    return sorted(output)


def trusted_report_is_terminal(trusted_exit_raw: bytes, result_raw: bytes) -> bool:
    """Accept only a verified diagnosis or candidate as a terminal incident outcome."""
    try:
        if trusted_exit_raw != b"0\n":
            return False
        result = json.loads(result_raw.decode("utf-8"))
        if not isinstance(result, dict):
            return False
        expected_recommendations = {
            "no_action": "none",
            "external_or_data_issue": "operator_action_required",
            "verified_candidate": "review_candidate",
        }
        status = result.get("status")
        if status not in expected_recommendations:
            return False
        if result.get("production_recommendation") != expected_recommendations[status]:
            return False
        changed_files = result.get("changed_files")
        if not isinstance(changed_files, list) or not all(
            isinstance(path, str) for path in changed_files
        ):
            return False
        if status == "verified_candidate" and not changed_files:
            return False
        if status == "no_action" and changed_files:
            return False
        return True
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False


def terminal_report_exists(incident_id: str) -> bool:
    if INCIDENT_RE.fullmatch(incident_id) is None:
        return False
    for report_dir in _attempt_directories(REPORTS_DIR, incident_id):
        try:
            directory_info = report_dir.lstat()
            if (
                directory_info.st_uid != 0
                or directory_info.st_gid != 0
                or stat_module.S_IMODE(directory_info.st_mode) != 0o700
            ):
                continue
            expected_names = set(REPORT_HASHED_FILES) | {"SHA256SUMS", "COMPLETE"}
            if {entry.name for entry in report_dir.iterdir()} != expected_names:
                continue
            marker_bytes = _read_safe_regular(
                report_dir / "COMPLETE",
                owner_uid=0,
                owner_gid=0,
                mode=0o400,
                limit=4096,
            )
            manifest_bytes = _read_safe_regular(
                report_dir / "SHA256SUMS",
                owner_uid=0,
                owner_gid=0,
                mode=0o600,
                limit=64 * 1024,
            )
            marker = json.loads(marker_bytes.decode("utf-8"))
            now = int(time.time())
            if (
                not isinstance(marker, dict)
                or set(marker) != {"format_version", "manifest_sha256", "completed_at_epoch"}
                or marker.get("format_version") != 1
                or re.fullmatch(r"[0-9a-f]{64}", str(marker.get("manifest_sha256", ""))) is None
                or hashlib.sha256(manifest_bytes).hexdigest() != marker["manifest_sha256"]
                or not isinstance(marker.get("completed_at_epoch"), int)
                or marker["completed_at_epoch"] > now + 60
            ):
                continue
            hashes: dict[str, str] = {}
            for line in manifest_bytes.decode("ascii").splitlines():
                digest, separator, filename = line.partition("  ")
                if (
                    separator != "  "
                    or re.fullmatch(r"[0-9a-f]{64}", digest) is None
                    or filename in hashes
                ):
                    raise ValueError("invalid report manifest")
                hashes[filename] = digest
            if set(hashes) != set(REPORT_HASHED_FILES):
                continue
            total_size = 0
            valid = True
            for filename, expected_hash in hashes.items():
                actual_hash, size = _digest_safe_regular(
                    report_dir / filename,
                    owner_uid=0,
                    owner_gid=0,
                    mode=0o400 if filename == "READY" else 0o600,
                    limit=REPORT_FILE_LIMITS.get(filename, 64 * 1024),
                )
                total_size += size
                if total_size > REPORT_TOTAL_SIZE_LIMIT or actual_hash != expected_hash:
                    valid = False
                    break
            if valid and trusted_report_is_terminal(
                _read_safe_regular(
                    report_dir / "trusted-verification-exit",
                    owner_uid=0,
                    owner_gid=0,
                    mode=0o600,
                    limit=REPORT_FILE_LIMITS.get("trusted-verification-exit", 64 * 1024),
                ),
                _read_safe_regular(
                    report_dir / "result.json",
                    owner_uid=0,
                    owner_gid=0,
                    mode=0o600,
                    limit=REPORT_FILE_LIMITS.get("result.json", 64 * 1024),
                ),
            ):
                return True
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
            continue
    return False


def staged_attempts(incident_id: str) -> list[Path]:
    attempts = _attempt_directories(READY_DIR, incident_id)
    attempts.extend(_attempt_directories(VERIFICATION_PROCESSING_DIR, incident_id))
    return attempts


def incident_attempt_count(incident_id: str) -> int:
    if INCIDENT_RE.fullmatch(incident_id) is None:
        return 0
    names = {
        path.name
        for root in (
            PRODUCING_DIR,
            READY_DIR,
            VERIFICATION_PROCESSING_DIR,
            VERIFICATION_REJECTED_DIR,
            REPORTS_DIR,
        )
        for path in _attempt_directories(root, incident_id)
    }
    return len(names)


def verify_autopilot_artifacts() -> tuple[bool, str]:
    """Bind every privileged handoff component to the reviewed install set."""
    try:
        manifest_bytes = _read_safe_regular(
            AUTOPILOT_MANIFEST,
            owner_uid=0,
            owner_gid=0,
            mode=0o444,
            limit=64 * 1024,
        )
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        if (
            not isinstance(manifest, dict)
            or set(manifest) != {"format_version", "files"}
            or manifest.get("format_version") != 1
            or not isinstance(manifest.get("files"), dict)
            or set(manifest["files"]) != set(AUTOPILOT_ARTIFACTS)
        ):
            return False, "autopilot artifact manifest has an invalid structure"
        for raw_path, expected_mode in AUTOPILOT_ARTIFACTS.items():
            entry = manifest["files"].get(raw_path)
            if (
                not isinstance(entry, dict)
                or set(entry) != {"sha256", "size"}
                or re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", ""))) is None
                or not isinstance(entry.get("size"), int)
                or not 0 <= entry["size"] <= 16 * 1024 * 1024
            ):
                return False, f"autopilot manifest entry is invalid: {raw_path}"
            actual_hash, actual_size = _digest_safe_regular(
                Path(raw_path),
                owner_uid=0,
                owner_gid=0,
                mode=expected_mode,
                limit=16 * 1024 * 1024,
            )
            if actual_hash != entry["sha256"] or actual_size != entry["size"]:
                return False, f"autopilot artifact drifted: {raw_path}"
        return True, "verified"
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False, "autopilot artifact manifest or installed artifact is unsafe"


def verify_autopilot_unit(unit: str) -> tuple[bool, str]:
    expected: dict[str, dict[str, str]] = {
        AGENT_UNIT: {
            "User": "creator-tracker-codex",
            "Group": "creator-tracker-codex",
            "NoNewPrivileges": "yes",
            "ProtectSystem": "strict",
            "ProtectHome": "tmpfs",
            "PrivateDevices": "yes",
            "PrivateTmp": "yes",
            "PrivateIPC": "yes",
        },
        VERIFIER_UNIT: {
            "User": "root",
            "Group": "root",
            "NoNewPrivileges": "yes",
            "ProtectSystem": "strict",
            "ProtectHome": "yes",
            "PrivateNetwork": "yes",
            "PrivateDevices": "yes",
            "PrivateIPC": "yes",
        },
    }
    required = expected.get(unit)
    if required is None:
        return False, "autopilot unit is not allowlisted"
    unit_path = Path("/etc/systemd/system") / unit
    properties = [
        "LoadState",
        "FragmentPath",
        "DropInPaths",
        "NeedDaemonReload",
        *required,
    ]
    shown = run(
        [
            "/usr/bin/systemctl",
            "show",
            unit,
            *[f"--property={name}" for name in properties],
        ]
    )
    observed: dict[str, str] = {}
    for line in shown.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            observed[key] = value
    if (
        shown.returncode != 0
        or observed.get("LoadState") != "loaded"
        or observed.get("FragmentPath") != str(unit_path)
        or observed.get("DropInPaths") != ""
        or observed.get("NeedDaemonReload") != "no"
        or any(observed.get(key) != value for key, value in required.items())
    ):
        return False, f"effective {unit} failed hardening or drift verification"
    return True, "verified"


def start_agent_if_queued(snapshot: dict[str, Any] | None = None) -> dict[str, Any] | None:
    # Root owns both queue directory entries and the handoff. The no-login
    # Codex user receives read-only manifests and cannot inject work.
    active_states = {
        "active",
        "activating",
        "deactivating",
        "reloading",
    }
    agent_already_active = unit_snapshot(AGENT_UNIT).get("active") in active_states
    verifier_already_active = unit_snapshot(VERIFIER_UNIT).get("active") in active_states
    for inbox_path in sorted(INBOX_DIR.glob("*.json")) if INBOX_DIR.exists() else []:
        try:
            if terminal_report_exists(inbox_path.stem):
                inbox_path.unlink()
                _fsync_directory(INBOX_DIR)
            elif (
                not agent_already_active
                and not verifier_already_active
                and not staged_attempts(inbox_path.stem)
                and (
                    bool(
                        _attempt_directories(
                            VERIFICATION_REJECTED_DIR, inbox_path.stem
                        )
                    )
                    or incident_attempt_count(inbox_path.stem)
                    >= MAX_CODEX_ATTEMPTS_PER_INCIDENT
                )
            ):
                dead_letter = DEAD_LETTER_DIR / inbox_path.name
                if not dead_letter.exists() and not dead_letter.is_symlink():
                    os.replace(inbox_path, dead_letter)
                    shutil.chown(dead_letter, user="root", group="root")
                    os.chmod(dead_letter, 0o640)
                    _fsync_directory(INBOX_DIR)
                    _fsync_directory(DEAD_LETTER_DIR)
        except OSError:
            continue
    for queued_path in sorted(QUEUE_DIR.glob("*.json")) if QUEUE_DIR.exists() else []:
        target = INBOX_DIR / queued_path.name
        try:
            stat = queued_path.lstat()
            if (
                queued_path.is_symlink()
                or not queued_path.is_file()
                or stat.st_uid != 0
                or stat.st_gid != 0
                or stat.st_nlink != 1
                or stat.st_mode & 0o777 != 0o640
                or stat.st_size > 2 * 1024 * 1024
                or INCIDENT_RE.fullmatch(queued_path.stem) is None
            ):
                continue
            publish_incident_handoff(queued_path, target)
        except OSError:
            continue
    inbox = sorted(INBOX_DIR.glob("*.json")) if INBOX_DIR.exists() else []
    ready_attempts = _all_attempt_directories(READY_DIR)
    verification_attempts = _all_attempt_directories(VERIFICATION_PROCESSING_DIR)
    if not inbox and not ready_attempts and not verification_attempts:
        return None
    if snapshot is None:
        snapshot = collect_snapshot()
    activation = snapshot.get("activation", {})
    storage = snapshot.get("storage_available_bytes")
    if (
        snapshot.get("maintenance_in_progress")
        or not snapshot.get("release_identity_valid")
        or snapshot.get("release_integrity", {}).get("ready") is not True
        or snapshot.get("cutover", {}).get("ready") is not True
        or activation.get("lock_valid") is not True
        or activation.get("lock_held") is True
        or activation.get("marker_present") is True
        or not isinstance(storage, int)
        or storage < STORAGE_MIN_FREE_BYTES
    ):
        return {
            "requested": False,
            "ok": False,
            "queued": len(inbox),
            "detail": "autopilot work deferred by activation, cutover, release-integrity, or storage gate",
        }
    artifacts_ready, artifact_detail = verify_autopilot_artifacts()
    if not artifacts_ready:
        return {
            "requested": False,
            "ok": False,
            "queued": len(inbox),
            "detail": artifact_detail,
        }

    # Trusted verification always wins. A staged attempt is an attempt
    # reservation, so the five-minute sentinel cannot launch a duplicate model
    # run while verification is running or recovering after a reboot.
    if ready_attempts or verification_attempts:
        if verifier_already_active:
            return {
                "requested": False,
                "ok": True,
                "queued": len(inbox),
                "component": "verifier",
                "detail": "trusted verifier is already active",
            }
        if agent_already_active:
            return {
                "requested": False,
                "ok": True,
                "queued": len(inbox),
                "component": "codex",
                "detail": "Codex is still producing the READY attempt",
            }
        unit_ready, unit_detail = verify_autopilot_unit(VERIFIER_UNIT)
        if not unit_ready:
            return {
                "requested": False,
                "ok": False,
                "queued": len(inbox),
                "component": "verifier",
                "detail": unit_detail,
            }
        result = run(["/usr/bin/systemctl", "start", "--no-block", VERIFIER_UNIT], timeout=30)
        return {
            "requested": True,
            "ok": result.returncode == 0,
            "queued": len(inbox),
            "component": "verifier",
            "detail": (result.stdout + result.stderr).strip()[-1000:],
        }

    if not inbox:
        return None
    if agent_already_active or verifier_already_active:
        return {
            "requested": False,
            "ok": True,
            "queued": len(inbox),
            "component": "codex" if agent_already_active else "verifier",
            "detail": "autopilot pipeline is already active",
        }
    unit_ready, unit_detail = verify_autopilot_unit(AGENT_UNIT)
    if not unit_ready:
        return {
            "requested": False,
            "ok": False,
            "queued": len(inbox),
            "component": "codex",
            "detail": unit_detail,
        }
    verifier_unit_ready, verifier_unit_detail = verify_autopilot_unit(VERIFIER_UNIT)
    if not verifier_unit_ready:
        return {
            "requested": False,
            "ok": False,
            "queued": len(inbox),
            "component": "verifier",
            "detail": verifier_unit_detail,
        }
    result = run(["/usr/bin/systemctl", "start", "--no-block", AGENT_UNIT], timeout=30)
    return {
        "requested": True,
        "ok": result.returncode == 0,
        "queued": len(inbox),
        "component": "codex",
        "detail": (result.stdout + result.stderr).strip()[-1000:],
    }


def inspection() -> dict[str, Any]:
    snapshot = collect_snapshot()
    previous, state_error = load_probe_state()
    apply_activation_deadman(previous, snapshot)
    baseline = next_coverage_baseline(previous if state_error is None else {}, snapshot)
    baseline = accept_dispatched_target_regressions(
        baseline, snapshot, previous if state_error is None else {}
    )
    actions, issues = evaluate_snapshot(snapshot, baseline)
    if state_error is not None:
        issues = sorted(set(issues + ["sentinel_state_invalid"]))
    return {
        "format_version": 1,
        "observed_at_epoch": snapshot["observed_at_epoch"],
        "release_id": snapshot.get("release_id"),
        "app_commit": snapshot.get("app_commit"),
        "maintenance_in_progress": snapshot.get("maintenance_in_progress"),
        "cutover": snapshot.get("cutover"),
        "activation": snapshot.get("activation"),
        "would_automatically_remediate": actions,
        "issues": issues,
        "state_error": state_error,
    }


def probe() -> int:
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(LOCK_FILE, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as lock_handle:
        try:
            fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        previous, state_error = load_probe_state()
        snapshot = collect_snapshot()
        activation_first_seen = apply_activation_deadman(previous, snapshot)
        if state_error is not None:
            status = {
                "format_version": 1,
                "observed_at_epoch": snapshot["observed_at_epoch"],
                "state": "sentinel_state_invalid",
                "release_id": snapshot.get("release_id"),
                "app_commit": snapshot.get("app_commit"),
                "issues": ["sentinel_state_invalid"],
                "detail": state_error,
                "streak": 0,
                "automatic_remediation": [],
                "codex": None,
            }
            atomic_json(STATUS_FILE, status)
            print(json.dumps(status, sort_keys=True, separators=(",", ":")))
            return 1
        pending_from_prior_probe = previous.get("pending_incident")
        if isinstance(pending_from_prior_probe, dict):
            queue_incident_payload(pending_from_prior_probe)
            previous = dict(previous)
            previous.pop("pending_incident", None)
            atomic_json(STATE_FILE, previous)
        coverage_baseline = next_coverage_baseline(previous, snapshot)
        coverage_baseline = accept_dispatched_target_regressions(
            coverage_baseline, snapshot, previous
        )
        if (
            (not previous or previous.get("status") == "awaiting_baseline")
            and set(coverage_baseline) != set(COVERAGE_REGRESSION_LIMITS)
        ):
            bootstrap_state = {
                "format_version": 1,
                "dispatches": previous.get("dispatches", []),
                "automatic_actions": previous.get("automatic_actions", []),
                "coverage_baseline": coverage_baseline,
                "coverage_baseline_release": snapshot.get("release_id"),
                "last_probe_epoch": snapshot["observed_at_epoch"],
                "status": "awaiting_baseline",
                "fingerprint": None,
                "streak": 0,
            }
            status = {
                "format_version": 1,
                "observed_at_epoch": snapshot["observed_at_epoch"],
                "state": "awaiting_initial_coverage_baseline",
                "release_id": snapshot.get("release_id"),
                "app_commit": snapshot.get("app_commit"),
                "issues": ["initial_coverage_baseline_incomplete"],
                "streak": 0,
                "automatic_remediation": [],
                "codex": None,
            }
            atomic_json(STATE_FILE, bootstrap_state)
            atomic_json(STATUS_FILE, status)
            print(json.dumps(status, sort_keys=True, separators=(",", ":")))
            return 1
        actions, issues = evaluate_snapshot(snapshot, coverage_baseline)
        selected, suppressed, action_history = select_automatic_actions(
            previous, actions, int(snapshot["observed_at_epoch"])
        )
        state, should_dispatch, incident_id = update_incident_state(previous, snapshot, issues)
        coverage_baseline = accept_dispatched_target_regressions(
            coverage_baseline, snapshot, state
        )
        state["coverage_baseline_release"] = snapshot.get("release_id")
        state["coverage_baseline"] = coverage_baseline
        if activation_first_seen is not None:
            state["activation_lock_first_seen_epoch"] = activation_first_seen
        now = int(snapshot["observed_at_epoch"])
        reservations = [
            {
                "at_epoch": now,
                "kind": action["kind"],
                "unit": action["unit"],
                "ok": None,
            }
            for action in selected
        ]
        action_history.extend(reservations)
        state["automatic_actions"] = action_history[-MAX_AUTOMATIC_ACTIONS_PER_DAY * 4 :]
        pending_incident: dict[str, Any] | None = None
        if should_dispatch and incident_id is not None:
            dispatch_issues = state.get("dispatch_issues", [])
            if not isinstance(dispatch_issues, list) or not all(
                isinstance(issue, str) for issue in dispatch_issues
            ):
                dispatch_issues = []
            pending_incident = build_incident_payload(
                incident_id,
                snapshot,
                dispatch_issues,
                [
                    {"action": action, "ok": False, "detail": "automatic action reserved"}
                    for action in selected
                ]
                + suppressed,
                incident_fingerprint=state.get("fingerprint"),
                observed_issues=issues,
            )
            state["pending_incident"] = pending_incident
        # Persist rate-limit and dispatch reservations before any external side
        # effect. A power loss may delay a repair, but cannot repeat it for free.
        atomic_json(STATE_FILE, state)

        remediation = execute_actions(snapshot, selected)
        remediation.extend(suppressed)
        for result in remediation:
            action = result.get("action", {})
            for reservation in reservations:
                if (
                    reservation["kind"] == action.get("kind")
                    and reservation["unit"] == action.get("unit")
                ):
                    reservation["ok"] = result.get("ok") is True
                    break
        if pending_incident is not None:
            pending_incident["automatic_remediation"] = remediation
            state["pending_incident"] = pending_incident
            atomic_json(STATE_FILE, state)
            queue_incident_payload(pending_incident)
            state.pop("pending_incident", None)
        agent_request = start_agent_if_queued(snapshot)
        status = {
            "format_version": 1,
            "observed_at_epoch": snapshot["observed_at_epoch"],
            "state": state["status"],
            "release_id": snapshot.get("release_id"),
            "app_commit": snapshot.get("app_commit"),
            "issues": issues,
            "streak": state.get("streak", 0),
            "automatic_remediation": remediation,
            "codex": agent_request,
        }
        atomic_json(STATE_FILE, state)
        atomic_json(STATUS_FILE, status)
        print(json.dumps(status, sort_keys=True, separators=(",", ":")))
    return 0


def enqueue_smoke() -> int:
    now = int(time.time())
    snapshot = collect_snapshot(now)
    smoke_fingerprint = fingerprint(snapshot.get("release_id"), ["integration_smoke_test"])
    incident_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now)) + "-" + smoke_fingerprint[:16]
    queue_incident(incident_id, snapshot, ["integration_smoke_test"], [])
    request = start_agent_if_queued(snapshot)
    print(json.dumps({"incident_id": incident_id, "codex": request}, sort_keys=True))
    return 0 if request and request.get("ok") else 1


def verify_current_cutover() -> int:
    now = int(time.time())
    release_id, release_valid, release_path = release_identity()
    activation_epoch = latest_activation_epoch(release_id)
    cutover = cutover_gate_snapshot(release_id, release_path, activation_epoch, now)
    output = {
        "release_id": release_id,
        "release_identity_valid": release_valid,
        "cutover": cutover,
    }
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))
    return 0 if release_valid and cutover.get("ready") is True else 1


def verify_artifacts_command() -> int:
    ready, detail = verify_autopilot_artifacts()
    print(
        json.dumps(
            {"ready": ready, "detail": detail},
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0 if ready else 1


def show_status() -> int:
    status = read_json(STATUS_FILE, {"state": "not_yet_run"})
    queue_count = len(list(QUEUE_DIR.glob("*.json"))) if QUEUE_DIR.exists() else 0
    inbox_count = len(list(INBOX_DIR.glob("*.json"))) if INBOX_DIR.exists() else 0
    dead_letter_count = (
        len(list(DEAD_LETTER_DIR.glob("*.json"))) if DEAD_LETTER_DIR.exists() else 0
    )
    processing_root = STATE_ROOT / "processing"
    processing_count = (
        sum(
            1
            for path in processing_root.iterdir()
            if not path.is_symlink() and path.is_file()
        )
        if processing_root.exists()
        else 0
    )
    reports = list((STATE_ROOT / "reports").glob("*/result.json"))
    latest_report = max(reports, key=lambda path: path.stat().st_mtime_ns) if reports else None
    output = {
        "status": status,
        "queued_incidents": queue_count,
        "handed_off_incidents": inbox_count,
        "dead_letter_incidents": dead_letter_count,
        "processing_incidents": processing_count,
        "producing_attempts": len(_all_attempt_directories(PRODUCING_DIR)),
        "ready_attempts": len(_all_attempt_directories(READY_DIR)),
        "verification_attempts": len(
            _all_attempt_directories(VERIFICATION_PROCESSING_DIR)
        ),
        "rejected_attempts": len(_all_attempt_directories(VERIFICATION_REJECTED_DIR)),
        "completed_reports": len(_all_attempt_directories(REPORTS_DIR)),
        "latest_codex_result": read_json(latest_report, None) if latest_report else None,
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=(
            "inspect",
            "probe",
            "enqueue-smoke",
            "verify-current-cutover",
            "verify-autopilot-artifacts",
            "status",
        ),
    )
    args = parser.parse_args()
    if args.command == "inspect":
        print(json.dumps(inspection(), indent=2, sort_keys=True))
        return 0
    if args.command == "probe":
        return probe()
    if args.command == "enqueue-smoke":
        return enqueue_smoke()
    if args.command == "verify-current-cutover":
        return verify_current_cutover()
    if args.command == "verify-autopilot-artifacts":
        return verify_artifacts_command()
    return show_status()


if __name__ == "__main__":
    sys.exit(main())
