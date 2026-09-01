#!/usr/bin/python3 -I
"""Render root-owned per-role collector configuration without application code."""

from __future__ import annotations

import json
import os
import re
import stat
import sys
import base64
import pwd
from pathlib import Path
from urllib.parse import urlsplit


MAX_ENV_BYTES = 1024 * 1024
PRODUCTION_OWNER_UID = 1000
NEW_DATABASE = "/var/lib/creator-tracker/state/gotall-viral.db"
LEGACY_DATABASE = "/home/ark296/projects/gotall-viral-dash/data/gotall-viral.db"

DANGEROUS_KEYS = {
    "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT",
    "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "BASH_LOADABLES_PATH",
    "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PERL5OPT", "PERL5LIB",
    "RUBYOPT", "RUBYLIB", "GCONV_PATH",
}
RECOGNIZED_KEYS = {
    "GOTALL_SHADOW_MODE", "VIRAL_DB_PATH", "TIKTOK_ADS_ACCESS_TOKEN",
    "TIKTOK_ADS_ADVERTISER_ID", "TIKTOK_ADS_TIMEZONE", "TIKTOK_LOOKBACK_DAYS",
    "SHADOW_PERIOD_START", "SHADOW_PERIOD_END", "VIRAL_APP_COMPARE_LIMIT",
    "SCRAPE_CONCURRENCY", "SCRAPE_MAX_VIDEOS", "SCRAPE_TIMEOUT_MS",
    "TRACKER_MAX_DISCOVERY_CREATORS_PER_RUN", "TRACKER_MAX_OBSERVATIONS_PER_RUN",
    "TIKTOK_FALLBACK", "TIKTOK_PROVIDER_MAX_REQUESTS_PER_RUN",
    "SCRAPECREATORS_API_KEY", "SCRAPECREATORS_PROVIDER_CREDIT_RESERVE",
    "INSTAGRAM_PROVIDER_CREDIT_RESERVE", "INSTAGRAM_PROVIDER_MAX_REQUESTS_PER_RUN",
    "INSTAGRAM_PROVIDER_MAX_PROFILE_PAGES_PER_RUN",
    "INSTAGRAM_PROVIDER_MAX_CREDITS_PER_RUN", "DASH_BASIC_AUTH_USER",
    "DASH_BASIC_AUTH_PASS", "DASH_EXTRA_USERS",
    "SCRAPECREATORS_API_KEY_CONFIGURED", "CREATOR_TRACKER_INGEST_ENDPOINT_URL",
    "CREATOR_INGEST_CURRENT_KEY_ID", "CREATOR_INGEST_CURRENT_SECRET_B64",
    "CREATOR_INGEST_PREVIOUS_KEY_ID", "CREATOR_INGEST_PREVIOUS_SECRET_B64",
    "CREATOR_TRACKER_DELIVERY_TIMEOUT_MS", "CREATOR_TRACKER_DELIVERY_LEASE_MS",
}
PROVIDER_SOURCE_KEYS = {
    "DATABASE_URL", "SUPABASE_PK", "SUPABASE_SK", "SUPABASE_URL",
    "VIRAL_APP_API_KEY", "VIRAL_APP_BASE_URL",
}
HOST_KEYS = {
    "CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS",
    "CREATOR_TRACKER_DASHBOARD_HEALTH_URL",
    "CREATOR_TRACKER_DASHBOARD_EXPECTED_CODES",
    "CREATOR_TRACKER_DASHBOARD_TIMEOUT_SECONDS",
    "CREATOR_TRACKER_WORKER_HEARTBEAT_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_SCHEDULER_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_ROSTER_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_INSTAGRAM_SCHEDULER_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_INSTAGRAM_DISCOVERY_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_PROVIDER_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_CANONICAL_DELIVERY_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_RAW_VERIFIER_SUCCESS_MAX_AGE_SECONDS",
    "CREATOR_TRACKER_STORAGE_MIN_FREE_BYTES",
    "VIRAL_APP_CREDENTIALS_PATH",
    "CREATOR_TRACKER_ROSTER_EXECUTABLE", "CREATOR_TRACKER_SCHEDULER_EXECUTABLE",
    "CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE",
    "CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE",
    "CREATOR_TRACKER_PROVIDER_EXECUTABLE", "CREATOR_TRACKER_WORKER_EXECUTABLE",
    "CREATOR_TRACKER_COVERAGE_EXECUTABLE",
}
HEALTH_RUNTIME_KEYS = tuple(
    key for key in HOST_KEYS
    if key.startswith("CREATOR_TRACKER_") and not key.endswith("_EXECUTABLE")
)
TIKTOK_KEYS = (
    "SCRAPE_TIMEOUT_MS", "TRACKER_MAX_DISCOVERY_CREATORS_PER_RUN",
    "TRACKER_MAX_OBSERVATIONS_PER_RUN", "TIKTOK_FALLBACK",
    "TIKTOK_PROVIDER_MAX_REQUESTS_PER_RUN", "SCRAPECREATORS_API_KEY",
    "SCRAPECREATORS_PROVIDER_CREDIT_RESERVE", "INSTAGRAM_PROVIDER_CREDIT_RESERVE",
)
INSTAGRAM_KEYS = (
    "TRACKER_MAX_DISCOVERY_CREATORS_PER_RUN", "TRACKER_MAX_OBSERVATIONS_PER_RUN",
    "SCRAPECREATORS_API_KEY", "SCRAPECREATORS_PROVIDER_CREDIT_RESERVE",
    "INSTAGRAM_PROVIDER_CREDIT_RESERVE", "INSTAGRAM_PROVIDER_MAX_REQUESTS_PER_RUN",
    "INSTAGRAM_PROVIDER_MAX_PROFILE_PAGES_PER_RUN",
    "INSTAGRAM_PROVIDER_MAX_CREDITS_PER_RUN",
)
INSTAGRAM_CREDIT_REARM_KEYS = (
    "SCRAPECREATORS_API_KEY", "SCRAPECREATORS_PROVIDER_CREDIT_RESERVE",
)
DELIVERY_KEYS = (
    "CREATOR_TRACKER_INGEST_ENDPOINT_URL", "CREATOR_INGEST_CURRENT_KEY_ID",
    "CREATOR_INGEST_CURRENT_SECRET_B64", "CREATOR_INGEST_PREVIOUS_KEY_ID",
    "CREATOR_INGEST_PREVIOUS_SECRET_B64", "CREATOR_TRACKER_DELIVERY_TIMEOUT_MS",
    "CREATOR_TRACKER_DELIVERY_LEASE_MS",
)
CANONICAL_INPUT_KEYS = (
    "CREATOR_TRACKER_V2_DATABASE_URL", "CREATOR_TRACKER_V2_DATABASE_CA_B64",
    "CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS", "CREATOR_INGEST_CURRENT_KEY_ID",
    "CREATOR_INGEST_CURRENT_SECRET_B64", "CREATOR_INGEST_PREVIOUS_KEY_ID",
    "CREATOR_INGEST_PREVIOUS_SECRET_B64", "CREATOR_TRACKER_INGEST_ENDPOINT",
    "CREATOR_TRACKER_DELIVERY_TIMEOUT_MS", "CREATOR_TRACKER_DELIVERY_LEASE_MS",
)
RAW_VERIFIER_KEYS = (
    "CREATOR_TRACKER_RAW_VERIFIER_DATABASE_URL",
    "CREATOR_TRACKER_RAW_VERIFIER_DATABASE_CA_B64",
    "CREATOR_TRACKER_RAW_VERIFIER_ORGANIZATION_ID",
    "CREATOR_TRACKER_RAW_VERIFIER_INSTANCE_ID",
    "CREATOR_TRACKER_RAW_EVIDENCE_ROOT",
    "CREATOR_TRACKER_RAW_EVIDENCE_OWNER_UID",
    "CREATOR_TRACKER_RAW_VERIFIER_ARCHIVE_ROOT",
    "CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_AFTER_SECONDS",
    "CREATOR_TRACKER_RAW_VERIFIER_MANIFEST_LIMIT",
    "CREATOR_TRACKER_RAW_VERIFIER_SCHEDULE_INTERVAL_SECONDS",
    "CREATOR_TRACKER_RAW_VERIFIER_NEW_MANIFEST_SLA_SECONDS",
    "CREATOR_TRACKER_RAW_VERIFIER_EXPECTED_NEW_MANIFESTS_PER_DAY",
    "CREATOR_TRACKER_RAW_VERIFIER_RETENTION_DAYS",
    "CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_SLA_SECONDS",
    "CREATOR_TRACKER_RAW_VERIFIER_MIN_READ_BYTES_PER_SECOND",
    "CREATOR_TRACKER_RAW_VERIFIER_PER_OBJECT_OVERHEAD_MS",
    "CREATOR_TRACKER_RAW_VERIFIER_MAX_TICK_SECONDS",
)
RAW_VERIFIER_DEFAULTS = {
    "CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_AFTER_SECONDS": "604800",
    "CREATOR_TRACKER_RAW_VERIFIER_MANIFEST_LIMIT": "200",
    "CREATOR_TRACKER_RAW_VERIFIER_SCHEDULE_INTERVAL_SECONDS": "300",
    "CREATOR_TRACKER_RAW_VERIFIER_NEW_MANIFEST_SLA_SECONDS": "900",
    "CREATOR_TRACKER_RAW_VERIFIER_EXPECTED_NEW_MANIFESTS_PER_DAY": "90",
    "CREATOR_TRACKER_RAW_VERIFIER_RETENTION_DAYS": "180",
    "CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_SLA_SECONDS": "86400",
    "CREATOR_TRACKER_RAW_VERIFIER_MIN_READ_BYTES_PER_SECOND": "16777216",
    "CREATOR_TRACKER_RAW_VERIFIER_PER_OBJECT_OVERHEAD_MS": "10",
    "CREATOR_TRACKER_RAW_VERIFIER_MAX_TICK_SECONDS": "240",
}
ROLE_KEYS = {
    "roster-refresh": TIKTOK_KEYS,
    "scheduler-tick": TIKTOK_KEYS,
    "instagram-discovery": INSTAGRAM_KEYS,
    "instagram-scheduler": INSTAGRAM_KEYS,
    "instagram-credit-rearm": INSTAGRAM_CREDIT_REARM_KEYS,
    "provider-reconcile": ("CREATOR_TRACKER_PROVIDER_ORGANIZATION_ID",),
    "canonical-delivery": DELIVERY_KEYS,
    "migrate-database": (),
    "collector-worker": ("DASH_BASIC_AUTH_USER", "DASH_BASIC_AUTH_PASS", "DASH_EXTRA_USERS"),
    "check-coverage": (
        "TIKTOK_FALLBACK", "SCRAPECREATORS_API_KEY_CONFIGURED",
        "SCRAPECREATORS_PROVIDER_CREDIT_RESERVE", "INSTAGRAM_PROVIDER_CREDIT_RESERVE",
    ),
}


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker config renderer: {message}")


