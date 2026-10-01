"""Exercise the existing production publication function inside a rolled-back transaction."""
import importlib.util,json,uuid
from pathlib import Path
import operations

spec=importlib.util.spec_from_file_location('shared_deals',operations.REPO/'ops/creator-platform/discord-onboarding-bot/shared-deal-worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
bindings=json.loads((operations.STATE/'verified-creator-bindings.json').read_text())
account=next(iter(next(iter(bindings.values())).values()))['accounts'][0]
where='"organizationId"='+worker.quote(account['organization_id'])+' AND "campaignCreatorId"='+worker.quote(account['campaign_creator_id'])
snapshot='SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,\'[]\')) FROM public."CampaignCreatorDeal" d WHERE '+where+';'
before=worker.query(snapshot)
assert before.returncode==0
selected=worker.query('SELECT row_to_json(d) FROM public."CampaignCreatorDeal" d WHERE '+where+' AND "effectiveStartDate"<=CURRENT_DATE AND coalesce("effectiveEndDate",\'infinity\'::timestamp)>=CURRENT_DATE ORDER BY "effectiveStartDate" DESC LIMIT 1;')
assert selected.returncode==0 and selected.stdout.strip()
d=json.loads(selected.stdout)
args=[uuid.uuid4().hex,account['organization_id'],account['campaign_creator_id'],d['id'],d['dealVersionId'],'verification:rollback-only']
sql='BEGIN; SELECT public.gotall_publish_creator_deal('+','.join(worker.quote(v) for v in args)+",jsonb_build_object('effectiveStartDate',CURRENT_DATE::text)); ROLLBACK;"
result=worker.query(sql)
after=worker.query(snapshot)
assert result.returncode==0,'Publication verification rejected; transaction was not committed'
assert after.returncode==0 and before.stdout==after.stdout,'Readback differs'
print('PASS: live deal publication accepted; rolled back; creator terms unchanged.')
