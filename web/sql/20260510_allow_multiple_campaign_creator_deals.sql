ALTER TABLE "CampaignCreatorDeal"
  DROP CONSTRAINT IF EXISTS "CampaignCreatorDeal_campaignCreatorId_key";

DROP INDEX IF EXISTS "CampaignCreatorDeal_campaignCreatorId_key";

CREATE INDEX IF NOT EXISTS "CampaignCreatorDeal_campaignCreatorId_idx"
  ON "CampaignCreatorDeal" ("campaignCreatorId");
