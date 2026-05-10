CREATE TABLE IF NOT EXISTS "OrganizationIntegrationCredential" (
  "id" TEXT PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "valuePreview" TEXT,
  "lastValidatedAt" TIMESTAMPTZ,
  "lastValidationStatus" TEXT,
  "lastValidationError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "OrganizationIntegrationCredential_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationIntegrationCredential_organizationId_key_key"
  ON "OrganizationIntegrationCredential" ("organizationId", "key");

CREATE INDEX IF NOT EXISTS "OrganizationIntegrationCredential_organizationId_idx"
  ON "OrganizationIntegrationCredential" ("organizationId");
