export type UgcPayTrackedCreatorOption = {
  id: string;
  label: string;
  meta?: string;
  platformAccountId?: string | null;
};

export type UgcPayCampaignCreatorIdentity = {
  creator: {
    displayName: string;
    platformAccounts: Array<{
      handle: string;
      sourceAccountId?: string | null;
    }>;
  };
};

export type UgcPayCampaignCreatorWithDeals = UgcPayCampaignCreatorIdentity & {
  deals: Array<{
    effectiveStartDate: Date;
    effectiveEndDate: Date | null;
  }>;
};

const EXTERNALLY_PAID_MOM_CREATOR_NAMES = new Set([
  "maddy",
  "mumtipswithginny",
  "mumtips with ginny",
  "mumtipswithgenny",
  "mumtips with genny",
]);

const EXTERNALLY_PAID_MOM_CREATOR_HANDLES = new Set([
  "maddymomoftwo",
  "mumtipswithginny",
  "mumtipswithgenny",
]);

function normalizeAccountIdentity(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function getTrackedAccountIdentity(option: UgcPayTrackedCreatorOption) {
  return (
    normalizeAccountIdentity(option.platformAccountId) ??
    normalizeAccountIdentity(option.id) ??
    option.id
  );
}

function setUniqueTrackedAccountLookup(
  lookup: Map<string, UgcPayTrackedCreatorOption | null>,
  key: string | null,
  option: UgcPayTrackedCreatorOption,
) {
  if (!key) {
    return;
  }

  if (!lookup.has(key)) {
    lookup.set(key, option);
    return;
  }

  const existing = lookup.get(key);

  if (
    existing &&
    getTrackedAccountIdentity(existing) === getTrackedAccountIdentity(option)
  ) {
    return;
  }

  // The key is ambiguous only when it points at different Viral accounts.
  lookup.set(key, null);
}

export function isExternallyPaidMomCreator(
  creator: UgcPayCampaignCreatorIdentity["creator"],
) {
  const displayName = normalizeName(creator.displayName);

  if (displayName && EXTERNALLY_PAID_MOM_CREATOR_NAMES.has(displayName)) {
    return true;
  }

  return creator.platformAccounts.some((account) => {
    const handle = normalizeAccountIdentity(account.handle);
    return Boolean(handle && EXTERNALLY_PAID_MOM_CREATOR_HANDLES.has(handle));
  });
}

export function isExternallyPaidMomCreatorRow(row: {
  creatorName: string;
  accountHandle: string | null;
}) {
  return isExternallyPaidMomCreator({
    displayName: row.creatorName,
    platformAccounts: row.accountHandle
      ? [{ handle: row.accountHandle }]
      : [],
  });
}

export function isCreatorDealApplicableToRange(
  deal: {
    effectiveStartDate: Date;
    effectiveEndDate: Date | null;
  },
  start: Date,
  end: Date,
) {
  const dealStart = new Date(Date.UTC(
    deal.effectiveStartDate.getUTCFullYear(),
    deal.effectiveStartDate.getUTCMonth(),
    deal.effectiveStartDate.getUTCDate(),
  ));
  const dealEnd = deal.effectiveEndDate
    ? new Date(Date.UTC(
        deal.effectiveEndDate.getUTCFullYear(),
        deal.effectiveEndDate.getUTCMonth(),
        deal.effectiveEndDate.getUTCDate(),
      ))
    : null;
  const rangeStart = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  ));
  const rangeEnd = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  ));

  return dealStart <= rangeEnd && (!dealEnd || dealEnd >= rangeStart);
}

export function getPayoutWarningCampaignCreators<
  T extends UgcPayCampaignCreatorWithDeals,
>(creators: T[], start: Date, end: Date) {
  return creators.filter(
    (campaignCreator) =>
      !isExternallyPaidMomCreator(campaignCreator.creator) &&
      campaignCreator.deals.some((deal) =>
        isCreatorDealApplicableToRange(deal, start, end),
      ),
  );
}

/**
 * Match local campaign creators to Viral tracked accounts. Native platform IDs
 * are authoritative. Handles and display names are legacy fallbacks only when
 * no native-ID match exists.
 */
export function getMatchedUgcPayTrackedCreatorOptions<
  T extends UgcPayCampaignCreatorIdentity,
>(args: {
  campaignCreators: T[];
  creatorOptions: UgcPayTrackedCreatorOption[];
}) {
  const optionsByPlatformAccountId = new Map<
    string,
    UgcPayTrackedCreatorOption | null
  >();
  const optionsByHandle = new Map<string, UgcPayTrackedCreatorOption | null>();
  const optionsByName = new Map<string, UgcPayTrackedCreatorOption | null>();

  for (const option of args.creatorOptions) {
    setUniqueTrackedAccountLookup(
      optionsByPlatformAccountId,
      normalizeAccountIdentity(option.platformAccountId),
      option,
    );
    setUniqueTrackedAccountLookup(
      optionsByHandle,
      normalizeAccountIdentity(option.meta),
      option,
    );
    setUniqueTrackedAccountLookup(
      optionsByHandle,
      normalizeAccountIdentity(option.label),
      option,
    );
    setUniqueTrackedAccountLookup(
      optionsByName,
      normalizeName(option.label),
      option,
    );
  }

  const matchedOptions: UgcPayTrackedCreatorOption[] = [];
  const matchedAccountIdentities = new Set<string>();
  const unmatchedCampaignCreators: T[] = [];

  for (const campaignCreator of args.campaignCreators) {
    const matches = new Map<string, UgcPayTrackedCreatorOption>();

    for (const account of campaignCreator.creator.platformAccounts) {
      const sourceAccountId = normalizeAccountIdentity(account.sourceAccountId);
      const option = sourceAccountId
        ? (optionsByPlatformAccountId.get(sourceAccountId) ?? null)
        : null;

      if (option) {
        matches.set(getTrackedAccountIdentity(option), option);
      }
    }

    if (matches.size === 0) {
      for (const account of campaignCreator.creator.platformAccounts) {
        const handle = normalizeAccountIdentity(account.handle);
        const option = handle ? (optionsByHandle.get(handle) ?? null) : null;

        if (option) {
          matches.set(getTrackedAccountIdentity(option), option);
        }
      }
    }

    if (matches.size === 0) {
      const displayName = normalizeName(campaignCreator.creator.displayName);
      const option = displayName
        ? (optionsByName.get(displayName) ?? null)
        : null;

      if (option) {
        matches.set(getTrackedAccountIdentity(option), option);
      }
    }

    if (matches.size === 0) {
      unmatchedCampaignCreators.push(campaignCreator);
      continue;
    }

    for (const [accountIdentity, option] of matches) {
      if (matchedAccountIdentities.has(accountIdentity)) {
        continue;
      }

      matchedAccountIdentities.add(accountIdentity);
      matchedOptions.push(option);
    }
  }

  return {
    matchedOptions,
    unmatchedCampaignCreators,
  };
}
