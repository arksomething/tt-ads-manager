"""One authenticated, tool-free model probe for deployment verification."""
import asyncio
import json
import support


async def check():
    health=support.auth_health()
    if health['status']=='unavailable':
        return {**health,'model_verified':False}
    support.codex.get_codex_token=support.read_codex_session
    try:
        result=await asyncio.wait_for(support.BudgetProvider().chat(
            messages=[{'role':'user','content':'Reply with exactly OK.'}],
            model=support.MODEL,reasoning_effort='low'),timeout=45)
        verified=result.finish_reason!='error' and (result.content or '').strip()=='OK'
        decisions=[]
        for text in ['Unable to push talking videos until my exam is over','Can I get my pay?']:
            decisions.append(await support.triage.classify(support.BudgetProvider(),support.MODEL,
                {'id':'1','author':'creator','text':text},[]))
        triage_verified=(decisions[0]['action']=='ignore' and decisions[1]['action'] in {'answer','investigate'}
                         and not any(d.get('usage',{}).get('failed') for d in decisions))
        return {**health,'model_verified':verified,'triage_verified':triage_verified}
    except Exception:
        return {**health,'model_verified':False}


if __name__=='__main__':
    support.logger.remove()
    result=asyncio.run(check())
    print(json.dumps(result))
    raise SystemExit(0 if result['model_verified'] and result.get('triage_verified') else 1)
