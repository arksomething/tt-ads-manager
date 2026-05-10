DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ViralPostEnrichmentStatus'
  ) THEN
    CREATE TYPE "ViralPostEnrichmentStatus" AS ENUM (
      'PENDING',
      'PROCESSING',
      'SUCCEEDED',
      'FAILED',
      'RATE_LIMITED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ViralPostEnrichment" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "organizationId" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'tiktok',
  "platformVideoId" TEXT NOT NULL,
  "status" "ViralPostEnrichmentStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processingStartedAt" TIMESTAMPTZ,
  "lastFetchedAt" TIMESTAMPTZ,
  "lastError" TEXT,
  "accountDisplayName" TEXT,
  "accountUsername" TEXT,
  "caption" TEXT,
  "thumbnailUrl" TEXT,
  "videoUrl" TEXT,
  "publishedAt" TIMESTAMPTZ,
  "viewCount" INTEGER,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ViralPostEnrichment_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ViralPostEnrichment_organizationId_platform_platformVideoId_key"
  ON "ViralPostEnrichment" ("organizationId", "platform", "platformVideoId");

CREATE INDEX IF NOT EXISTS "ViralPostEnrichment_organizationId_status_nextAttemptAt_idx"
  ON "ViralPostEnrichment" ("organizationId", "status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "ViralPostEnrichment_platform_platformVideoId_idx"
  ON "ViralPostEnrichment" ("platform", "platformVideoId");
