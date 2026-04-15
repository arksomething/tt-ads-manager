import { type OrganizationMembership, type Platform } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { canManageOrganization } from "@/server/auth/roles";

export type DashboardOption = {
  id: string;
  label: string;
  meta?: string;
};

export type DashboardSearchParams = Record<
  string,
  string | string[] | undefined
>;

export const dashboardDateRangeOptions = [
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "qtd", label: "Quarter to date" },
] as const;

type ViewerOrganizationMembership = Pick<
  OrganizationMembership,
  "organizationId" | "role" | "userId"
>;

function getSearchParamValue(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export function formatPlatformLabel(platform: Platform) {
  switch (platform) {
    case "INSTAGRAM_REELS":
      return "Instagram";
    case "YOUTUBE_SHORTS":
      return "YouTube";
    default:
      return "TikTok";
  }
}

export async function getAccessibleAccountOptionsForMembership(
  membership: ViewerOrganizationMembership,
  accessibleCampaignIds: string[],
) {
  if (!canManageOrganization(membership.role) && accessibleCampaignIds.length === 0) {
    return [];
  }

  const accounts = await prisma.creatorPlatformAccount.findMany({
    where: canManageOrganization(membership.role)
      ? {
          creator: {
            organizationId: membership.organizationId,
          },
        }
      : {
          creator: {
            organizationId: membership.organizationId,
            campaignLinks: {
              some: {
                campaignId: {
                  in: accessibleCampaignIds,
                },
              },
            },
          },
        },
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

export function getSelectedIdsFromSearchParams(
  searchParams: DashboardSearchParams | undefined,
  key: string,
  validIds: string[],
) {
  if (validIds.length === 0) {
    return [];
  }

  const rawValue = getSearchParamValue(searchParams, key);

  if (!rawValue) {
    return [...validIds];
  }

  if (rawValue === "none") {
    return [];
  }

  const validIdSet = new Set(validIds);
  const selectedIds = rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => validIdSet.has(entry));

  return selectedIds.length > 0 ? selectedIds : [...validIds];
}

export function getSelectedDateRange(
  searchParams: DashboardSearchParams | undefined,
) {
  const rawValue = getSearchParamValue(searchParams, "range");
  const validRangeIds = new Set<string>(
    dashboardDateRangeOptions.map((option) => option.id),
  );

  return rawValue && validRangeIds.has(rawValue)
    ? rawValue
    : (dashboardDateRangeOptions[1]?.id ?? dashboardDateRangeOptions[0].id);
}

export function getDateRangeStart(rangeId: string, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (rangeId) {
    case "7d":
      start.setDate(start.getDate() - 6);
      return start;
    case "30d":
      start.setDate(start.getDate() - 29);
      return start;
    case "qtd": {
      const quarterStartMonth = Math.floor(start.getMonth() / 3) * 3;
      start.setMonth(quarterStartMonth, 1);
      return start;
    }
    default:
      start.setDate(start.getDate() - 13);
      return start;
  }
}
