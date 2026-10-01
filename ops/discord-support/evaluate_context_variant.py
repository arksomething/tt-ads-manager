"""Run the frozen suite against a staged handbook without altering production files."""
import asyncio,hashlib,json,sys
from pathlib import Path
from unittest.mock import patch
import knowledge
import evaluate_context_search as suite

async def main():
 index=sys.argv.index('--knowledge-dir')
 root=Path(sys.argv[index+1]);del sys.argv[index:index+2]
 def business_context(operator=False):
  names=knowledge.SHARED+(('operator-history.md',) if operator else ())
  return '\n\n'.join((root/name).read_text() for name in names)+'\n\n'+(knowledge.ROOT.parent/'skills/creator-conversion/SKILL.md').read_text()
 with patch.object(knowledge,'business_context',business_context):await suite.main()
 destination=Path(sys.argv[sys.argv.index('--output')+1]);data=json.loads(destination.read_text())
 data['handbook_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.md')}
 destination.write_text(json.dumps(data,indent=2))
if __name__=='__main__':asyncio.run(main())
