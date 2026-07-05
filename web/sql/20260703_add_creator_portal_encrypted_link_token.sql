ALTER TABLE "CreatorPortalAccess"
  ADD COLUMN IF NOT EXISTS "encryptedLinkToken" TEXT;
