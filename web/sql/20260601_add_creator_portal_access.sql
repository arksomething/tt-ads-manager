CREATE TABLE IF NOT EXISTS "CreatorPortalAccess" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "organizationId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "campaignCreatorId" TEXT,
  "linkTokenHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codePrefix" TEXT NOT NULL,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CreatorPortalAccess_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE,
  CONSTRAINT "CreatorPortalAccess_creatorId_fkey"
    FOREIGN KEY ("creatorId")
    REFERENCES "Creator"("id")
    ON DELETE CASCADE,
  CONSTRAINT "CreatorPortalAccess_campaignCreatorId_fkey"
    FOREIGN KEY ("campaignCreatorId")
    REFERENCES "CampaignCreator"("id")
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorPortalAccess_linkTokenHash_key"
  ON "CreatorPortalAccess" ("linkTokenHash");

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorPortalAccess_codeHash_key"
  ON "CreatorPortalAccess" ("codeHash");

CREATE INDEX IF NOT EXISTS "CreatorPortalAccess_organizationId_creatorId_idx"
  ON "CreatorPortalAccess" ("organizationId", "creatorId");

CREATE INDEX IF NOT EXISTS "CreatorPortalAccess_campaignCreatorId_idx"
  ON "CreatorPortalAccess" ("campaignCreatorId");

CREATE INDEX IF NOT EXISTS "CreatorPortalAccess_revokedAt_idx"
  ON "CreatorPortalAccess" ("revokedAt");
