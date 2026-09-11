-- Shared history for the existing calculator's authoritative deal rows.
BEGIN;
CREATE TABLE IF NOT EXISTS public."CreatorDealVersion" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "dealId" text NOT NULL, "organizationId" text NOT NULL,
 "campaignCreatorId" text NOT NULL, revision bigint NOT NULL,
 terms jsonb NOT NULL, actor text NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("dealId",revision)
);
ALTER TABLE public."CampaignCreatorDeal" ADD COLUMN IF NOT EXISTS "dealVersionId" text;
ALTER TABLE public."CampaignCreatorDeal" ADD COLUMN IF NOT EXISTS "agreementUrl" text;
CREATE TABLE IF NOT EXISTS public."CreatorDealPublication" (
 "requestId" text PRIMARY KEY, "organizationId" text NOT NULL,
 "campaignCreatorId" text NOT NULL, result jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public."PayoutTermsSnapshot" (
 "payoutId" text PRIMARY KEY, "organizationId" text NOT NULL,
 payout jsonb NOT NULL, "dealVersions" jsonb NOT NULL,
 "videoOverrides" jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.gotall_immutable_record() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published history is immutable'; END $$;
DROP TRIGGER IF EXISTS immutable_deal_version ON public."CreatorDealVersion";
CREATE TRIGGER immutable_deal_version BEFORE UPDATE OR DELETE ON public."CreatorDealVersion"
 FOR EACH ROW EXECUTE FUNCTION public.gotall_immutable_record();
DROP TRIGGER IF EXISTS immutable_payout_terms ON public."PayoutTermsSnapshot";
CREATE TRIGGER immutable_payout_terms BEFORE UPDATE OR DELETE ON public."PayoutTermsSnapshot"
 FOR EACH ROW EXECUTE FUNCTION public.gotall_immutable_record();

CREATE OR REPLACE FUNCTION public.gotall_version_deal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text; n bigint; payload jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."campaignCreatorId",0));
 payload=to_jsonb(NEW)-'dealVersionId'-'updatedAt';
 IF TG_OP='UPDATE' AND OLD."dealVersionId" IS NOT NULL AND
    payload=to_jsonb(OLD)-'dealVersionId'-'updatedAt' THEN
   NEW."dealVersionId"=OLD."dealVersionId"; RETURN NEW;
 END IF;
 SELECT coalesce(max(revision),0)+1 INTO n FROM public."CreatorDealVersion" WHERE "dealId"=NEW.id;
 INSERT INTO public."CreatorDealVersion"("dealId","organizationId","campaignCreatorId",revision,terms,actor)
 VALUES(NEW.id,NEW."organizationId",NEW."campaignCreatorId",n,payload,
 coalesce(nullif(current_setting('gotall.deal_actor',true),''),'dashboard')) RETURNING id INTO v;
 NEW."dealVersionId"=v;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS version_creator_deal ON public."CampaignCreatorDeal";
CREATE TRIGGER version_creator_deal BEFORE INSERT OR UPDATE ON public."CampaignCreatorDeal"
 FOR EACH ROW EXECUTE FUNCTION public.gotall_version_deal();
-- Preserve existing terms without changing rates, dates, or timestamps.
UPDATE public."CampaignCreatorDeal" SET "dealVersionId"=NULL WHERE "dealVersionId" IS NULL;

