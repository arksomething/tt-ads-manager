#!/usr/bin/python3

from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest

import sys

sys.dont_write_bytecode = True


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "validate_codex_result", ROOT / "bin" / "validate-codex-result.py"
)
assert SPEC is not None and SPEC.loader is not None
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def valid_result() -> dict[str, object]:
    return {
        "status": "no_action",
        "summary": "Nothing to change.",
        "root_cause": "The smoke incident is healthy.",
        "actions_taken": [],
        "verification": ["Inspected the sealed source."],
        "changed_files": [],
        "production_recommendation": "none",
    }


class ResultSchemaTests(unittest.TestCase):
    def validate(self, value: object) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_path = pathlib.Path(directory) / "result.json"
            result_path.write_text(json.dumps(value), encoding="utf-8")
            VALIDATOR.validate_files(ROOT / "result.schema.json", result_path)

    def test_accepts_complete_result(self) -> None:
        self.validate(valid_result())

    def test_rejects_missing_required_field(self) -> None:
        value = valid_result()
        del value["verification"]
        with self.assertRaises(VALIDATOR.ValidationError):
            self.validate(value)

    def test_rejects_wrong_array_type(self) -> None:
        value = valid_result()
        value["actions_taken"] = "none"
        with self.assertRaises(VALIDATOR.ValidationError):
            self.validate(value)

    def test_rejects_non_string_array_item(self) -> None:
        value = valid_result()
        value["verification"] = [False]
        with self.assertRaises(VALIDATOR.ValidationError):
            self.validate(value)

    def test_rejects_additional_property(self) -> None:
        value = valid_result()
        value["secret_extra"] = "unexpected"
        with self.assertRaises(VALIDATOR.ValidationError):
            self.validate(value)

    def test_rejects_invalid_enum(self) -> None:
        value = valid_result()
        value["production_recommendation"] = "deploy_now"
        with self.assertRaises(VALIDATOR.ValidationError):
            self.validate(value)


if __name__ == "__main__":
    unittest.main()
