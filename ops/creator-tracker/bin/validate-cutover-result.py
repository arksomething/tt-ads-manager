#!/usr/bin/python3 -I
"""Validate the one-line sealed cutover result before root records success."""

from __future__ import annotations

import json
import re
import sys


UUID_V4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
EVENT = "creator_tracker_provider_cutover_completeness_v1"
TOP_LEVEL_KEYS = {
    "event", "status", "reason", "selectedBy", "captureSetId",
    "producerRunId", "organizationId", "frozenCreatedAtMs",
    "frozenFirstOutboxId", "frozenLastOutboxId",
    "deliveryPending", "rawAttestationPending", "centralChecked",
    "outbox", "receipts", "projection", "producerRuns", "manifests",
}
MAX_SAFE_INTEGER = 9_007_199_254_740_991
PROJECTION_KEYS = (
    "sourceRows", "creators", "accounts", "videos", "observations",
    "cadenceSuppressed",
)


def fail(message: str) -> "None":
    raise RuntimeError(f"creator-tracker cutover result: {message}")


def exact_record(value: object, keys: set[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(f"{label} fields are not exact")
    return value


def integer(value: object, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= MAX_SAFE_INTEGER
    ):
        fail(f"{label} is not a nonnegative safe integer")
    return value


def nullable_integer(value: object, label: str) -> int | None:
    return None if value is None else integer(value, label)


def parse(payload: bytes) -> tuple[
    str, str, str, str, bool, bool, int, int, int, str,
]:
    if not payload or len(payload) > 65_536 or b"\x00" in payload:
        fail("output is empty, oversized, or contains NUL")
    if payload.count(b"\n") > 1 or (b"\n" in payload and not payload.endswith(b"\n")):
        fail("output must contain exactly one JSON line")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("output is not strict UTF-8 JSON")
    result = exact_record(value, TOP_LEVEL_KEYS, "top-level")
    if (
        result["event"] != EVENT
        or result["status"] not in {"pending", "complete"}
        or result["selectedBy"] not in {"latest", "producer_run_id"}
        or not isinstance(result["producerRunId"], str)
        or UUID_V4.fullmatch(result["producerRunId"]) is None
        or not isinstance(result["captureSetId"], str)
        or SHA256.fullmatch(result["captureSetId"]) is None
        or not isinstance(result["organizationId"], str)
        or not 1 <= len(result["organizationId"]) <= 256
        or any(character in result["organizationId"] for character in "\r\n\x00")
        or not isinstance(result["deliveryPending"], bool)
        or not isinstance(result["rawAttestationPending"], bool)
        or not isinstance(result["centralChecked"], bool)
    ):
        fail("result identity or state is invalid")
    integer(result["frozenCreatedAtMs"], "frozenCreatedAtMs")
    first_outbox_id = integer(result["frozenFirstOutboxId"], "frozenFirstOutboxId")
    last_outbox_id = integer(result["frozenLastOutboxId"], "frozenLastOutboxId")
    if first_outbox_id < 1 or last_outbox_id < first_outbox_id:
        fail("frozen outbox boundary is invalid")

    outbox = exact_record(
        result["outbox"], {"expected", "delivered", "pending", "leased", "retry"},
        "outbox",
    )
    receipts = exact_record(result["receipts"], {"expected", "matched"}, "receipts")
    projection = exact_record(result["projection"], set(PROJECTION_KEYS), "projection")
    projection_counts: list[int] = []
    for projection_key in PROJECTION_KEYS:
        pair = exact_record(
            projection[projection_key], {"expected", "matched"},
            f"projection.{projection_key}",
        )
        projection_expected = integer(
            pair["expected"], f"projection.{projection_key}.expected",
        )
        projection_matched = integer(
            pair["matched"], f"projection.{projection_key}.matched",
        )
        if projection_expected != projection_matched:
            fail(f"projection.{projection_key} does not reconcile")
        projection_counts.append(projection_expected)
    producer_runs = exact_record(
        result["producerRuns"], {"expected", "localMatched", "centralMatched"},
        "producerRuns",
    )
    manifests = exact_record(
        result["manifests"],
        {
            "expected", "localCatalogMatched", "sourceCasMatched", "centralMatched",
            "aggregateAttested", "archiveCasMatched",
        },
        "manifests",
    )
    expected = integer(outbox["expected"], "outbox.expected")
    if expected < 2:
        fail("capture set is too small")
    if last_outbox_id - first_outbox_id + 1 < expected:
        fail("frozen outbox boundary cannot contain the capture set")
    delivered = integer(outbox["delivered"], "outbox.delivered")
    pending = integer(outbox["pending"], "outbox.pending")
    leased = integer(outbox["leased"], "outbox.leased")
    retry = integer(outbox["retry"], "outbox.retry")
    receipt_expected = integer(receipts["expected"], "receipts.expected")
    receipt_matched = integer(receipts["matched"], "receipts.matched")
    run_expected = integer(producer_runs["expected"], "producerRuns.expected")
    run_local = integer(producer_runs["localMatched"], "producerRuns.localMatched")
    run_central = nullable_integer(producer_runs["centralMatched"], "producerRuns.centralMatched")
    manifest_expected = integer(manifests["expected"], "manifests.expected")
    manifest_local = integer(manifests["localCatalogMatched"], "manifests.localCatalogMatched")
    manifest_source = integer(manifests["sourceCasMatched"], "manifests.sourceCasMatched")
    manifest_central = nullable_integer(manifests["centralMatched"], "manifests.centralMatched")
    aggregate = nullable_integer(manifests["aggregateAttested"], "manifests.aggregateAttested")
    archive = nullable_integer(manifests["archiveCasMatched"], "manifests.archiveCasMatched")
    if (
        delivered + pending + leased != expected
        or retry > pending + leased
        or receipt_expected != expected
        or receipt_matched != delivered
        or run_expected != expected
        or run_local != expected
        or manifest_expected != expected
        or manifest_local != expected
        or manifest_source != expected
    ):
        fail("local capture-set counts do not reconcile")

    status = str(result["status"])
    delivery_pending = bool(result["deliveryPending"])
    raw_pending = bool(result["rawAttestationPending"])
    if status == "complete":
        if (
            result["reason"] != "COMPLETE"
            or delivery_pending
            or raw_pending
            or result["centralChecked"] is not True
            or delivered != expected
            or pending != 0
            or leased != 0
            or retry != 0
            or run_central != expected
            or manifest_central != expected
            or aggregate != expected
            or archive != expected
        ):
            fail("complete result does not prove exact delivery and attestation")
    elif delivery_pending:
        if (
            result["reason"] != "LOCAL_DELIVERY_PENDING"
            or raw_pending
            or result["centralChecked"] is not False
            or delivered >= expected
            or run_central is not None
            or manifest_central is not None
            or aggregate is not None
            or archive is not None
        ):
            fail("delivery-pending result is internally inconsistent")
    elif raw_pending:
        if (
            result["reason"] != "RAW_ATTESTATION_PENDING"
            or result["centralChecked"] is not True
            or delivered != expected
            or pending != 0
            or leased != 0
            or retry != 0
            or run_central != expected
            or manifest_central != expected
            or aggregate is None
            or not 0 <= aggregate < expected
            or archive is not None
        ):
            fail("raw-attestation-pending result is internally inconsistent")
    else:
        fail("pending result does not identify the queue that must advance")

    return (
        status,
        str(result["selectedBy"]),
        str(result["producerRunId"]),
        str(result["captureSetId"]),
        delivery_pending,
        raw_pending,
        expected,
        first_outbox_id,
        last_outbox_id,
        ":".join(str(count) for count in projection_counts),
    )


def main() -> None:
    parsed = parse(sys.stdin.buffer.read(65_537))
    print("\t".join(
        [parsed[0], parsed[1], parsed[2], parsed[3],
         "1" if parsed[4] else "0", "1" if parsed[5] else "0",
         str(parsed[6]), str(parsed[7]), str(parsed[8]), parsed[9]],
    ))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
