CREATE TABLE IF NOT EXISTS "VideoContentClassification" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "organizationId" TEXT NOT NULL,
  "platform" "Platform" NOT NULL DEFAULT 'TIKTOK',
  "sourceVideoId" TEXT NOT NULL,
  "isTalking" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "VideoContentClassification_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "VideoContentClassification_organizationId_platform_sourceVideoId_key"
  ON "VideoContentClassification" ("organizationId", "platform", "sourceVideoId");

CREATE INDEX IF NOT EXISTS "VideoContentClassification_organizationId_isTalking_idx"
  ON "VideoContentClassification" ("organizationId", "isTalking");
