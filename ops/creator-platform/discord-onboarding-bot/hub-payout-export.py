"""Read recorded transfers from the legacy GoTall dashboard; never initiate payments.
Executed as the existing application owner. No credentials enter the bot process.
"""
import json,os,re,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote

def export(configs):
    root=Path('/home/ark296/projects/tt-ads-manager/web');values={}
    for filename in ['.env','.env.local']:
        for line in (root/filename).read_text().splitlines():
            m=re.match(r'(?:export\s+)?([A-Z_]+)=(.*)',line.strip())
            if m:values[m[1]]=m[2].strip().strip('"').strip("'")
    u=urlparse(values['DATABASE_URL']);env=os.environ.copy()
    env.update({'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':unquote(u.username or ''),'PGPASSWORD':unquote(u.password or ''),'PGDATABASE':u.path.lstrip('/'),'PGSSLMODE':parse_qs(u.query).get('sslmode',['require'])[0],'PGCONNECT_TIMEOUT':'10','PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=15000'})
    bindings=json.loads(Path('/etc/gotall-discord-deal-bindings.json').read_text())
    wanted=[{'owner':c['creator_id'],**bindings[c['creator_id']]} for c in configs if c['creator_id'] in bindings]
    literal=json.dumps(wanted).replace("'","''")
    query=f'''WITH wanted AS (SELECT value FROM jsonb_array_elements('{literal}'::jsonb)),
    matched AS (
      SELECT w.value->>'owner' owner,cc."creatorId" creator_id,cc.id campaign_creator_id,c."organizationId" organization_id,c.id campaign_id
      FROM wanted w JOIN "CampaignCreator" cc ON cc.id=w.value->>'campaign_creator_id'
      JOIN "Campaign" c ON c.id=cc."campaignId" AND c."organizationId"=w.value->>'organization_id'
      JOIN "Organization" o ON o.id=c."organizationId" AND o.slug='gotall'
    ) SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) FROM (
      SELECT m.owner creator_id,p.id,round(p.amount*100)::bigint amount_cents,p.currency,p.status::text status,
      p."payoutDate" payout_date,p."updatedAt" updated_at,p."paymentMethod" payment_method
      FROM matched m JOIN "Payout" p ON p."organizationId"=m.organization_id AND
        (p."campaignCreatorId"=m.campaign_creator_id OR (p."campaignCreatorId" IS NULL AND p."creatorId"=m.creator_id AND (p."campaignId" IS NULL OR p."campaignId"=m.campaign_id)))
      ORDER BY p."updatedAt" DESC LIMIT 1000
    ) t;'''
    prefix=query[:query.index(' SELECT COALESCE')]
    deals_query=prefix+''' SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) FROM (
      SELECT m.owner creator_id,d.* FROM matched m
      JOIN "CampaignCreator" cc ON cc.id=m.campaign_creator_id
      JOIN "CampaignCreatorDeal" d ON d."campaignCreatorId"=cc.id
      WHERE d."organizationId"=m.organization_id ORDER BY d."effectiveStartDate" DESC LIMIT 1000
    ) t;'''
    history_query=prefix+''' SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json) FROM (
      SELECT m.owner creator_id,v.* FROM matched m
      JOIN "CampaignCreator" cc ON cc.id=m.campaign_creator_id
      JOIN "CreatorDealVersion" v ON v."campaignCreatorId"=cc.id
      ORDER BY v."createdAt" DESC LIMIT 2000
    ) t;'''
    query=query+'\n'+deals_query+'\n'+history_query
    r=subprocess.run(['/usr/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],input=query,text=True,env=env,capture_output=True,timeout=25)
    if r.returncode:raise RuntimeError('Legacy payout read failed; previous payment cache retained.')
    lines=r.stdout.strip().splitlines()
    return {'owners':[c['creator_id'] for c in configs],'records':json.loads(lines[0]),'deals':json.loads(lines[1]),'history':json.loads(lines[2])}

if __name__=='__main__':print(json.dumps(export(json.load(sys.stdin))))
