"""Tool-free automatic routing. Decisions are durable; uncertainty stays silent."""
import asyncio
import json
import time
from pathlib import Path

DEBOUNCE_SECONDS = 2
DAILY_LIMIT = 600
USER_HOURLY_LIMIT = 60
ACTIONS = {'ignore', 'answer', 'investigate'}


def candidate(message, cfg, owner_id):
    if message.channel.id in {int(cfg.get('review_channel') or 0), int(cfg.get('admin_commands_channel') or 0)}:
        return False
    if (str(message.author.id) in {str(owner_id),str(cfg.get('owner'))}
            or getattr(getattr(message.author,'guild_permissions',None),'administrator',False)
            or any(str(r.id) in cfg.get('staff_roles', []) for r in getattr(message.author, 'roles', []))):
        return False
    # Explicit bot mentions/replies have already been handled by the dispatcher.
    if message.reference:
        return False
    # A staff mention must not suppress a routine support question. Keep mentions
    # of other creators outside automatic support; classification handles intent.
    staff_roles=set(map(str,cfg.get('staff_roles',[])))
    for member in message.mentions:
        if (str(member.id) not in {str(owner_id),str(cfg.get('owner'))}
                and not any(str(role.id) in staff_roles for role in getattr(member,'roles',[]))):
            return False
    content = message.content.strip()
    return bool((content or getattr(message,'attachments',[])) and not content.startswith(('!', '/', '>', '```')))


def reserve(db, message, now=None):
    now = time.time() if now is None else now
    if db.execute('SELECT 1 FROM triage_decisions WHERE id=?', (str(message.id),)).fetchone():
        return False
    total = db.execute('SELECT count(*) FROM triage_decisions WHERE created>?', (now-86400,)).fetchone()[0]
    user = db.execute('SELECT count(*) FROM triage_decisions WHERE author=? AND created>?', (str(message.author.id),now-3600)).fetchone()[0]
    if total >= DAILY_LIMIT or user >= USER_HOURLY_LIMIT:
        return False
    db.execute('INSERT INTO triage_decisions VALUES (?,?,?,?,?,?,?,?)',
               (str(message.id),str(message.guild.id),str(message.channel.id),str(message.author.id),now,'pending','', '{}'))
    db.commit()
    return True


def record(db, mid, decision):
    db.execute('UPDATE triage_decisions SET action=?,reason=?,usage=? WHERE id=?',
               (decision['action'],decision.get('reason','')[:240],json.dumps(decision.get('usage',{})),str(mid)))
    db.commit()


async def classify(provider, model, current, recent):
    """One bounded model call. Malformed/error responses never start the agent."""
    try:
        result = await asyncio.wait_for(provider.chat(
            messages=[{'role':'system','content':Path(__file__).with_name('triage-policy.md').read_text()},
                      {'role':'user','content':json.dumps({'earlier_messages':recent,'latest_message_to_classify':current},ensure_ascii=False)}],
            model=model, tools=None, max_tokens=600, reasoning_effort='medium'), timeout=25)
        if result.finish_reason == 'error' or getattr(result,'tool_calls',None):
            raise ValueError('Invalid classifier completion')
        decision = json.loads(result.content or '')
        if not isinstance(decision,dict) or decision.get('action') not in ACTIONS or not isinstance(decision.get('reason'),str):
            raise ValueError('Invalid classifier decision')
        return {'action':decision['action'],'reason':decision['reason'][:240],'usage':result.usage or {}}
    except Exception as error:
        return {'action':'ignore','reason':'triage_unavailable','usage':{'failed':True,'failure_kind':type(error).__name__}}
