export type CreatorPortalFeedSort = "views" | "date";

type SortableCreatorPortalFeedVideo = {
  createdAt: Date | string;
  grossViews: number;
  payableViews: number;
  publishedAt: Date | string | null;
  titleOrCaption: string | null;
  videoPay: number;
};

export function getCreatorPortalFeedSort(
  value: string | null | undefined,
): CreatorPortalFeedSort {
  return value === "date" ? "date" : "views";
}

function getVideoDateMs(video: SortableCreatorPortalFeedVideo) {
  const value = video.publishedAt ?? video.createdAt;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function compareVideoTitles(
  left: SortableCreatorPortalFeedVideo,
  right: SortableCreatorPortalFeedVideo,
) {
  return (left.titleOrCaption ?? "").localeCompare(right.titleOrCaption ?? "");
}

export function sortCreatorPortalFeedVideos<
  Video extends SortableCreatorPortalFeedVideo,
>(videos: Video[], sort: CreatorPortalFeedSort): Video[] {
  return [...videos].sort((left, right) => {
    if (sort === "date") {
      return (
        getVideoDateMs(right) - getVideoDateMs(left) ||
        right.grossViews - left.grossViews ||
        compareVideoTitles(left, right)
      );
    }

    return (
      right.grossViews - left.grossViews ||
      right.payableViews - left.payableViews ||
      getVideoDateMs(right) - getVideoDateMs(left) ||
      right.videoPay - left.videoPay ||
      compareVideoTitles(left, right)
    );
  });
}
