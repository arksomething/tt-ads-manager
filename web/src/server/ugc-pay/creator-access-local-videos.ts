type CreatorAccessPlatformAccount = {
  handle: string;
  platform: string;
};

export type CreatorAccessLocalVideoRow = {
  id: string;
  sourceVideoId: string | null;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  views: number | null;
  isTalking?: boolean;
  thumbnailUrl?: string | null;
  creator: {
    displayName: string;
    platformAccounts: CreatorAccessPlatformAccount[];
  };
};

export type CreatorAccessPaidViewRow = {
  sourceVideoId: string;
  matchedSparkItemIds: string[];
  paidViews: number;
  paidStatus: "yes" | "no" | "unsupported" | "unknown";
  paidStatusReason:
    | "exact_post_match"
    | "no_exact_post_match"
    | "no_paid_rows_in_window"
    | "ambiguous_post_mapping"
    | "unresolved_post_mapping"
    | "non_post_backed_delivery"
    | "pending_external_match"
    | "missing_tiktok_connection";
  matchedAdIds: string[];
  unresolvedPostBackedAdIds: string[];
  unresolvedNonPostBackedAdIds: string[];
  unresolvedPostBackedGroupCount: number;
  unresolvedNonPostBackedGroupCount: number;
  attributionSources: string[];
};

export type CreatorAccessPeriodViewRow = {
  sourceVideoId: string;
  views: number | null;
  currentViews?: number | null;
  titleOrCaption?: string | null;
  publishedAt?: Date | null;
  createdAt?: Date | null;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
};

export type CreatorAccessViewTallyRow = {
  id: string;
  sourceVideoId: string;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  views: number | null;
  currentViews: number | null;
  paidViews: number | null;
  organicViewsEstimate: number | null;
  paidStatus: CreatorAccessPaidViewRow["paidStatus"];
  paidStatusReason: CreatorAccessPaidViewRow["paidStatusReason"];
  matchedSparkItemIds: string[];
  matchedAdIds: string[];
  unresolvedPostBackedAdIds: string[];
  unresolvedNonPostBackedAdIds: string[];
  unresolvedPostBackedGroupCount: number;
  unresolvedNonPostBackedGroupCount: number;
  lookupWindowUnresolvedPostBackedGroupCount: number;
  lookupWindowUnresolvedNonPostBackedGroupCount: number;
  attributionSources: string[];
  creatorName: string;
  accountHandle: string | null;
  thumbnailUrl?: string;
};

type CreatorAccessPayableRow = {
  createdAt: Date;
  publishedAt: Date | null;
};

function getLocalVideoSourceVideoId(video: CreatorAccessLocalVideoRow) {
  const sourceVideoId = video.sourceVideoId?.trim();
  return sourceVideoId && sourceVideoId.length > 0 ? sourceVideoId : `local:${video.id}`;
}

function getTikTokHandle(video: CreatorAccessLocalVideoRow) {
  return (
    video.creator.platformAccounts.find((account) => account.platform === "TIKTOK")
      ?.handle ?? null
  );
}

function normalizeSourceVideoId(value: string | null | undefined) {
  const sourceVideoId = value?.trim();
  return sourceVideoId && sourceVideoId.length > 0 ? sourceVideoId : null;
}

function buildProviderVideoUrl(args: {
  accountHandle: string | null;
  sourceVideoId: string;
  videoUrl?: string | null;
}) {
  if (args.videoUrl?.trim()) {
    return args.videoUrl.trim();
  }

  const handle = args.accountHandle?.replace(/^@/, "").trim();
  return handle
    ? `https://www.tiktok.com/@${handle}/video/${args.sourceVideoId}`
    : `https://www.tiktok.com/@unknown/video/${args.sourceVideoId}`;
}

