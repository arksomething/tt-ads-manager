DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ReportingDayBuildStatus'
  ) THEN
    CREATE TYPE "ReportingDayBuildStatus" AS ENUM (
      'RUNNING',
      'SUCCEEDED',
      'INCOMPLETE',
      'FAILED',
      'SUPERSEDED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ReportingFreshness'
  ) THEN
    CREATE TYPE "ReportingFreshness" AS ENUM (
      'FRESH',
      'STALE',
      'INCOMPLETE',
      'SUPERSEDED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReportingDayVersion" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "organizationId" TEXT NOT NULL,
  "reportDate" TIMESTAMPTZ NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ReportingDayBuildStatus" NOT NULL DEFAULT 'RUNNING',
  "freshness" "ReportingFreshness" NOT NULL DEFAULT 'INCOMPLETE',
  "isCurrent" BOOLEAN NOT NULL DEFAULT FALSE,
  "pricingConfigVersion" TEXT,
  "sourceConfigVersion" TEXT,
  "sourceState" JSONB,
  "warnings" JSONB,
  "error" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  CONSTRAINT "ReportingDayVersion_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ReportingDailyFact" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "dayVersionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reportDate" TIMESTAMPTZ NOT NULL,
  "metricKey" TEXT NOT NULL,
  "value" NUMERIC(18, 6) NOT NULL,
  "unit" TEXT,
  "currency" TEXT,
  "source" TEXT NOT NULL DEFAULT 'total',
  "bucket" TEXT NOT NULL DEFAULT 'total',
  "dimensionsKey" TEXT NOT NULL DEFAULT 'default',
  "dimensions" JSONB,
  "provenance" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ReportingDailyFact_dayVersionId_fkey"
    FOREIGN KEY ("dayVersionId")
    REFERENCES "ReportingDayVersion"("id")
    ON DELETE CASCADE,
  CONSTRAINT "ReportingDailyFact_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReportingDayVersion_organizationId_reportDate_version_key"
  ON "ReportingDayVersion" ("organizationId", "reportDate", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "ReportingDayVersion_one_current_per_day_key"
  ON "ReportingDayVersion" ("organizationId", "reportDate")
  WHERE "isCurrent";

CREATE INDEX IF NOT EXISTS "ReportingDayVersion_organizationId_reportDate_isCurrent_idx"
  ON "ReportingDayVersion" ("organizationId", "reportDate", "isCurrent");

CREATE INDEX IF NOT EXISTS "ReportingDayVersion_organizationId_freshness_reportDate_idx"
  ON "ReportingDayVersion" ("organizationId", "freshness", "reportDate");

CREATE INDEX IF NOT EXISTS "ReportingDayVersion_organizationId_status_createdAt_idx"
  ON "ReportingDayVersion" ("organizationId", "status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ReportingDailyFact_dayVersionId_metricKey_source_bucket_dimensionsKey_key"
  ON "ReportingDailyFact" ("dayVersionId", "metricKey", "source", "bucket", "dimensionsKey");

CREATE INDEX IF NOT EXISTS "ReportingDailyFact_dayVersionId_idx"
  ON "ReportingDailyFact" ("dayVersionId");

CREATE INDEX IF NOT EXISTS "ReportingDailyFact_organizationId_reportDate_metricKey_idx"
  ON "ReportingDailyFact" ("organizationId", "reportDate", "metricKey");

CREATE INDEX IF NOT EXISTS "ReportingDailyFact_organizationId_reportDate_source_bucket_idx"
  ON "ReportingDailyFact" ("organizationId", "reportDate", "source", "bucket");

CREATE INDEX IF NOT EXISTS "ReportingDailyFact_organizationId_reportDate_metricKey_source_bucket_idx"
  ON "ReportingDailyFact" ("organizationId", "reportDate", "metricKey", "source", "bucket");
