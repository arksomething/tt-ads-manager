import { describe, expect, it } from "vitest";

import {
  describeEarningsStage,
  describePreviewMetric,
  getPreviewMetricValue,
  type PreviewMetric,
} from "@/lib/preview-models";

describe("preview display models", () => {
  it("keeps unavailable and restricted values distinct from real zero", () => {
    const zero: PreviewMetric<number> = { state: "available", value: 0, observedAt: "now" };
    const missing: PreviewMetric<number> = { state: "null", value: null, reason: "Not observed" };
    const restricted: PreviewMetric<number> = { state: "restricted", value: null, reason: "Provider blocked it" };

    expect(getPreviewMetricValue(zero)).toBe(0);
    expect(getPreviewMetricValue(missing)).toBeNull();
    expect(describePreviewMetric(missing)).toMatch(/^No observation/);
    expect(describePreviewMetric(restricted)).toMatch(/^Restricted by source/);
  });

  it("identifies stale observations and every payout lifecycle label", () => {
    const stale: PreviewMetric<number> = {
      state: "stale",
      value: 1200,
      observedAt: "18 hours ago",
      reason: "Refresh pending",
    };

    expect(getPreviewMetricValue(stale)).toBe(1200);
    expect(describePreviewMetric(stale)).toBe("Stale · last checked 18 hours ago");
    expect(([
      "estimated",
      "pending",
      "draft",
      "review",
      "locked",
      "paid",
      "reconciled",
    ] as const).map(describeEarningsStage)).toEqual([
      "Estimated",
      "Pending calculation",
      "Draft payout",
      "Under review",
      "Locked for payment",
      "Paid",
      "Reconciled",
    ]);
  });
});
