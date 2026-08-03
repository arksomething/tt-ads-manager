-- Durable cross-lambda cache for Singular async report results, so cold
-- serverless instances adopt existing pending/ready reports instead of
-- re-creating them from scratch.
CREATE TABLE IF NOT EXISTS "SingularReportCache" (
  "cacheKey" TEXT PRIMARY KEY,
  "family" TEXT NOT NULL,
  "entry" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "SingularReportCache_family_expiresAt_idx"
  ON "SingularReportCache" ("family", "expiresAt");
