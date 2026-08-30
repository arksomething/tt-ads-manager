export type PreviewMetric<T> =
  | {
      state: "available";
      value: T;
      observedAt: string;
    }
  | {
      state: "stale";
      value: T;
      observedAt: string;
      reason: string;
    }
  | {
      state: "null";
      value: null;
      reason: string;
    }
  | {
      state: "restricted";
      value: null;
      reason: string;
    };

export type EarningsStage =
  | "estimated"
  | "pending"
  | "draft"
  | "review"
  | "locked"
  | "paid"
  | "reconciled";

export interface CreatorDashboardSample {
  creator: {
    firstName: string;
    initial: string;
    streakDays: number;
  };
  metrics: {
    verifiedViews: PreviewMetric<number>;
    estimatedEarningsMinor: PreviewMetric<number>;
    postsThisWeek: PreviewMetric<number>;
    sevenDayBaseline: PreviewMetric<number>;
    instagramReach: PreviewMetric<number>;
  };
  earningsStage: EarningsStage;
  weeklyPostGoal: number;
}

export const creatorDashboardSample = {
  creator: {
    firstName: "Dylan",
    initial: "D",
    streakDays: 12,
  },
  metrics: {
    verifiedViews: {
      state: "available",
      value: 2_401_234,
      observedAt: "12 minutes ago",
    },
    estimatedEarningsMinor: {
      state: "stale",
      value: 84_216,
      observedAt: "18 hours ago",
      reason: "The latest payout calculation has not completed.",
    },
    postsThisWeek: {
      state: "available",
      value: 2,
      observedAt: "12 minutes ago",
    },
    sevenDayBaseline: {
      state: "null",
      value: null,
      reason: "This sample post does not have a complete seven-day window yet.",
    },
    instagramReach: {
      state: "restricted",
      value: null,
      reason: "Instagram did not expose this metric to the connected source.",
    },
  },
  earningsStage: "estimated",
  weeklyPostGoal: 3,
} satisfies CreatorDashboardSample;

export function getPreviewMetricValue<T>(metric: PreviewMetric<T>) {
  return metric.state === "available" || metric.state === "stale"
    ? metric.value
    : null;
}

export function describePreviewMetric(metric: PreviewMetric<unknown>) {
  switch (metric.state) {
    case "available":
      return `Available · checked ${metric.observedAt}`;
    case "stale":
      return `Stale · last checked ${metric.observedAt}`;
    case "null":
      return `No observation · ${metric.reason}`;
    case "restricted":
      return `Restricted by source · ${metric.reason}`;
  }
}

export function describeEarningsStage(stage: EarningsStage) {
  switch (stage) {
    case "estimated":
      return "Estimated";
    case "pending":
      return "Pending calculation";
    case "draft":
      return "Draft payout";
    case "review":
      return "Under review";
    case "locked":
      return "Locked for payment";
    case "paid":
      return "Paid";
    case "reconciled":
      return "Reconciled";
  }
}