function buildProviderOnlyVideo(args: {
  accountHandle: string | null;
  creatorName: string;
  periodRow: CreatorAccessPeriodViewRow;
  periodStart: Date;
}): CreatorAccessLocalVideoRow | null {
  const sourceVideoId = normalizeSourceVideoId(args.periodRow.sourceVideoId);

  if (!sourceVideoId || (args.periodRow.views ?? 0) <= 0) {
    return null;
  }

  const createdAt =
    args.periodRow.createdAt ??
    args.periodRow.publishedAt ??
    args.periodStart;

  return {
    id: `provider:${sourceVideoId}`,
    sourceVideoId,
    videoUrl: buildProviderVideoUrl({
      accountHandle: args.accountHandle,
      sourceVideoId,
      videoUrl: args.periodRow.videoUrl,
    }),
    titleOrCaption: args.periodRow.titleOrCaption ?? null,
    publishedAt: args.periodRow.publishedAt ?? null,
    createdAt,
    views: args.periodRow.currentViews ?? args.periodRow.views ?? null,
    thumbnailUrl: args.periodRow.thumbnailUrl ?? null,
    creator: {
      displayName: args.creatorName,
      platformAccounts: args.accountHandle
        ? [{ handle: args.accountHandle, platform: "TIKTOK" }]
        : [],
    },
  };
}

export function getCreatorAccessPaidLookupSourceVideoIds(
  videos: CreatorAccessLocalVideoRow[],
) {
  return [
    ...new Set(
      videos
        .map((video) => video.sourceVideoId?.trim())
        .filter((sourceVideoId): sourceVideoId is string =>
          Boolean(sourceVideoId && sourceVideoId.length > 0),
        ),
    ),
  ];
}

export function getCreatorAccessMissingSourceVideoCount(
  videos: CreatorAccessLocalVideoRow[],
) {
  return videos.filter(
    (video) =>
      !video.id.startsWith("provider:") && !normalizeSourceVideoId(video.sourceVideoId),
  ).length;
}

function getCreatorAccessVideoActivityDate(video: CreatorAccessPayableRow) {
  return video.publishedAt ?? video.createdAt;
}

function isCreatorAccessVideoPostedInPeriod(args: {
  video: CreatorAccessPayableRow;
  periodStart: Date;
  periodEndExclusive: Date;
}) {
  const activityDate = getCreatorAccessVideoActivityDate(args.video);

  return (
    activityDate >= args.periodStart &&
    activityDate < args.periodEndExclusive
  );
}

export function filterCreatorAccessLedgerVideos(args: {
  videos: CreatorAccessLocalVideoRow[];
  periodRows?: CreatorAccessPeriodViewRow[];
  periodStart: Date;
  periodEndExclusive: Date;
}) {
  const periodRowsWithViews = new Set(
    (args.periodRows ?? [])
      .filter((row) => (row.views ?? 0) > 0)
      .map((row) => normalizeSourceVideoId(row.sourceVideoId))
      .filter((sourceVideoId): sourceVideoId is string => Boolean(sourceVideoId)),
  );

  return args.videos.filter((video) => {
    if (isCreatorAccessVideoPostedInPeriod({
      video,
      periodStart: args.periodStart,
      periodEndExclusive: args.periodEndExclusive,
    })) {
      return true;
    }

    const sourceVideoId = video.sourceVideoId?.trim();

    return sourceVideoId ? periodRowsWithViews.has(sourceVideoId) : false;
  });
}

export function filterCreatorAccessPayableRowsByMode<
  Row extends CreatorAccessPayableRow,
>(args: {
  payMode: "gained" | "posted";
  rows: Row[];
  periodStart: Date;
  periodEndExclusive: Date;
}) {
  if (args.payMode === "gained") {
    return args.rows;
  }

  return args.rows.filter((row) =>
    isCreatorAccessVideoPostedInPeriod({
      video: row,
      periodStart: args.periodStart,
      periodEndExclusive: args.periodEndExclusive,
    }),
  );
}

export function buildCreatorAccessLedgerVideos(args: {
  accountHandle: string | null;
  creatorName: string;
  videos: CreatorAccessLocalVideoRow[];
  periodRows?: CreatorAccessPeriodViewRow[];
  periodStart: Date;
  periodEndExclusive: Date;
}) {
  const localLedgerVideos = filterCreatorAccessLedgerVideos({
    videos: args.videos,
    periodRows: args.periodRows,
    periodStart: args.periodStart,
    periodEndExclusive: args.periodEndExclusive,
  });
  const localSourceVideoIds = new Set(
    localLedgerVideos
      .map((video) => normalizeSourceVideoId(video.sourceVideoId))
      .filter((sourceVideoId): sourceVideoId is string => Boolean(sourceVideoId)),
  );
  const providerSourceVideoIds = new Set<string>();
  const providerOnlyVideos = (args.periodRows ?? [])
    .filter((row) => {
      const sourceVideoId = normalizeSourceVideoId(row.sourceVideoId);

      if (
        !sourceVideoId ||
        localSourceVideoIds.has(sourceVideoId) ||
        providerSourceVideoIds.has(sourceVideoId)
      ) {
        return false;
      }

      providerSourceVideoIds.add(sourceVideoId);
      return true;
    })
    .map((periodRow) =>
      buildProviderOnlyVideo({
        accountHandle: args.accountHandle,
        creatorName: args.creatorName,
        periodRow,
        periodStart: args.periodStart,
      }),
    )
    .filter((video): video is CreatorAccessLocalVideoRow => Boolean(video));

  return [...localLedgerVideos, ...providerOnlyVideos];
}

