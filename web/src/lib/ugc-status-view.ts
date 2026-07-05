export type UgcStatusViewVariant = "default" | "blazie";

export function getInitialDetailedStatisticsOpen(
  _variant: UgcStatusViewVariant = "default",
) {
  return false;
}

export function getNextExpandedUgcStatusDates(
  currentDates: readonly string[],
  toggledDate: string,
) {
  return currentDates.includes(toggledDate)
    ? currentDates.filter((date) => date !== toggledDate)
    : [...currentDates, toggledDate];
}

export function getTikTokEmbedPostId(args: {
  sourceVideoId?: string | null;
  url?: string | null;
}) {
  const sourceVideoId = args.sourceVideoId?.trim();

  if (sourceVideoId && /^\d+$/.test(sourceVideoId)) {
    return sourceVideoId;
  }

  const urlVideoId = args.url?.match(/\/video\/(\d+)/i)?.[1];
  return urlVideoId ?? null;
}

export function getTikTokEmbedPlayerUrl(postId: string) {
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(postId)}`;
}

export function getUgcStatusVideoViewShare(
  videoViews: number,
  totalViews: number,
) {
  if (
    !Number.isFinite(videoViews) ||
    !Number.isFinite(totalViews) ||
    totalViews <= 0
  ) {
    return null;
  }

  return Math.min(Math.max(videoViews, 0) / totalViews, 1);
}
