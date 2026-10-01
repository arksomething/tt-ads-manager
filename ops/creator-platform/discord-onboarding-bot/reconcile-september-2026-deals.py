"""One-time, owner-authorized correction of already-announced September terms.

Default is a read-only plan. --apply PLAN executes the reviewed, version-checked
plan atomically; version triggers and publication receipts retain prior terms.
No Discord notifications, payouts, or provider requests are issued here.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import runpy
import uuid

ORG = 'org_public_tt_ads_manager'
CUTOFF = '2026-09-17T15:00:27.511Z'
ANNOUNCEMENT = 'https://discord.com/channels/1400610531189985310/1548980542991507506/1549797121111236619'
EXEMPT = 'a6c73f08-d272-4448-a461-e6d4393fc4f5'  # Tallvex, explicit unchanged deal.
SWITCHES = {
    '0a08d1b2-140e-4468-9fb4-db54b77a6a69': ('2026-09-17T03:03:37.011Z', '1510756993902706830/1549979109864640574'),
    '19a9ac51-c098-49da-985d-2f6baf8e20fc': ('2026-09-17T03:04:53.682Z', '1501163920948465734/1549979431446257770'),
}


def make_plan(rows):
    changes = []
    for row in rows:
        if row['creator_id'] == EXEMPT or row['isTalking'] or row['cpmAmount'] != .5:
            continue
        switch = SWITCHES.get(row['creator_id'])
        at = switch[0] if switch else CUTOFF
        assert dt.datetime.fromisoformat(row['effectiveStartDate']) < dt.datetime.fromisoformat(at.replace('Z', '+00:00'))
        assert row['fixedFee'] is None, 'A lump-sum fee needs separate recognition review before splitting'
        request = 'september-2026-policy-v1:' + row['campaignCreatorId']
        changes.append({
            'request_id': request, 'before': row,
            'new_id': str(uuid.uuid5(uuid.NAMESPACE_URL, request)),
            'effective_at': at,
            'prior_end': (dt.datetime.fromisoformat(at.replace('Z', '+00:00')) - dt.timedelta(milliseconds=1)).isoformat(),
            'cpm': 1 if switch else .2, 'cap': 300 if switch else 100,
            'switch_to_talking': bool(switch),
            'source': 'https://discord.com/channels/1400610531189985310/' + switch[1] if switch else ANNOUNCEMENT,
        })
    assert {x['before']['creator_id'] for x in changes if x['switch_to_talking']} == set(SWITCHES)
    assert len({x['before']['campaignCreatorId'] for x in changes}) == len(changes)
    return {'organization_id': ORG, 'changes': changes, 'preserved_exception': EXEMPT}


def apply_sql(plan):
    assert plan['organization_id'] == ORG
    literal = json.dumps(plan['changes']).replace("'", "''")
    return """BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL gotall.deal_actor='owner-authorized-september-2026-reconciliation';