def read_private(path: str) -> str:
    flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
    except OSError as error:
        fail(f"private input could not be opened: {error.strerror}")
    try:
        before = os.fstat(fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_uid != PRODUCTION_OWNER_UID
            or stat.S_IMODE(before.st_mode) != 0o600
            or before.st_size > MAX_ENV_BYTES
        ):
            fail("input must be an owner-owned singly linked mode 0600 regular file")
        data = os.read(fd, MAX_ENV_BYTES + 1)
        after = os.fstat(fd)
        stable_fields = (
            "st_dev", "st_ino", "st_mode", "st_nlink", "st_uid", "st_gid",
            "st_size", "st_mtime_ns", "st_ctime_ns",
        )
        if len(data) != before.st_size or any(
            getattr(before, field) != getattr(after, field) for field in stable_fields
        ):
            fail("input changed while being read")
    finally:
        os.close(fd)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        fail("input is not UTF-8")


def parse_value(raw: str, line_number: int) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value[0] == '"':
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            fail(f"line {line_number} has an invalid quoted value")
        if not isinstance(parsed, str):
            fail(f"line {line_number} must contain a string value")
        return parsed
    if value[0] == "'":
        if len(value) < 2 or value[-1] != "'":
            fail(f"line {line_number} has an invalid single-quoted value")
        return value[1:-1]
    # Node dotenv treats an unquoted # as a comment delimiter.
    return value.split("#", 1)[0].rstrip()