CREATE OR REPLACE FUNCTION public.gotall_snapshot_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public."PayoutTermsSnapshot" WHERE "payoutId"=OLD.id) THEN RAISE EXCEPTION 'Finalized payments cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF EXISTS(SELECT 1 FROM public."PayoutTermsSnapshot" WHERE "payoutId"=NEW.id) THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'A finalized payment identifier cannot be reused'; END IF;
  IF TG_OP='UPDATE' AND (NEW.amount,NEW.currency,NEW."organizationId",NEW."creatorId",NEW."campaignCreatorId",NEW."campaignId")
    IS DISTINCT FROM (OLD.amount,OLD.currency,OLD."organizationId",OLD."creatorId",OLD."campaignCreatorId",OLD."campaignId") THEN
   RAISE EXCEPTION 'Finalized payment amounts and recipients are locked; record an adjustment separately';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.status::text IN ('APPROVED','SCHEDULED','PAID') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(cc.id,0)) FROM public."CampaignCreator" cc
   WHERE cc.id=NEW."campaignCreatorId" OR (NEW."campaignCreatorId" IS NULL AND cc."creatorId"=NEW."creatorId") ORDER BY cc.id;
  INSERT INTO public."PayoutTermsSnapshot"("payoutId","organizationId",payout,"dealVersions","videoOverrides")
  SELECT NEW.id,NEW."organizationId",to_jsonb(NEW),
   coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public."CampaignCreatorDeal" d
    JOIN public."CampaignCreator" cc ON cc.id=d."campaignCreatorId"
    WHERE d."organizationId"=NEW."organizationId" AND
     (d."campaignCreatorId"=NEW."campaignCreatorId" OR (NEW."campaignCreatorId" IS NULL AND cc."creatorId"=NEW."creatorId" AND (NEW."campaignId" IS NULL OR cc."campaignId"=NEW."campaignId")))),'[]'),
   coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public."CampaignCreatorVideoDeal" d
    JOIN public."CampaignCreator" cc ON cc.id=d."campaignCreatorId"
    WHERE d."organizationId"=NEW."organizationId" AND
     (d."campaignCreatorId"=NEW."campaignCreatorId" OR (NEW."campaignCreatorId" IS NULL AND cc."creatorId"=NEW."creatorId" AND (NEW."campaignId" IS NULL OR cc."campaignId"=NEW."campaignId")))),'[]');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS snapshot_payout_terms ON public."Payout";
CREATE TRIGGER snapshot_payout_terms BEFORE INSERT OR UPDATE OR DELETE ON public."Payout"
 FOR EACH ROW EXECUTE FUNCTION public.gotall_snapshot_payout();

