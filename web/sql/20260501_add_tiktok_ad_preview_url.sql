CREATE TABLE IF NOT EXISTS "TikTokAdPreviewUrl" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "adId" TEXT NOT NULL,
  "adName" TEXT,
  "previewUrl" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ,
  "importedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sourceFileName" TEXT,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TikTokAdPreviewUrl_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TikTokAdPreviewUrl_organizationId_advertiserId_adId_key"
  ON "TikTokAdPreviewUrl" ("organizationId", "advertiserId", "adId");

CREATE INDEX IF NOT EXISTS "TikTokAdPreviewUrl_organizationId_advertiserId_expiresAt_idx"
  ON "TikTokAdPreviewUrl" ("organizationId", "advertiserId", "expiresAt");
