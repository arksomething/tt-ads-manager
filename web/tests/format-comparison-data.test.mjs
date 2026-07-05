import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const revenueMock = `
export const capturedRevenueArgs = [];
let mockSingularPending = false;

export function setMockSingularPending(value) {
  mockSingularPending = Boolean(value);
}

export function getRevenueProceedsModelConfig(model) {
  return {
    dateBasisLabel: model === "cohorted_all" ? "install cohort date" : "purchase date",
    shortLabel: model === "cohorted_all" ? "Cohorted all" : "New",
  };
}

export async function getRevenueAttributionReport(args) {
  capturedRevenueArgs.push(args);

  return {
    configured: true,
    currency: "USD",
    dailyRows: [
      {
        date: "2026-05-24",
        organic: 120,
        tiktok: 30,
      },
    ],
    proceedsModel: args.proceedsModel,
    singularPending: mockSingularPending,
    warnings: [],
  };
}
`;

const mockModules = new Map([
  [
    "next/cache",
    `
export function revalidatePath() {}
`,
  ],
  [
    "@/lib/db",
    `
export const prisma = {
  videoContentClassification: {
    async findMany() {
      return [];
    },
  },
};
`,
  ],
  [
    "@/lib/prisma-shim",
    `
export const Platform = {
  TIKTOK: "TIKTOK",
};
`,
  ],
  [
    "@/server/auth/organizations",
    `
export async function requireOrganizationMembership() {
  return {
    organizationId: "org-1",
    role: "BLAZIE",
  };
}
`,
  ],
  [
    "@/server/revenue/revenue",
    revenueMock,
  ],
  [
    "@/server/ugc-pay/queries",
    `
export const capturedUgcPayArgs = [];

export async function getOrganizationUgcPayData(args) {
  capturedUgcPayArgs.push(args);

  return {
    errorMessage: null,
    selectedCampaignLabel: "All Tracked Creators",
    videos: args.searchParams.startDate === "2026-05-24"
      ? [
          {
            creatorName: "Creator",
            grossViews: 1000,
            paidViews: 200,
            sourceVideoId: "video-1",
            thumbnailUrl: null,
            titleOrCaption: "Video 1",
            videoId: "fallback-1",
            videoUrl: null,
          },
        ]
      : [],
    warnings: [],
  };
}
`,
  ],
]);

function localTsUrl(path) {
  const resolved = resolvePath(path);
  return pathToFileURL(extname(resolved) ? resolved : `${resolved}.ts`).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mockModules.get(specifier);

    if (mock) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(mock)}`,
      };
    }

    if (specifier.startsWith("@/")) {
      return nextResolve(localTsUrl(resolvePath("src", specifier.slice(2))), context);
    }

    if (specifier.startsWith(".") && !extname(specifier)) {
      return nextResolve(
        localTsUrl(new URL(specifier, context.parentURL).pathname),
        context,
      );
    }

    return nextResolve(specifier, context);
  },
});

test("format comparison always uses cohorted all TikTok-video proceeds", async () => {
  const { getFormatComparisonData } = await import(
    "../src/server/dashboard/format-comparison.ts"
  );
  const { capturedRevenueArgs } = await import("@/server/revenue/revenue");

  capturedRevenueArgs.length = 0;

  const data = await getFormatComparisonData({
    endDate: "2026-05-24",
    organizationSlug: "gotall",
    searchParams: {
      revenueModel: "new_proceeds",
    },
    startDate: "2026-05-24",
  });

  assert.equal(capturedRevenueArgs.length, 1);
  assert.equal(capturedRevenueArgs[0].proceedsModel, "cohorted_all");
  assert.equal(data.proceedsModel, "cohorted_all");
  assert.equal(data.proceedsModelLabel, "Cohorted all");
  assert.equal(data.proceedsDateBasisLabel, "install cohort date");
  assert.equal(data.isPending, false);
  assert.equal(data.summary.revenue, 150);
  assert.equal(data.summary.views, 1000);
});

test("format comparison fetches a lightweight candidate pool for each daily UGC Pay load", async () => {
  const { getFormatComparisonData } = await import(
    "../src/server/dashboard/format-comparison.ts"
  );
  const { capturedUgcPayArgs } = await import("@/server/ugc-pay/queries");

  capturedUgcPayArgs.length = 0;

  await getFormatComparisonData({
    endDate: "2026-05-26",
    organizationSlug: "gotall",
    searchParams: {},
    startDate: "2026-05-24",
  });

  assert.equal(capturedUgcPayArgs.length, 3);

  for (const args of capturedUgcPayArgs) {
    assert.equal(args.includePaidViews, false);
    assert.equal(args.topVideoLimit, 25);
    assert.equal(args.searchParams.topLimit, "25");
  }
});

test("format comparison marks data pending while source proceeds are preparing", async () => {
  const { getFormatComparisonData } = await import(
    "../src/server/dashboard/format-comparison.ts"
  );
  const { setMockSingularPending } = await import("@/server/revenue/revenue");

  setMockSingularPending(true);

  try {
    const data = await getFormatComparisonData({
      endDate: "2026-05-24",
      organizationSlug: "gotall",
      searchParams: {},
      startDate: "2026-05-24",
    });

    assert.equal(data.isPending, true);
  } finally {
    setMockSingularPending(false);
  }
});
