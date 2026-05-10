CREATE TABLE IF NOT EXISTS "CampaignCreatorVideoDeal" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "organizationId" TEXT NOT NULL,
  "campaignCreatorId" TEXT NOT NULL,
  "sourceVideoId" TEXT NOT NULL,
  "fixedFeePerVideo" NUMERIC(12, 2),
  "cpmAmount" NUMERIC(12, 2) DEFAULT 1,
  "paidTrafficMetric" "CreatorDealPaidTrafficMetric" NOT NULL DEFAULT 'IMPRESSIONS',
  "deductPaidTraffic" BOOLEAN NOT NULL DEFAULT TRUE,
  "viewCapPerVideo" INTEGER,
  "payoutCapPerVideo" NUMERIC(12, 2) DEFAULT 100,
  "perVideoCapScope" "CreatorDealPerVideoCapScope" NOT NULL DEFAULT 'CPM',
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CampaignCreatorVideoDeal_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE,
  CONSTRAINT "CampaignCreatorVideoDeal_campaignCreatorId_fkey"
    FOREIGN KEY ("campaignCreatorId")
    REFERENCES "CampaignCreator"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignCreatorVideoDeal_campaignCreatorId_sourceVideoId_key"
  ON "CampaignCreatorVideoDeal" ("campaignCreatorId", "sourceVideoId");

CREATE INDEX IF NOT EXISTS "CampaignCreatorVideoDeal_organizationId_sourceVideoId_idx"
  ON "CampaignCreatorVideoDeal" ("organizationId", "sourceVideoId");

CREATE INDEX IF NOT EXISTS "CampaignCreatorVideoDeal_campaignCreatorId_idx"
  ON "CampaignCreatorVideoDeal" ("campaignCreatorId");
