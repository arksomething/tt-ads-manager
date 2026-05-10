export type CanonicalMetricKey =
  | "proceeds.total"
  | "proceeds.new"
  | "proceeds.renewal"
  | "proceeds.paid"
  | "proceeds.tiktok"
  | "proceeds.apple_search_ads"
  | "proceeds.organic_ugc"
  | "spend.paid.total"
  | "spend.tiktok"
  | "spend.ugc.total"
  | "spend.ugc.fixed"
  | "spend.ugc.cpm_video_pay"
  | "spend.faceless.total"
  | "spend.faceless.base"
  | "spend.faceless.management_fee"
  | "spend.faceless.cpm_management_fee"
  | "spend.faceless.fixed_management_fee"
  | "spend.faceless.dashboard_fee"
  | "views.ugc"
  | "views.faceless"
  | "installs.apple_search_ads"
  | "videos.ugc"
  | (string & {});

export type CanonicalFactUnit =
  | "currency"
  | "views"
  | "installs"
  | "videos"
  | "count";

export type CanonicalFreshness = "fresh" | "stale" | "incomplete" | "superseded";

export type CanonicalDayVersionStatus =
  | "running"
  | "succeeded"
  | "incomplete"
  | "failed"
  | "superseded";

export type CanonicalSourceStatus =
  | "ready"
  | "pending"
  | "partial"
  | "missing"
  | "failed"
  | "stale"
  | (string & {});

export type CanonicalSourceProvenance = {
  provider: string;
  providerReportId?: string | null;
  cacheKey?: string | null;
  requestedRange?: {
    startDate: string;
    endDate: string;
  } | null;
  generatedAt?: string | null;
  exportedAt?: string | null;
  status: CanonicalSourceStatus;
  warnings: string[];
  rowCount?: number | null;
  checksum?: string | null;
};

export type CanonicalFactDimensions = Record<string, string | number | boolean | null>;

export type CanonicalDailyFact = {
  organizationId: string;
  reportDate: string;
  metricKey: CanonicalMetricKey;
  value: number;
  unit: CanonicalFactUnit;
  currency?: string | null;
  source?: string | null;
  bucket?: string | null;
  dimensions?: CanonicalFactDimensions;
  provenance: CanonicalSourceProvenance[];
  dayVersionId?: string | null;
  version?: number | null;
  createdAt?: string | null;
};

export type CanonicalDayVersion = {
  id?: string | null;
  organizationId: string;
  reportDate: string;
  version: number;
  status: CanonicalDayVersionStatus;
  freshness: CanonicalFreshness;
  isCurrent: boolean;
  pricingConfigVersion?: string | null;
  sourceConfigVersion?: string | null;
  sourceState: CanonicalSourceProvenance[];
  warnings: string[];
  error?: string | null;
  facts: CanonicalDailyFact[];
  createdAt: string;
  completedAt?: string | null;
};

export type CanonicalCurrentDayFacts = {
  organizationId: string;
  reportDate: string;
  version: CanonicalDayVersion;
};

export type CanonicalSourceBreakdown = {
  metricKey: CanonicalMetricKey;
  source: string | null;
  bucket: string | null;
  dimensions: CanonicalFactDimensions;
  value: number;
  unit: CanonicalFactUnit;
  currency: string | null;
  days: string[];
  provenance: CanonicalSourceProvenance[];
  warnings: string[];
};

export type CanonicalMetricTotal = {
  metricKey: CanonicalMetricKey;
  value: number;
  unit: CanonicalFactUnit;
  currency: string | null;
  sourceBreakdown: CanonicalSourceBreakdown[];
};

export type CanonicalRangeAggregation = {
  organizationId: string;
  requestedRange: {
    startDate: string;
    endDate: string;
  };
  freshness: CanonicalFreshness;
  includedDayVersions: Array<{
    reportDate: string;
    version: number;
    status: CanonicalDayVersionStatus;
    freshness: CanonicalFreshness;
  }>;
  missingDays: string[];
  incompleteDays: string[];
  staleDays: string[];
  warnings: string[];
  sourceStatuses: CanonicalSourceProvenance[];
  totals: CanonicalMetricTotal[];
};
