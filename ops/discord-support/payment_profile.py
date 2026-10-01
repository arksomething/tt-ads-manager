"""Creator-bound payment details; passed directly to Michael, never into AI output."""
import asyncio
import json
import re
import uuid


async def saved_profile(guild, channel, user):
    if str(guild)!='1245112089647775877':return None
    code="""import sqlite3,sys,json
c=sqlite3.connect('file:/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3?mode=ro',uri=True)
r=c.execute('SELECT payment_details FROM creators WHERE discord_user_id=? AND channel_id=?',(sys.argv[1],sys.argv[2])).fetchone()
print(r[0] if r and r[0] else 'null')
"""
    proc=await asyncio.create_subprocess_exec('systemd-run','--user','--wait','--pipe','--quiet','--collect',
        '--unit=gotall-payment-profile-'+uuid.uuid4().hex,'--property=RuntimeMaxSec=15',
        'sudo','-n','/usr/bin/python3','-c',code,str(user),str(channel),
        stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    output,_=await proc.communicate()
    if proc.returncode:return None
    return json.loads(output)


def format_profile(profile):
    if not isinstance(profile,dict):raise ValueError('Payment details are missing')
    method={'paypal':'PayPal','wise':'Wise','bank':'Bank transfer'}.get(profile.get('method'))
    if not method:raise ValueError('Payment method is missing')
    fields=['recipient','country','currency','bank','destination']
    if not profile.get('destination'):raise ValueError('Receiving details are missing')
    lines=[f'Method: {method}']
    lines += [f'{key.replace("_"," ").title()}: {str(profile[key])[:1000]}' for key in fields if profile.get(key)]
    if len(lines)==1:raise ValueError('Receiving details are missing')
    return '\n'.join(lines)


def profile_from_message(message):
    text=message.get('content','')
    if re.search(r'paypal',text,re.I):
        emails=re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',text)
        if len(emails)!=1:raise ValueError('A single clearly identified PayPal email is required')
        return {'method':'paypal','destination':emails[0]}
    method='wise' if re.search(r'\bwise\b',text,re.I) else 'bank' if re.search(r'\b(bank|iban|swift|routing)\b',text,re.I) else None
    if not method:raise ValueError('Ask the creator to identify their payment method')
    if len(text)>1000:raise ValueError('Ask for a concise message containing only receiving details')
    return {'method':method,'destination':text}
