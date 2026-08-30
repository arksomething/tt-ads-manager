import { describe, expect, it } from "vitest";

import { describeFreshness, formatObservedCount, formatObservedMoney } from "@/lib/display-values";

describe("truthful metric display", () => {
  it("renders missing evidence as unknown instead of zero", () => {
    expect(formatObservedCount(null)).toBe("—");
    expect(formatObservedMoney(undefined)).toBe("—");
  });

  it("preserves a real observed zero", () => {
    expect(formatObservedCount(0)).toBe("0");
    expect(formatObservedMoney(0)).toBe("$0.00");
  });

  it("keeps stale and incomplete states explicit", () => {
    expect(describeFreshness("stale")).toBe("Tracking is stale");
    expect(describeFreshness("incomplete")).toBe("Tracking needs review");
  });
});