CREATE OR REPLACE FUNCTION public.gotall_publish_creator_deal(
 request_id text, organization_id text, campaign_creator_id text,
 source_deal_id text, expected_version_id text, actor_id text, new_terms jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE old public."CampaignCreatorDeal"; fresh public."CampaignCreatorDeal"; result jsonb; start_day date; k text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(campaign_creator_id,0));
 SELECT p.result INTO result FROM public."CreatorDealPublication" p WHERE p."requestId"=request_id
  AND p."organizationId"=organization_id AND p."campaignCreatorId"=campaign_creator_id;
 IF FOUND THEN RETURN result; END IF;
 SELECT * INTO old FROM public."CampaignCreatorDeal" WHERE id=source_deal_id
  AND "organizationId"=organization_id AND "campaignCreatorId"=campaign_creator_id FOR UPDATE;
 IF NOT FOUND OR old."dealVersionId" IS DISTINCT FROM expected_version_id THEN
  RAISE EXCEPTION 'The deal changed. Reopen it and review a fresh draft.';
 END IF;
 IF actor_id IS NULL OR actor_id='' THEN RAISE EXCEPTION 'An editor is required'; END IF;
 start_day=(new_terms->>'effectiveStartDate')::date;
 IF start_day IS NULL OR start_day<CURRENT_DATE THEN RAISE EXCEPTION 'Choose today or a future effective date'; END IF;
 fresh=jsonb_populate_record(old,new_terms);
 IF fresh.currency !~ '^[A-Z]{3}$' OR fresh."effectiveStartDate" IS NULL OR fresh."deductPaidTraffic" IS NULL OR fresh."paidTrafficMetric" IS NULL OR fresh."perVideoCapScope" IS NULL THEN RAISE EXCEPTION 'Complete the deal terms'; END IF;
 IF fresh."effectiveEndDate"<fresh."effectiveStartDate" THEN RAISE EXCEPTION 'End date must follow start date'; END IF;
 FOREACH k IN ARRAY ARRAY['fixedFee','fixedFeePerVideo','cpmAmount','payoutCapPerVideo','payoutCapTotal','viewCapPerVideo','viewWindowDays'] LOOP
  IF (new_terms->>k)::numeric<0 THEN RAISE EXCEPTION 'Amounts and limits must not be negative'; END IF;
 END LOOP;
 IF fresh."viewWindowDays"=0 OR fresh."viewCapPerVideo"=0 THEN RAISE EXCEPTION 'View limits must be positive'; END IF;
 IF fresh."fixedFee" IS NULL AND fresh."fixedFeePerVideo" IS NULL AND fresh."cpmAmount" IS NULL THEN RAISE EXCEPTION 'Set compensation'; END IF;
 IF EXISTS(SELECT 1 FROM public."CampaignCreatorDeal" d WHERE d."campaignCreatorId"=campaign_creator_id AND d.id<>old.id
  AND d."effectiveStartDate"<=coalesce(fresh."effectiveEndDate",'infinity'::timestamp) AND coalesce(d."effectiveEndDate",'infinity'::timestamp)>=fresh."effectiveStartDate") THEN
  RAISE EXCEPTION 'These dates overlap another scheduled deal';
 END IF;
 IF fresh."effectiveStartDate"<old."effectiveStartDate" THEN RAISE EXCEPTION 'The new deal cannot precede the selected deal'; END IF;
 PERFORM set_config('gotall.deal_actor',actor_id,true);
 IF fresh."effectiveStartDate"=old."effectiveStartDate" THEN
  UPDATE public."CampaignCreatorDeal" SET currency=fresh.currency,"effectiveEndDate"=fresh."effectiveEndDate",
   "fixedFee"=fresh."fixedFee","fixedFeeRecognitionDate"=fresh."fixedFeeRecognitionDate","fixedFeePerVideo"=fresh."fixedFeePerVideo",
   "cpmAmount"=fresh."cpmAmount","paidTrafficMetric"=fresh."paidTrafficMetric","deductPaidTraffic"=fresh."deductPaidTraffic",
   "viewCapPerVideo"=fresh."viewCapPerVideo","viewWindowDays"=fresh."viewWindowDays","payoutCapPerVideo"=fresh."payoutCapPerVideo",
   "perVideoCapScope"=fresh."perVideoCapScope","payoutCapTotal"=fresh."payoutCapTotal",notes=fresh.notes,"agreementUrl"=fresh."agreementUrl","updatedAt"=now()
   WHERE id=old.id RETURNING * INTO fresh;
 ELSE
  UPDATE public."CampaignCreatorDeal" SET "effectiveEndDate"=least(coalesce("effectiveEndDate",'infinity'::timestamp),fresh."effectiveStartDate"-interval '1 day'),"updatedAt"=now() WHERE id=old.id;
  fresh.id=gen_random_uuid()::text;fresh."organizationId"=organization_id;fresh."campaignCreatorId"=campaign_creator_id;
  fresh."createdAt"=now();fresh."updatedAt"=now();fresh."dealVersionId"=NULL;
  INSERT INTO public."CampaignCreatorDeal" SELECT fresh.* RETURNING * INTO fresh;
 END IF;
 result=to_jsonb(fresh);
 INSERT INTO public."CreatorDealPublication" VALUES(request_id,organization_id,campaign_creator_id,result,now());
 RETURN result;
END $$;
ALTER TABLE public."CreatorDealVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CreatorDealPublication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PayoutTermsSnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CreatorDealVersion",public."CreatorDealPublication",public."PayoutTermsSnapshot" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gotall_publish_creator_deal(text,text,text,text,text,text,jsonb) FROM PUBLIC;
-- Existing application writes run as service_role; no browser role may publish directly.
GRANT SELECT,INSERT ON public."CreatorDealVersion",public."CreatorDealPublication",public."PayoutTermsSnapshot" TO service_role;
GRANT EXECUTE ON FUNCTION public.gotall_publish_creator_deal(text,text,text,text,text,text,jsonb) TO service_role;
COMMIT;
