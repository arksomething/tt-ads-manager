import tempfile
import unittest
from pathlib import Path

import diagnostics


class RepositoryViewTests(unittest.TestCase):
    def test_source_tree_excludes_private_artifacts_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'repo'
            paths=['ops/creator-tracker/worker.py','creator-platform/src/tracking.ts',
                   'web/src/app.tsx','tools/check.sh','supabase/schema.sql','README.md',
                   '.env','web/.env.local','reports/private.md','payouts/details.py',
                   'ops/data/private.py','web/node_modules/vendor/index.js',
                   'ops/fixtures/creator.ts','ops/private.json','ops/state.sqlite3',
                   '.git/history.py']
            for name in paths:
                file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('safe source')
            (root/'web/src/leak.py').symlink_to(root/'.env')
            (root/'tools/linked').symlink_to(root/'payouts',target_is_directory=True)
            actual={str(p.relative_to(root)) for p in diagnostics.source_files(root)}
            self.assertEqual(actual,set(paths[:6]))
            snapshot=Path(directory)/'snapshot'
            diagnostics.snapshot_source(root,snapshot)
            self.assertEqual((snapshot/'ops/creator-tracker/worker.py').read_text(),'safe source')
            self.assertFalse((snapshot/'web/src/leak.py').exists())
