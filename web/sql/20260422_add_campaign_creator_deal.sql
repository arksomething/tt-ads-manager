DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'CreatorDealPaidTrafficMetric'
  ) THEN
    CREATE TYPE "CreatorDealPaidTrafficMetric" AS ENUM (
      'VIDEO_PLAY_ACTIONS',
      'IMPRESSIONS'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "CampaignCreatorDeal" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "campaignCreatorId" TEXT NOT NULL UNIQUE,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "effectiveStartDate" TIMESTAMPTZ NOT NULL,
  "effectiveEndDate" TIMESTAMPTZ,
  "fixedFee" NUMERIC(12, 2),
  "fixedFeeRecognitionDate" TIMESTAMPTZ,
  "cpmAmount" NUMERIC(12, 2),
  "paidTrafficMetric" "CreatorDealPaidTrafficMetric" NOT NULL DEFAULT 'VIDEO_PLAY_ACTIONS',
  "deductPaidTraffic" BOOLEAN NOT NULL DEFAULT TRUE,
  "viewCapPerVideo" INTEGER,
  "payoutCapTotal" NUMERIC(12, 2),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CampaignCreatorDeal_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE,
  CONSTRAINT "CampaignCreatorDeal_campaignCreatorId_fkey"
    FOREIGN KEY ("campaignCreatorId")
    REFERENCES "CampaignCreator"("id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CampaignCreatorDeal_organizationId_effectiveStartDate_idx"
  ON "CampaignCreatorDeal" ("organizationId", "effectiveStartDate");

CREATE INDEX IF NOT EXISTS "CampaignCreatorDeal_organizationId_effectiveEndDate_idx"
  ON "CampaignCreatorDeal" ("organizationId", "effectiveEndDate");
