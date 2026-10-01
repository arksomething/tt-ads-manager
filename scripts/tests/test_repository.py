import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("repository", Path(__file__).parents[1] / "check-repository.py")
repository = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repository)


class RepositoryHygieneTests(unittest.TestCase):
    def test_runtime_files_are_rejected_at_any_app_depth(self):
        for name in ("web/.env.production", "creator-platform/.env.local", "tools/.venv/lib/a.py",
                     "creator-platform/.next/build.js", "ops/private/key.json", "payouts/creator.pdf",
                     "ops/discord-admin-audits/offboarding.json", "ops/discord-support/verification.json"):
            with self.subTest(name=name):
                self.assertTrue(repository.violations(name, b"harmless contents"))

    def test_examples_source_and_synthetic_fixtures_are_allowed(self):
        for name in ("web/.env.example", "tools/.env.test.example", "web/src/app/page.tsx",
                     "ops/discord-support/fixtures/conversations.json", "ops/creator-tracker/creator-tracker.env.example"):
            with self.subTest(name=name):
                self.assertEqual(repository.violations(name, b"placeholder"), [])

    def test_credentials_are_rejected_even_in_ordinary_source(self):
        for content in (b"ghp_" + b"A" * 36, b"sk-proj-" + b"A" * 40,
                        b"-----BEGIN " + b"PRIVATE KEY-----"):
            self.assertTrue(repository.violations("web/src/config.ts", content))


if __name__ == "__main__":
    unittest.main()
