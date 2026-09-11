import os,subprocess,tempfile,pathlib,sys
BIN='/usr/lib/postgresql/17/bin/'
with tempfile.TemporaryDirectory(prefix='gotall-deals-') as work:
 env={**os.environ,'PGHOST':work,'PGPORT':'55489','PGDATABASE':'postgres'}
 def run(args,data=None):
  r=subprocess.run(args,input=data,text=True,env=env,capture_output=True)
  if r.returncode:raise RuntimeError(r.stderr)
  return r.stdout
 def sql(s):return run([BIN+'psql','-X','-v','ON_ERROR_STOP=1','-q','-t','-A'],s)
 run([BIN+'initdb','-D',work+'/db','-A','trust','--no-locale'])
 run([BIN+'pg_ctl','-D',work+'/db','-l',work+'/log','-o',f"-k {work} -p 55489 -c listen_addresses=''",'start'])
 try:
  sql('''CREATE ROLE service_role;
   CREATE TABLE "CampaignCreator" (id text primary key,"creatorId" text,"campaignId" text);
   CREATE TABLE "CampaignCreatorDeal" (id text primary key,"organizationId" text,"campaignCreatorId" text,currency text,"effectiveStartDate" timestamp,"effectiveEndDate" timestamp,"fixedFee" numeric,"fixedFeeRecognitionDate" timestamp,"fixedFeePerVideo" numeric,"cpmAmount" numeric,"paidTrafficMetric" text,"deductPaidTraffic" boolean,"viewCapPerVideo" int,"viewWindowDays" int,"payoutCapPerVideo" numeric,"perVideoCapScope" text,"payoutCapTotal" numeric,notes text,"createdAt" timestamp,"updatedAt" timestamp);
   CREATE TABLE "CampaignCreatorVideoDeal" (id text,"organizationId" text,"campaignCreatorId" text,"cpmAmount" numeric);
   CREATE TABLE "Payout" (id text primary key,"organizationId" text,"campaignCreatorId" text,"creatorId" text,"campaignId" text,amount numeric,currency text,status text);
   INSERT INTO "CampaignCreator" VALUES('cc','creator','campaign');
   INSERT INTO "CampaignCreatorDeal"(id,"organizationId","campaignCreatorId",currency,"effectiveStartDate","cpmAmount","paidTrafficMetric","deductPaidTraffic","viewWindowDays","payoutCapPerVideo","perVideoCapScope") VALUES('d','org','cc','USD',CURRENT_DATE-30,1,'IMPRESSIONS',true,7,100,'CPM');''')
  sql(pathlib.Path(sys.argv[1]).read_text())
  sql('''DO $$ DECLARE v text; result jsonb; before_snapshot jsonb; BEGIN
   SELECT "dealVersionId" INTO v FROM "CampaignCreatorDeal" WHERE id='d';
   IF v IS NULL THEN RAISE EXCEPTION 'missing baseline'; END IF;
   INSERT INTO "Payout" VALUES('pay','org','cc','creator','campaign',50,'USD','APPROVED');
   SELECT "dealVersions" INTO before_snapshot FROM "PayoutTermsSnapshot" WHERE "payoutId"='pay';
   result=gotall_publish_creator_deal('req','org','cc','d',v,'discord:admin',jsonb_build_object('effectiveStartDate',(CURRENT_DATE+1)::text,'cpmAmount','2'));
   IF result->>'cpmAmount'<>'2' THEN RAISE EXCEPTION 'publish did not update rates'; END IF;
   IF (SELECT "cpmAmount" FROM "CampaignCreatorDeal" WHERE "effectiveStartDate"<=CURRENT_DATE AND "effectiveEndDate">=CURRENT_DATE)<>1 THEN RAISE EXCEPTION 'future deal activated early'; END IF;
   IF (SELECT "cpmAmount" FROM "CampaignCreatorDeal" WHERE id=result->>'id')<>2 THEN RAISE EXCEPTION 'calculator projection differs'; END IF;
   IF gotall_publish_creator_deal('req','org','cc','d',v,'discord:admin','{}')<>result THEN RAISE EXCEPTION 'retry changed publication'; END IF;
   BEGIN PERFORM gotall_publish_creator_deal('stale','org','cc','d',v,'discord:other','{}'); RAISE EXCEPTION 'stale accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='stale accepted' THEN RAISE; END IF; END;
   IF before_snapshot<>(SELECT "dealVersions" FROM "PayoutTermsSnapshot" WHERE "payoutId"='pay') THEN RAISE EXCEPTION 'finalized terms changed'; END IF;
   BEGIN UPDATE "Payout" SET amount=100 WHERE id='pay'; RAISE EXCEPTION 'payment changed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='payment changed' THEN RAISE; END IF; END;
   UPDATE "Payout" SET status='PAID' WHERE id='pay';
   BEGIN DELETE FROM "CreatorDealVersion"; RAISE EXCEPTION 'history deleted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='history deleted' THEN RAISE; END IF; END;
   BEGIN PERFORM gotall_publish_creator_deal('wrong-org','other','cc',result->>'id',result->>'dealVersionId','discord:admin','{}'); RAISE EXCEPTION 'cross org accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross org accepted' THEN RAISE; END IF; END;
  END $$;''')
  print('PASS: baseline versions, shared calculator rows, future date, idempotency, stale drafts, immutable payment terms, locked amount, cross-organization rejection')
 finally:run([BIN+'pg_ctl','-D',work+'/db','stop','-m','fast'])
