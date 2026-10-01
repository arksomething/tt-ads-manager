import unittest
from unittest.mock import patch
from pathlib import Path
import knowledge


class ConversionSkillTests(unittest.TestCase):
    def test_skill_is_loaded_for_both_audiences(self):
        original = Path.read_text
        def read(path, *args, **kwargs):
            if path.name == 'SKILL.md':
                return 'conversion-skill-runtime-sentinel'
            return original(path, *args, **kwargs)
        with patch.object(Path, 'read_text', read):
            for operator in (False, True):
                self.assertIn('conversion-skill-runtime-sentinel',
                              knowledge.business_context(operator))
