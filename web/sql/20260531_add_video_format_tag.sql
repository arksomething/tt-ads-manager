ALTER TABLE "VideoContentClassification"
  ADD COLUMN IF NOT EXISTS "formatTag" TEXT;

CREATE INDEX IF NOT EXISTS "VideoContentClassification_organizationId_formatTag_idx"
  ON "VideoContentClassification" ("organizationId", "formatTag");
