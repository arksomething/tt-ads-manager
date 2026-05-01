DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'CreatorDealPerVideoCapScope'
  ) THEN
    CREATE TYPE "CreatorDealPerVideoCapScope" AS ENUM (
      'CPM',
      'TOTAL',
      'NONE'
    );
  END IF;
END
$$;

ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ADD COLUMN IF NOT EXISTS "fixedFeePerVideo" NUMERIC(12, 2);

ALTER TABLE IF EXISTS "CampaignCreatorDeal"
  ADD COLUMN IF NOT EXISTS "perVideoCapScope" "CreatorDealPerVideoCapScope" NOT NULL DEFAULT 'CPM';

UPDATE "CampaignCreatorDeal"
SET "perVideoCapScope" = 'CPM'
WHERE "perVideoCapScope" IS NULL;
