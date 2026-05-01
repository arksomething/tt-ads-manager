function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const VIEWSBASE_SYNC_SOURCE = "viewsbase";
export const VIEWSBASE_CPM_AMOUNT = 0.5;
export const VIEWSBASE_PAYOUT_CAP_PER_VIDEO = 100;

export function isViewsBaseRawPayload(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.integrationSource === VIEWSBASE_SYNC_SOURCE ||
    value.sourceProvider === VIEWSBASE_SYNC_SOURCE
  );
}

export function getVideoDataSourceLabel(value: unknown) {
  return isViewsBaseRawPayload(value) ? "ViewsBase" : "viral.app";
}