export function buildCreatorAccessViewTallyRows(args: {
  videos: CreatorAccessLocalVideoRow[];
  periodRows?: CreatorAccessPeriodViewRow[];
  paidRows: CreatorAccessPaidViewRow[];
  lookupWindowUnresolvedPostBackedGroupCount?: number;
  lookupWindowUnresolvedNonPostBackedGroupCount?: number;
}) {
  const paidRowsBySourceVideoId = new Map(
    args.paidRows.map((row) => [row.sourceVideoId, row]),
  );
  const periodRowsBySourceVideoId = new Map(
    (args.periodRows ?? []).map((row) => [row.sourceVideoId, row]),
  );

  return args.videos.map((video) => {
    const localSourceVideoId = getLocalVideoSourceVideoId(video);
    const paidRow = video.sourceVideoId
      ? (paidRowsBySourceVideoId.get(video.sourceVideoId) ?? null)
      : null;
    const periodRow = video.sourceVideoId
      ? (periodRowsBySourceVideoId.get(video.sourceVideoId) ?? null)
      : null;
    const periodViews = periodRow ? (periodRow.views ?? 0) : 0;
    const currentViews =
      periodRow?.currentViews ??
      video.views ??
      (periodViews > 0 ? periodViews : null);
    const isExactPostAnswerKnown =
      paidRow?.paidStatus === "yes" || paidRow?.paidStatus === "no";
    const paidViews = isExactPostAnswerKnown ? (paidRow?.paidViews ?? 0) : null;
    const organicViewsEstimate =
      typeof paidViews === "number" ? Math.max(periodViews - paidViews, 0)
        : null;

    return {
      id: video.id,
      sourceVideoId: localSourceVideoId,
      videoUrl: periodRow?.videoUrl ?? video.videoUrl,
      titleOrCaption: periodRow?.titleOrCaption ?? video.titleOrCaption,
      publishedAt: periodRow?.publishedAt ?? video.publishedAt,
      createdAt: video.createdAt,
      views: periodViews,
      currentViews,
      paidViews,
      organicViewsEstimate,
      paidStatus: paidRow?.paidStatus ?? "unknown",
      paidStatusReason: paidRow?.paidStatusReason ?? "unresolved_post_mapping",
      matchedSparkItemIds: paidRow?.matchedSparkItemIds ?? [],
      matchedAdIds: paidRow?.matchedAdIds ?? [],
      unresolvedPostBackedAdIds: paidRow?.unresolvedPostBackedAdIds ?? [],
      unresolvedNonPostBackedAdIds: paidRow?.unresolvedNonPostBackedAdIds ?? [],
      unresolvedPostBackedGroupCount: paidRow?.unresolvedPostBackedGroupCount ?? 0,
      unresolvedNonPostBackedGroupCount:
        paidRow?.unresolvedNonPostBackedGroupCount ?? 0,
      lookupWindowUnresolvedPostBackedGroupCount:
        args.lookupWindowUnresolvedPostBackedGroupCount ?? 0,
      lookupWindowUnresolvedNonPostBackedGroupCount:
        args.lookupWindowUnresolvedNonPostBackedGroupCount ?? 0,
      attributionSources: paidRow?.attributionSources ?? [],
      creatorName: video.creator.displayName,
      accountHandle: getTikTokHandle(video),
      thumbnailUrl: periodRow?.thumbnailUrl ?? video.thumbnailUrl ?? undefined,
    } satisfies CreatorAccessViewTallyRow;
  });
}