DO $reconcile$
DECLARE change jsonb; previous public."CampaignCreatorDeal"; fresh public."CampaignCreatorDeal"; saved jsonb;
BEGIN
FOR change IN SELECT value FROM jsonb_array_elements('""" + literal + """'::jsonb) LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(change->'before'->>'campaignCreatorId',0));
  SELECT result INTO saved FROM "CreatorDealPublication" WHERE "requestId"=change->>'request_id';
  IF FOUND THEN
    IF saved->>'new_id' IS DISTINCT FROM change->>'new_id' THEN RAISE EXCEPTION 'Publication mismatch'; END IF;
    CONTINUE;
  END IF;
  SELECT * INTO STRICT previous FROM "CampaignCreatorDeal"
    WHERE id=change->'before'->>'id' AND "organizationId"='org_public_tt_ads_manager' FOR UPDATE;
  IF previous."dealVersionId" IS DISTINCT FROM change->'before'->>'dealVersionId' OR
     previous."campaignCreatorId" IS DISTINCT FROM change->'before'->>'campaignCreatorId' THEN
    RAISE EXCEPTION 'Deal changed since plan; regenerate the plan';
  END IF;
  IF EXISTS(SELECT 1 FROM "CampaignCreatorDeal" WHERE "campaignCreatorId"=previous."campaignCreatorId"
      AND id<>previous.id AND "effectiveStartDate">=(change->>'effective_at')::timestamptz) THEN
    RAISE EXCEPTION 'A newer scheduled deal requires reconciliation';
  END IF;
  fresh=previous;
  fresh.id=change->>'new_id';
  fresh."effectiveStartDate"=(change->>'effective_at')::timestamptz;
  fresh."cpmAmount"=(change->>'cpm')::numeric;
  fresh."payoutCapPerVideo"=(change->>'cap')::numeric;
  fresh."perVideoCapScope"='CPM';
  fresh."dealVersionId"=NULL;
  fresh."createdAt"=now(); fresh."updatedAt"=now();
  fresh.notes=concat_ws(E'\\n',previous.notes,
    'September 2026 reconciliation. Applies to posts from ' || (change->>'effective_at') ||
    '; earlier posts retain prior terms. Source: ' || (change->>'source'));
  UPDATE "CampaignCreatorDeal" SET "effectiveEndDate"=(change->>'prior_end')::timestamptz,"updatedAt"=now() WHERE id=previous.id;
  INSERT INTO "CampaignCreatorDeal" SELECT fresh.*;
  IF (change->>'switch_to_talking')::boolean THEN
    UPDATE "Creator" SET "isTalking"=true,"updatedAt"=now()
      WHERE id=change->'before'->>'creator_id' AND "organizationId"='org_public_tt_ads_manager' AND NOT "isTalking";
    IF NOT FOUND THEN RAISE EXCEPTION 'Creator classification changed since plan'; END IF;
  END IF;
  INSERT INTO "CreatorDealPublication"("requestId","organizationId","campaignCreatorId",result)
    VALUES(change->>'request_id','org_public_tt_ads_manager',previous."campaignCreatorId",
      jsonb_build_object('new_id',fresh.id,'before',to_jsonb(previous),'source',change->>'source','effective_at',change->>'effective_at'));
END LOOP;
END $reconcile$;
COMMIT;
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--apply', type=Path)
    args = parser.parse_args()
    worker = runpy.run_path(str(Path(__file__).with_name('shared-deal-worker.py')))
    if args.plan:
        sql = '''SET default_transaction_read_only=on;
        SELECT json_agg(t) FROM (SELECT cr.id creator_id,cr."displayName",cr."isTalking",d.*
        FROM "CampaignCreatorDeal" d JOIN "CampaignCreator" cc ON cc.id=d."campaignCreatorId"
        JOIN "Creator" cr ON cr.id=cc."creatorId"
        WHERE d."organizationId"='org_public_tt_ads_manager'
        AND (d."effectiveEndDate">='2026-09-17' OR d."effectiveEndDate" IS NULL))t;'''
        result = worker['query'](sql)
        if result.returncode: raise RuntimeError(result.stderr)
        plan = make_plan(json.loads(result.stdout))
        args.plan.write_text(json.dumps(plan, indent=2) + '\n');args.plan.chmod(0o600)
        print(json.dumps([{'name':x['before']['displayName'],'at':x['effective_at'],'cpm':x['cpm'],'cap':x['cap']} for x in plan['changes']],indent=2))
    elif args.apply:
        plan = json.loads(args.apply.read_text())
        result = worker['query'](apply_sql(plan))
        if result.returncode: raise RuntimeError(result.stderr)
        print(json.dumps({'published':len(plan['changes']),'receipt_prefix':'september-2026-policy-v1:'}))
    else:
        parser.error('Choose --plan PATH or --apply PLAN')


if __name__ == '__main__':
    main()
