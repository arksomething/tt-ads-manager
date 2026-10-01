"""Curated business guidance; raw transcripts are never loaded into agent context."""
from pathlib import Path

ROOT = Path(__file__).with_name('knowledge')
SHARED = ('team-and-service.md', 'program.md', 'payment-evidence.md')


def business_context(operator=False):
    names = SHARED + (('operator-history.md',) if operator else ())
    context = '\n\n'.join((ROOT / name).read_text() for name in names)
    skill = ROOT.parent / 'skills' / 'creator-conversion' / 'SKILL.md'
    return context + '\n\n' + skill.read_text()
