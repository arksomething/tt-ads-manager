export type CreatorPortalDirectoryAccess = {
  id: string;
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

export function buildCreatorPortalDirectoryOpenHref(
  organizationSlug: string,
  campaignCreatorId: string,
) {
  const searchParams = new URLSearchParams({
    campaignCreatorId,
  });

  return `/org/${organizationSlug}/ugc-pay/open?${searchParams.toString()}`;
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
