#!/usr/bin/python3
"""Validate a Codex incident result against the managed JSON Schema subset."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


class ValidationError(ValueError):
    pass


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    raise ValidationError(f"unsupported schema type: {expected}")


def validate(value: Any, schema: dict[str, Any], location: str = "$") -> None:
    expected_type = schema.get("type")
    if expected_type is not None:
        if not isinstance(expected_type, str) or not _matches_type(value, expected_type):
            raise ValidationError(f"{location}: expected {expected_type}")

    enum = schema.get("enum")
    if enum is not None and value not in enum:
        raise ValidationError(f"{location}: value is not in enum")

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        if not isinstance(properties, dict) or not isinstance(required, list):
            raise ValidationError(f"{location}: malformed object schema")
        missing = [name for name in required if name not in value]
        if missing:
            raise ValidationError(f"{location}: missing required properties: {missing}")
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                raise ValidationError(f"{location}: unexpected properties: {extra}")
        for name, child in value.items():
            child_schema = properties.get(name)
            if child_schema is not None:
                if not isinstance(child_schema, dict):
                    raise ValidationError(f"{location}.{name}: malformed property schema")
                validate(child, child_schema, f"{location}.{name}")

    if isinstance(value, list) and "items" in schema:
        item_schema = schema["items"]
        if not isinstance(item_schema, dict):
            raise ValidationError(f"{location}: malformed item schema")
        for index, child in enumerate(value):
            validate(child, item_schema, f"{location}[{index}]")


def validate_files(schema_path: Path, result_path: Path) -> None:
    with schema_path.open(encoding="utf-8") as handle:
        schema = json.load(handle)
    with result_path.open(encoding="utf-8") as handle:
        result = json.load(handle)
    if not isinstance(schema, dict):
        raise ValidationError("$: schema must be an object")
    validate(result, schema)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} SCHEMA RESULT", file=sys.stderr)
        return 2
    try:
        validate_files(Path(argv[1]), Path(argv[2]))
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        print(f"invalid Codex incident result: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
