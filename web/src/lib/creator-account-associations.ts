export type LocalCreatorPlatformAccountAssociation = {
  creatorId: string;
  handle: string;
  sourceAccountId: string | null;
};

export type ProviderTrackedAccountAssociation = {
  id: string;
  platformAccountId: string | null;
  username: string | null;
};

function normalizeAccountIdentity(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

/**
 * Resolve provider account IDs from explicit local creator-account links.
 * Native platform IDs are authoritative and survive username changes. Handle
 * matching is retained only for legacy local rows that predate source IDs.
 */
export function resolveLinkedProviderAccountIds(args: {
  creatorIds?: Iterable<string>;
  localAccounts: LocalCreatorPlatformAccountAssociation[];
  providerAccounts: ProviderTrackedAccountAssociation[];
}) {
  const selectedCreatorIds = args.creatorIds
    ? new Set(args.creatorIds)
    : null;
  const linkedAccounts = args.localAccounts.filter(
    (account) =>
      !selectedCreatorIds || selectedCreatorIds.has(account.creatorId),
  );
  const linkedSourceIds = new Set(
    linkedAccounts
      .map((account) => normalizeAccountIdentity(account.sourceAccountId))
      .filter((value): value is string => Boolean(value)),
  );
  const legacyHandles = new Set(
    linkedAccounts
      .filter((account) => !normalizeAccountIdentity(account.sourceAccountId))
      .map((account) => normalizeAccountIdentity(account.handle))
      .filter((value): value is string => Boolean(value)),
  );

  return args.providerAccounts
    .filter((account) => {
      const platformAccountId = normalizeAccountIdentity(
        account.platformAccountId,
      );

      if (platformAccountId && linkedSourceIds.has(platformAccountId)) {
        return true;
      }

      const username = normalizeAccountIdentity(account.username);
      return Boolean(username && legacyHandles.has(username));
    })
    .map((account) => account.id);
}
