import {
  ExternalSource,
  SourceEntityType,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import { getAccessibleCampaignOptionsForMembership } from "@/server/campaigns/queries";
import {
  formatPlatformLabel,
  getSelectedIdsFromSearchParams,
  type DashboardOption,
  type DashboardSearchParams,
} from "@/server/dashboard/filters";

const EMPTY_ACCOUNT_FILTER: Prisma.CreatorPlatformAccountWhereInput = {
  id: {
    in: [],
  },
};
export const CREATORS_PAGE_SIZE = 20;

function buildImportedAccountBaseWhere(args: {
  organizationId: string;
  canManageOrganizationData: boolean;
  accessibleCampaignIds: string[];
}): Prisma.CreatorPlatformAccountWhereInput {
  if (!args.canManageOrganizationData && args.accessibleCampaignIds.length === 0) {
    return EMPTY_ACCOUNT_FILTER;
  }

  const creatorWhere: Prisma.CreatorWhereInput = {
    organizationId: args.organizationId,
  };

  if (!args.canManageOrganizationData) {
    creatorWhere.campaignLinks = {
      some: {
        campaignId: {
          in: args.accessibleCampaignIds,
        },
      },
    };
  }

  return {
    lastSyncedAt: {
      not: null,
    },
    creator: creatorWhere,
  };
}

function getVisibleCampaignIds(args: {
  accessibleCampaignIds: string[];
  canManageOrganizationData: boolean;
  selectedCampaignIds: string[];
}) {
  const {
    accessibleCampaignIds,
    canManageOrganizationData,
    selectedCampaignIds,
  } = args;

  if (accessibleCampaignIds.length === 0) {
    return canManageOrganizationData ? null : [];
  }

  if (selectedCampaignIds.length === 0) {
    return [];
  }

  if (!canManageOrganizationData) {
    return selectedCampaignIds.length < accessibleCampaignIds.length
      ? selectedCampaignIds
      : accessibleCampaignIds;
  }

  return selectedCampaignIds.length < accessibleCampaignIds.length
    ? selectedCampaignIds
    : null;
}

function buildVisibleImportedAccountWhere(args: {
  organizationId: string;
  accessibleCampaignIds: string[];
  canManageOrganizationData: boolean;
  selectedCampaignIds: string[];
  availableAccountIds: string[];
  selectedAccountIds: string[];
}): Prisma.CreatorPlatformAccountWhereInput {
  if (args.availableAccountIds.length > 0 && args.selectedAccountIds.length === 0) {
    return EMPTY_ACCOUNT_FILTER;
  }

  const visibleCampaignIds = getVisibleCampaignIds({
    accessibleCampaignIds: args.accessibleCampaignIds,
    canManageOrganizationData: args.canManageOrganizationData,
    selectedCampaignIds: args.selectedCampaignIds,
  });

  if (visibleCampaignIds && visibleCampaignIds.length === 0) {
    return EMPTY_ACCOUNT_FILTER;
  }

  const creatorWhere: Prisma.CreatorWhereInput = {
    organizationId: args.organizationId,
  };

  if (visibleCampaignIds) {
    creatorWhere.campaignLinks = {
      some: {
        campaignId: {
          in: visibleCampaignIds,
        },
      },
    };
  }

  const where: Prisma.CreatorPlatformAccountWhereInput = {
    lastSyncedAt: {
      not: null,
    },
    creator: creatorWhere,
  };

  if (
    args.availableAccountIds.length > 0 &&
    args.selectedAccountIds.length < args.availableAccountIds.length
  ) {
    where.id = {
      in: args.selectedAccountIds,
    };
  }

  return where;
}

async function getImportedAccountOptions(args: {
  organizationId: string;
  canManageOrganizationData: boolean;
  accessibleCampaignIds: string[];
}): Promise<DashboardOption[]> {
  const accounts = await prisma.creatorPlatformAccount.findMany({
    where: buildImportedAccountBaseWhere(args),
    select: {
      id: true,
      handle: true,
      platform: true,
      creator: {
        select: {
          displayName: true,
        },
      },
    },
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
  });

  return accounts.map((account) => ({
    id: account.id,
    label: account.handle,
    meta: `${formatPlatformLabel(account.platform)}${account.creator.displayName ? ` - ${account.creator.displayName}` : ""}`,
  }));
}

export async function getImportedCreatorAccountsWorkspace(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const canManageOrganizationData = canManageOrganization(membership.role);
  const accessibleCampaigns = await getAccessibleCampaignOptionsForMembership(
    membership,
  );
  const campaignOptions = accessibleCampaigns.map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const accessibleCampaignIds = campaignOptions.map((campaign) => campaign.id);
  const accountOptions = await getImportedAccountOptions({
    organizationId: membership.organizationId,
    canManageOrganizationData,
    accessibleCampaignIds,
  });
  const selectedCampaignIds = getSelectedIdsFromSearchParams(
    args.searchParams,
    "campaigns",
    accessibleCampaignIds,
  );
  const selectedAccountIds = getSelectedIdsFromSearchParams(
    args.searchParams,
    "accounts",
    accountOptions.map((account) => account.id),
  );
  const accounts = await prisma.creatorPlatformAccount.findMany({
    where: buildVisibleImportedAccountWhere({
      organizationId: membership.organizationId,
      accessibleCampaignIds,
      canManageOrganizationData,
      selectedCampaignIds,
      availableAccountIds: accountOptions.map((account) => account.id),
      selectedAccountIds,
    }),
    select: {
      id: true,
      handle: true,
      platform: true,
      profileUrl: true,
      followerCount: true,
      averageViews: true,
      averageEngagementRate: true,
      lastSyncedAt: true,
      creator: {
        select: {
          id: true,
          displayName: true,
          contactEmail: true,
          region: true,
          internalStatus: true,
          campaignLinks: canManageOrganizationData
            ? {
                select: {
                  campaign: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              }
            : {
                where: {
                  campaignId: {
                    in: accessibleCampaignIds,
                  },
                },
                select: {
                  campaign: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
        },
      },
    },
    orderBy: {
      handle: "asc",
    },
  });

  const sortedAccounts = accounts
    .map((account) => ({
      ...account,
      creator: {
        ...account.creator,
        campaignLinks: [...account.creator.campaignLinks].sort((left, right) =>
          left.campaign.name.localeCompare(right.campaign.name),
        ),
      },
    }))
    .sort((left, right) => {
      const followerDelta = (right.followerCount ?? -1) - (left.followerCount ?? -1);

      if (followerDelta !== 0) {
        return followerDelta;
      }

      const averageViewsDelta = (right.averageViews ?? -1) - (left.averageViews ?? -1);

      if (averageViewsDelta !== 0) {
        return averageViewsDelta;
      }

      return left.handle.localeCompare(right.handle);
    });

  return {
    accountOptions,
    accounts: sortedAccounts,
    campaignOptions,
    canManageOrganizationData,
    membership,
    selectedAccountIds,
    selectedCampaignIds,
    totalImportedAccountCount: accountOptions.length,
  };
}

export async function getCreatorsWorkspace(args: {
  organizationSlug: string;
  page?: number;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const campaignOptions = (
    await getAccessibleCampaignOptionsForMembership(membership)
  ).map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const requestedPage =
    typeof args.page === "number" && Number.isInteger(args.page) && args.page > 0
      ? args.page
      : 1;
  const where: Prisma.CreatorWhereInput = {
    organizationId: membership.organizationId,
  };
  const totalCount = await prisma.creator.count({
    where,
  });
  const pageCount =
    totalCount > 0 ? Math.ceil(totalCount / CREATORS_PAGE_SIZE) : 0;
  const currentPage = pageCount === 0 ? 1 : Math.min(requestedPage, pageCount);
  const creators = totalCount
    ? await prisma.creator.findMany({
        where,
        select: {
          id: true,
          displayName: true,
          primaryNiche: true,
          region: true,
          language: true,
          internalStatus: true,
          notesSummary: true,
          contactEmail: true,
          customTags: true,
          createdAt: true,
          updatedAt: true,
          platformAccounts: {
            select: {
              id: true,
              platform: true,
              handle: true,
              profileUrl: true,
              followerCount: true,
              averageViews: true,
            },
            orderBy: [{ followerCount: "desc" }, { createdAt: "asc" }],
          },
          campaignLinks: {
            select: {
              campaign: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: {
              campaign: {
                name: "asc",
              },
            },
          },
          _count: {
            select: {
              campaignLinks: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: (currentPage - 1) * CREATORS_PAGE_SIZE,
        take: CREATORS_PAGE_SIZE,
      })
    : [];
  const creatorIds = creators.map((creator) => creator.id);
  const providerMappings = creatorIds.length
    ? await prisma.sourceMapping.findMany({
        where: {
          organizationId: membership.organizationId,
          localEntityType: SourceEntityType.CREATOR,
          externalSource: ExternalSource.DATA_PROVIDER,
          externalResourceType: "viral-creator",
          localEntityId: {
            in: creatorIds,
          },
        },
        select: {
          localEntityId: true,
          externalId: true,
          lastSyncedAt: true,
        },
      })
    : [];

  const providerMappingByCreatorId = new Map(
    providerMappings.map((mapping) => [mapping.localEntityId, mapping]),
  );

  return {
    canTrackCreators: campaignOptions.length > 0,
    campaignOptions,
    currentPage,
    membership,
    pageCount,
    pageSize: CREATORS_PAGE_SIZE,
    creators: creators.map((creator) => {
      const providerMapping = providerMappingByCreatorId.get(creator.id) ?? null;

      return {
        ...creator,
        providerCreatorId: providerMapping?.externalId ?? null,
        providerLastSyncedAt: providerMapping?.lastSyncedAt ?? null,
      };
    }),
    totalCount,
  };
}
