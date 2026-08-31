import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("creator platform health route", () => {
  it("reports the live account-flow deployment state", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "gotall-creator-platform",
      state: "web-process-ready",
    });
  });
});
