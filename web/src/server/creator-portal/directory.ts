export type CreatorPortalDirectoryAccess = {
  id: string;
  linkPath?: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatorPortalDirectoryCampaignCreator = {
  id: string;
  createdAt: Date;
  creatorId: string;
  campaign: {
    id: string;
    name: string;
  };
  creator: {
    id: string;
    displayName: string;
    platformAccounts: Array<{
      handle: string;
    }>;
  };
  portalAccesses: CreatorPortalDirectoryAccess[];
};

export type CreatorPortalDirectoryRow = {
  campaignCreator: CreatorPortalDirectoryCampaignCreator;
  activeAccess: CreatorPortalDirectoryAccess | null;
  activeAccessCount: number;
};

export type CreatorPortalDirectorySummary = {
  creatorRows: number;
  activeLinks: number;
  campaigns: number;
};

export type CreatorPortalDirectoryDateDefaults = {
  endDate?: string | null;
  payMode?: string | null;
  startDate?: string | null;
  viewWindowMode?: string | null;
};

function appendCreatorPortalDateDefaults(
  href: string,
  defaults?: CreatorPortalDirectoryDateDefaults,
) {
  if (!defaults) {
    return href;
  }

  const [pathname, query = ""] = href.split("?");
  const searchParams = new URLSearchParams(query);

  for (const [key, value] of Object.entries(defaults)) {
    const trimmedValue = value?.trim();

    if (trimmedValue) {
      searchParams.set(key, trimmedValue);
    }
  }

  const nextQuery = searchParams.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

export function buildCreatorPortalDirectoryLinkHref(
  linkPath: string,
  defaults?: CreatorPortalDirectoryDateDefaults,
) {
  return appendCreatorPortalDateDefaults(linkPath, defaults);
}

export function buildCreatorPortalDirectoryOpenHref(
  organizationSlug: string,
  campaignCreatorId: string,
  defaults?: CreatorPortalDirectoryDateDefaults,
) {
  const searchParams = new URLSearchParams({
    campaignCreatorId,
  });

  return appendCreatorPortalDateDefaults(
    `/org/${organizationSlug}/ugc-pay/open?${searchParams.toString()}`,
    defaults,
  );
}

export function getLatestActiveCreatorPortalAccess(
  campaignCreator: CreatorPortalDirectoryCampaignCreator,
) {
  const activeAccesses = campaignCreator.portalAccesses
    .filter((access) => !access.revokedAt)
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

  return activeAccesses[0] ?? null;
}

export function buildCreatorPortalDirectoryRows(
  campaignCreators: CreatorPortalDirectoryCampaignCreator[],
): CreatorPortalDirectoryRow[] {
  return campaignCreators.map((campaignCreator) => {
    const activeAccessCount = campaignCreator.portalAccesses.filter(
      (access) => !access.revokedAt,
    ).length;

    return {
      campaignCreator,
      activeAccess: getLatestActiveCreatorPortalAccess(campaignCreator),
      activeAccessCount,
    };
  });
}

export function getCreatorPortalDirectorySummary(
  campaignCreators: CreatorPortalDirectoryCampaignCreator[],
): CreatorPortalDirectorySummary {
  const directoryRows = buildCreatorPortalDirectoryRows(campaignCreators);

  return {
    creatorRows: directoryRows.length,
    activeLinks: directoryRows.reduce(
      (total, row) => total + row.activeAccessCount,
      0,
    ),
    campaigns: new Set(
      directoryRows.map((row) => row.campaignCreator.campaign.id),
    ).size,
  };
}
