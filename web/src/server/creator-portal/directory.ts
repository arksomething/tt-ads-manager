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

export const CREATOR_PORTAL_DIRECTORY_DEFAULT_POSTED_WITHIN_MONTHS = 2;
export const CREATOR_PORTAL_DIRECTORY_POSTED_WITHIN_MONTH_OPTIONS = [
  1, 2, 3, 6, 12,
] as const;

export function parseCreatorPortalDirectoryPostedWithinMonths(
  value: string | null | undefined,
) {
  if (value === "all") {
    return null;
  }

  const parsed = Number(value);

  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 24) {
    return parsed;
  }

  return CREATOR_PORTAL_DIRECTORY_DEFAULT_POSTED_WITHIN_MONTHS;
}

export function getCreatorPortalDirectoryPostedSinceDate(
  postedWithinMonths: number,
  now: Date,
) {
  const postedSince = new Date(now);
  postedSince.setUTCMonth(postedSince.getUTCMonth() - postedWithinMonths);
  return postedSince;
}

export function applyCreatorPortalDirectoryLastPostControls(args: {
  rows: CreatorPortalDirectoryRow[];
  lastPostAtByCreatorId: Map<string, Date>;
  postedWithinMonths: number | null;
  sortByLastPost: boolean;
  now?: Date;
}): CreatorPortalDirectoryRow[] {
  const now = args.now ?? new Date();
  const getLastPostAt = (row: CreatorPortalDirectoryRow) =>
    args.lastPostAtByCreatorId.get(row.campaignCreator.creatorId) ?? null;

  let rows = [...args.rows];

  if (args.postedWithinMonths != null) {
    const postedSince = getCreatorPortalDirectoryPostedSinceDate(
      args.postedWithinMonths,
      now,
    );
    rows = rows.filter((row) => {
      const lastPostAt = getLastPostAt(row);
      return lastPostAt != null && lastPostAt >= postedSince;
    });
  }

  if (args.sortByLastPost) {
    rows.sort((left, right) => {
      const leftTime = getLastPostAt(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
      const rightTime = getLastPostAt(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
      return rightTime - leftTime;
    });
  }

  return rows;
}

export type CreatorPortalDirectoryCreatorIdentity = {
  creatorId: string;
  displayName: string | null;
  handles: string[];
};

export type CreatorPortalTrackedAccountLastPost = {
  username: string | null;
  displayName: string | null;
  latestVideoPublishedAt: Date | null;
};

function normalizeDirectoryHandle(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeDirectoryName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

// Last-post dates combine the freshest of two sources: locally synced videos
// and the live viral.app tracked-account feed (matched by TikTok handle, with
// a display-name fallback when no handle matches). The local Video table can
// lag weeks behind actual posting, so the live feed usually wins.
export function buildCreatorPortalLastPostAtByCreatorId(args: {
  creators: CreatorPortalDirectoryCreatorIdentity[];
  localLastPostAtByCreatorId: Map<string, Date>;
  trackedAccounts: CreatorPortalTrackedAccountLastPost[];
}): Map<string, Date> {
  const latestByHandle = new Map<string, Date>();
  const latestByName = new Map<string, Date>();

  for (const account of args.trackedAccounts) {
    const publishedAt = account.latestVideoPublishedAt;

    if (!publishedAt) {
      continue;
    }

    const handle = normalizeDirectoryHandle(account.username);

    if (handle) {
      const existing = latestByHandle.get(handle);

      if (!existing || publishedAt > existing) {
        latestByHandle.set(handle, publishedAt);
      }
    }

    const name = normalizeDirectoryName(account.displayName);

    if (name) {
      const existing = latestByName.get(name);

      if (!existing || publishedAt > existing) {
        latestByName.set(name, publishedAt);
      }
    }
  }

  const lastPostAtByCreatorId = new Map<string, Date>();

  for (const creator of args.creators) {
    const candidates: Date[] = [];
    const localLastPostAt = args.localLastPostAtByCreatorId.get(creator.creatorId);

    if (localLastPostAt) {
      candidates.push(localLastPostAt);
    }

    let matchedHandle = false;

    for (const rawHandle of creator.handles) {
      const handle = normalizeDirectoryHandle(rawHandle);
      const trackedLastPostAt = handle ? latestByHandle.get(handle) : undefined;

      if (trackedLastPostAt) {
        candidates.push(trackedLastPostAt);
        matchedHandle = true;
      }
    }

    if (!matchedHandle) {
      const name = normalizeDirectoryName(creator.displayName);
      const trackedLastPostAt = name ? latestByName.get(name) : undefined;

      if (trackedLastPostAt) {
        candidates.push(trackedLastPostAt);
      }
    }

    if (candidates.length > 0) {
      lastPostAtByCreatorId.set(
        creator.creatorId,
        new Date(Math.max(...candidates.map((candidate) => candidate.getTime()))),
      );
    }
  }

  return lastPostAtByCreatorId;
}

// The directory's primary job is surfacing portal links, so the default
// last-post filter must never empty the table: when it is not an explicit
// user choice and would hide every row, fall back to showing all creators
// and report that via `fallbackApplied` so the UI can explain itself.
export function resolveCreatorPortalDirectoryLastPostView(args: {
  rows: CreatorPortalDirectoryRow[];
  lastPostAtByCreatorId: Map<string, Date>;
  requestedMonths: number | null;
  isExplicit: boolean;
  sortByLastPost: boolean;
  now?: Date;
}): {
  rows: CreatorPortalDirectoryRow[];
  effectiveMonths: number | null;
  fallbackApplied: boolean;
} {
  const filteredRows = applyCreatorPortalDirectoryLastPostControls({
    rows: args.rows,
    lastPostAtByCreatorId: args.lastPostAtByCreatorId,
    postedWithinMonths: args.requestedMonths,
    sortByLastPost: args.sortByLastPost,
    now: args.now,
  });

  if (
    args.requestedMonths != null &&
    !args.isExplicit &&
    filteredRows.length === 0 &&
    args.rows.length > 0
  ) {
    return {
      rows: applyCreatorPortalDirectoryLastPostControls({
        rows: args.rows,
        lastPostAtByCreatorId: args.lastPostAtByCreatorId,
        postedWithinMonths: null,
        sortByLastPost: args.sortByLastPost,
        now: args.now,
      }),
      effectiveMonths: null,
      fallbackApplied: true,
    };
  }

  return {
    rows: filteredRows,
    effectiveMonths: args.requestedMonths,
    fallbackApplied: false,
  };
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
