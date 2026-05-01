ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ADD COLUMN IF NOT EXISTS "viewWindowDays" INTEGER;

ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ADD COLUMN IF NOT EXISTS "payoutCapPerVideo" NUMERIC(12, 2);

ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ALTER COLUMN "cpmAmount" SET DEFAULT 1;

ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ALTER COLUMN "viewWindowDays" SET DEFAULT 30;

ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ALTER COLUMN "payoutCapPerVideo" SET DEFAULT 100;

UPDATE "CampaignCreatorDeal"
SET "cpmAmount" = 1
WHERE "cpmAmount" IS NULL;

UPDATE "CampaignCreatorDeal"
SET "viewWindowDays" = 30
WHERE "viewWindowDays" IS NULL;

UPDATE "CampaignCreatorDeal"
SET "payoutCapPerVideo" = 100
WHERE "payoutCapPerVideo" IS NULL;