def parse_env(source: str) -> dict[str, str]:
    if "\0" in source or "\r" in source.replace("\r\n", ""):
        fail("input contains an unsupported control byte")
    parsed: dict[str, str] = {}
    for index, line in enumerate(source.splitlines(), 1):
        if re.fullmatch(r"[\t ]*(?:#.*)?", line):
            continue
        match = re.match(r"^[\t ]*([A-Za-z_][A-Za-z0-9_]*)[\t ]*=(.*)$", line)
        if match is None:
            fail(f"line {index} is not a single-line KEY=value assignment")
        key = match.group(1)
        if key in parsed:
            fail(f"duplicate key is forbidden: {key}")
        parsed[key] = parse_value(match.group(2), index)
    return parsed


def reject_injection(values: dict[str, str]) -> None:
    for key in values:
        if key in DANGEROUS_KEYS or key.startswith("TSX_"):
            fail(f"runtime injection key is forbidden: {key}")


def role_values(owner: dict[str, str], role: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for key in ROLE_KEYS[role]:
        if key == "SCRAPECREATORS_API_KEY_CONFIGURED":
            if owner.get("SCRAPECREATORS_API_KEY"):
                result[key] = "1"
        elif key in owner:
            result[key] = owner[key]
    return result


def dotenv(values: dict[str, str]) -> bytes:
    return ("".join(f"{key}={json.dumps(value)}\n" for key, value in values.items())).encode()


def write_new(path: Path, contents: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        os.write(fd, contents)
        os.fchmod(fd, 0o400)
        os.fsync(fd)
    finally:
        os.close(fd)


def fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def canonical_role_values(values: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    reject_injection(values)
    unknown = set(values) - set(CANONICAL_INPUT_KEYS)
    if unknown:
        fail(f"unknown canonical input key is forbidden: {sorted(unknown)[0]}")
    endpoint = values.get("CREATOR_TRACKER_INGEST_ENDPOINT", "")
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
        or parsed.query or parsed.fragment
        or parsed.path != "/api/v1/creator-tracker/ingestion/batches"
    ):
        fail("canonical delivery endpoint must be the fixed HTTPS ingestion path")
    database_url = urlsplit(values.get("CREATOR_TRACKER_V2_DATABASE_URL", ""))
    if (
        database_url.scheme not in {"postgres", "postgresql"}
        or not database_url.hostname or not database_url.username
        or not database_url.password or database_url.path in {"", "/"}
        or database_url.fragment
    ):
        fail("canonical seed database URL must be PostgreSQL with explicit credentials")
    query = dict(
        pair.split("=", 1) if "=" in pair else (pair, "")
        for pair in database_url.query.split("&") if pair
    )
    if query.get("sslmode") != "verify-full":
        fail("canonical seed database URL must require sslmode=verify-full")
    ca_value = values.get("CREATOR_TRACKER_V2_DATABASE_CA_B64", "")
    try:
        database_ca = base64.b64decode(ca_value, validate=True)
    except ValueError:
        fail("canonical seed database CA is not strict base64")
    if (
        not 1 <= len(database_ca) <= 1024 * 1024
        or b"-----BEGIN CERTIFICATE-----" not in database_ca
    ):
        fail("canonical seed database CA is invalid")
    organizations = [
        item.strip() for item in values.get(
            "CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS", ""
        ).split(",") if item.strip()
    ]
    if len(organizations) != 1 or re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", organizations[0]) is None:
        fail("canonical seed requires exactly one valid allowed organization")
    current_id = values.get("CREATOR_INGEST_CURRENT_KEY_ID", "")
    if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", current_id) is None:
        fail("canonical delivery current key ID is invalid")
    if "CREATOR_INGEST_CURRENT_SECRET_B64" not in values:
        fail("canonical delivery current secret is required")
    for key in ("CREATOR_INGEST_CURRENT_SECRET_B64", "CREATOR_INGEST_PREVIOUS_SECRET_B64"):
        if key not in values:
            continue
        try:
            secret = base64.b64decode(values[key], validate=True)
        except ValueError:
            fail(f"canonical delivery secret is not strict base64: {key}")
        if len(secret) < 32 or len(secret) > 128:
            fail(f"canonical delivery secret has an invalid length: {key}")
    previous_id = values.get("CREATOR_INGEST_PREVIOUS_KEY_ID")
    previous_secret = values.get("CREATOR_INGEST_PREVIOUS_SECRET_B64")
    if (
        (previous_id is None) != (previous_secret is None)
        or previous_id == current_id
        or (
            previous_id is not None
            and re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", previous_id) is None
        )
    ):
        fail("canonical delivery previous credential pair is invalid")
    for key, minimum, maximum in (
        ("CREATOR_TRACKER_DELIVERY_TIMEOUT_MS", 1000, 120000),
        ("CREATOR_TRACKER_DELIVERY_LEASE_MS", 10000, 900000),
    ):
        if key in values and (not values[key].isdigit() or not minimum <= int(values[key]) <= maximum):
            fail(f"canonical delivery timing is invalid: {key}")
    delivery = {
        "CREATOR_TRACKER_INGEST_ENDPOINT_URL": endpoint,
        **{
            key: values[key] for key in DELIVERY_KEYS
            if key != "CREATOR_TRACKER_INGEST_ENDPOINT_URL" and key in values
        },
    }
    seed = {
        "CREATOR_TRACKER_V2_DATABASE_URL": values["CREATOR_TRACKER_V2_DATABASE_URL"],
        "CREATOR_TRACKER_V2_DATABASE_CA_B64": ca_value,
        "CREATOR_TRACKER_CANONICAL_SEED_ORGANIZATION_ID": organizations[0],
    }
    return delivery, seed


def validate_raw_verifier(values: dict[str, str]) -> None:
    reject_injection(values)
    unknown = set(values) - set(RAW_VERIFIER_KEYS)
    if unknown:
        fail(f"unknown raw verifier key is forbidden: {sorted(unknown)[0]}")
    required = {
        "CREATOR_TRACKER_RAW_VERIFIER_DATABASE_URL",
        "CREATOR_TRACKER_RAW_VERIFIER_ORGANIZATION_ID",
        "CREATOR_TRACKER_RAW_VERIFIER_INSTANCE_ID",
        "CREATOR_TRACKER_RAW_EVIDENCE_ROOT",
        "CREATOR_TRACKER_RAW_EVIDENCE_OWNER_UID",
        "CREATOR_TRACKER_RAW_VERIFIER_ARCHIVE_ROOT",
    }
    missing = sorted(key for key in required if not values.get(key))
    if missing:
        fail(f"raw verifier key is required: {missing[0]}")
    database_url = urlsplit(values["CREATOR_TRACKER_RAW_VERIFIER_DATABASE_URL"])
    if (
        database_url.scheme not in {"postgres", "postgresql"}
        or not database_url.hostname
        or database_url.fragment
    ):
        fail("raw verifier database URL must be PostgreSQL")
    for key in (
        "CREATOR_TRACKER_RAW_VERIFIER_ORGANIZATION_ID",
        "CREATOR_TRACKER_RAW_VERIFIER_INSTANCE_ID",
    ):
        if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", values[key]) is None:
            fail(f"raw verifier identifier is invalid: {key}")
    if values["CREATOR_TRACKER_RAW_EVIDENCE_ROOT"] != "/var/lib/creator-tracker/raw-evidence-v1":
        fail("raw verifier source root is not pinned")
    if values["CREATOR_TRACKER_RAW_VERIFIER_ARCHIVE_ROOT"] != "/var/lib/creator-tracker/verified-raw-evidence-v1":
        fail("raw verifier archive root is not pinned")
    owner_uid = values["CREATOR_TRACKER_RAW_EVIDENCE_OWNER_UID"]
    if not owner_uid.isdigit() or not 1 <= int(owner_uid) <= 2**31 - 1:
        fail("raw evidence owner UID is invalid")
    try:
        writer_uid = pwd.getpwnam("creator-tracker-writer").pw_uid
    except KeyError:
        fail("creator tracker writer identity is unavailable")
    if int(owner_uid) != writer_uid:
        fail("raw evidence owner UID does not match the writer identity")
    certificate = values.get("CREATOR_TRACKER_RAW_VERIFIER_DATABASE_CA_B64")
    if certificate is not None:
        try:
            decoded = base64.b64decode(certificate, validate=True)
        except ValueError:
            fail("raw verifier database CA is not strict base64")
        if not 1 <= len(decoded) <= 1024 * 1024:
            fail("raw verifier database CA has an invalid length")
    for key, minimum, maximum in (
        ("CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_AFTER_SECONDS", 60, 31_536_000),
        ("CREATOR_TRACKER_RAW_VERIFIER_MANIFEST_LIMIT", 1, 500),
        ("CREATOR_TRACKER_RAW_VERIFIER_SCHEDULE_INTERVAL_SECONDS", 60, 3_600),
        ("CREATOR_TRACKER_RAW_VERIFIER_NEW_MANIFEST_SLA_SECONDS", 60, 86_400),
        ("CREATOR_TRACKER_RAW_VERIFIER_EXPECTED_NEW_MANIFESTS_PER_DAY", 1, 100_000),
        ("CREATOR_TRACKER_RAW_VERIFIER_RETENTION_DAYS", 1, 3_650),
        ("CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_SLA_SECONDS", 300, 604_800),
        ("CREATOR_TRACKER_RAW_VERIFIER_MIN_READ_BYTES_PER_SECOND", 1_048_576, 1_073_741_824),
        ("CREATOR_TRACKER_RAW_VERIFIER_PER_OBJECT_OVERHEAD_MS", 0, 1_000),
        ("CREATOR_TRACKER_RAW_VERIFIER_MAX_TICK_SECONDS", 1, 299),
    ):
        if key in values and (
            not values[key].isdigit() or not minimum <= int(values[key]) <= maximum
        ):
            fail(f"raw verifier limit is invalid: {key}")
    schedule_interval = int(values.get(
        "CREATOR_TRACKER_RAW_VERIFIER_SCHEDULE_INTERVAL_SECONDS", "300"
    ))
    max_tick = int(values.get("CREATOR_TRACKER_RAW_VERIFIER_MAX_TICK_SECONDS", "240"))
    if schedule_interval != 300:
        fail("raw verifier schedule interval must match the sealed five-minute timer")
    if max_tick >= schedule_interval:
        fail("raw verifier max tick must be shorter than its schedule interval")


def render(
    owner_path: str,
    provider_path: str,
    host_path: str,
    canonical_path: str,
    raw_verifier_path: str,
    output_path: str,
) -> None:
    if os.geteuid() != 0:
        fail("renderer must run as root")
    output = Path(output_path)
    if not output.is_absolute() or output.parent == output:
        fail("output path must be absolute")
    output.mkdir(mode=0o700)
    opened = output.stat(follow_symlinks=False)
    if not stat.S_ISDIR(opened.st_mode) or opened.st_uid != 0 or stat.S_IMODE(opened.st_mode) != 0o700:
        fail("output must be a new root-owned mode 0700 directory")
    credentials = output / "credentials"
    runtime = output / "runtime"
    credentials.mkdir(mode=0o700)
    runtime.mkdir(mode=0o700)

    owner = parse_env(read_private(owner_path))
    reject_injection(owner)
    unknown = set(owner) - RECOGNIZED_KEYS
    if unknown:
        fail(f"unknown owner key is forbidden: {sorted(unknown)[0]}")
    if owner.get("GOTALL_SHADOW_MODE", "1") != "1":
        fail("GOTALL_SHADOW_MODE must be exactly 1")
    if owner.get("VIRAL_DB_PATH", NEW_DATABASE) not in {
        NEW_DATABASE, LEGACY_DATABASE, "./data/gotall-viral.db"
    }:
        fail("VIRAL_DB_PATH does not match the pinned database transition")
    if owner.get("SCRAPECREATORS_API_KEY_CONFIGURED", "1") != "1":
        fail("SCRAPECREATORS_API_KEY_CONFIGURED must be exactly 1")
    if set(owner) & set(DELIVERY_KEYS):
        fail("canonical delivery credentials belong only in the dedicated input")
    canonical_input = parse_env(read_private(canonical_path))
    canonical, canonical_seed = canonical_role_values(canonical_input)
    for role in ROLE_KEYS:
        if role == "canonical-delivery":
            values = canonical
        elif role == "provider-reconcile":
            values = {
                "CREATOR_TRACKER_PROVIDER_ORGANIZATION_ID":
                    canonical_seed["CREATOR_TRACKER_CANONICAL_SEED_ORGANIZATION_ID"],
            }
        else:
            values = role_values(owner, role)
        write_new(credentials / f"{role}.env", dotenv(values))
    write_new(credentials / "canonical-seed.env", dotenv(canonical_seed))
    raw_verifier = parse_env(read_private(raw_verifier_path))
    for key, value in RAW_VERIFIER_DEFAULTS.items():
        raw_verifier.setdefault(key, value)
    validate_raw_verifier(raw_verifier)
    write_new(credentials / "raw-verifier.env", dotenv(raw_verifier))
    write_new(credentials / "cutover-verify.env", dotenv(raw_verifier))

    provider = parse_env(read_private(provider_path))
    reject_injection(provider)
    unknown = set(provider) - PROVIDER_SOURCE_KEYS
    if unknown:
        fail(f"unknown provider key is forbidden: {sorted(unknown)[0]}")
    api_key = provider.get("VIRAL_APP_API_KEY", "")
    base_url = provider.get("VIRAL_APP_BASE_URL", "")
    if not api_key or len(api_key) > 4096 or any(char in api_key for char in "\r\n\0"):
        fail("provider API key is missing or invalid")
    if base_url not in {"https://api.viral.app/", "https://viral.app/api/v1/"}:
        fail("provider base URL is not pinned")
    write_new(credentials / "provider-source.env", dotenv({
        "VIRAL_APP_API_KEY": api_key,
        "VIRAL_APP_BASE_URL": base_url,
    }))

    host = parse_env(read_private(host_path))
    reject_injection(host)
    unknown = set(host) - HOST_KEYS
    if unknown:
        fail(f"unknown host key is forbidden: {sorted(unknown)[0]}")
    for key in host:
        if re.search(r"(?:TOKEN|PASSWORD|API_KEY|SECRET)", key):
            fail(f"credential value is forbidden in host runtime input: {key}")
    heartbeat = host.get("CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS")
    if heartbeat is not None and (not heartbeat.isdigit() or not 5 <= int(heartbeat) <= 300):
        fail("heartbeat interval must be 5..300 seconds")
    storage_floor = host.get("CREATOR_TRACKER_STORAGE_MIN_FREE_BYTES")
    if storage_floor is not None and (
        not storage_floor.isdigit()
        or not 1024 ** 3 <= int(storage_floor) <= 1024 ** 5
    ):
        fail("storage free-byte floor must be 1 GiB..1 PiB")
    common = {} if heartbeat is None else {"CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS": heartbeat}
    for job in (
        "collector-worker", "roster-refresh", "scheduler-tick", "instagram-discovery",
        "instagram-scheduler", "instagram-credit-rearm", "provider-reconcile", "canonical-delivery",
        "raw-verifier",
    ):
        write_new(runtime / f"{job}.env", dotenv(common))
    health = {key: host[key] for key in HEALTH_RUNTIME_KEYS if key in host}
    write_new(runtime / "dashboard-health.env", dotenv(health))
    fsync_directory(credentials)
    fsync_directory(runtime)


def main() -> None:
    if len(sys.argv) != 7:
        fail("usage: render-collector-config.py OWNER_ENV PROVIDER_ENV HOST_ENV CANONICAL_ENV RAW_VERIFIER_ENV OUTPUT_DIR")
    render(*sys.argv[1:])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # fail closed without values from the private inputs
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
