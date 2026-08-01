import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function localTsUrl(path) {
  const resolved = resolvePath(path);
  return pathToFileURL(extname(resolved) ? resolved : `${resolved}.ts`).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
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

const { fetchPagesWithReplay } = await import("../src/lib/paged-fetch.ts");

// The sequential loop shape fetchPagesWithReplay replaces. The replay must
// consume the exact same page sequence and produce the same final totalPages.
async function sequentialReference({ fetchPage, getPageInfo, pageSize, maxPages }) {
  const pages = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= maxPages; page += 1) {
    const payload = await fetchPage(page);
    const pageInfo = getPageInfo(payload);
    pages.push(payload);
    totalPages = pageInfo.totalPages;

    if (pageInfo.rowCount < pageSize) {
      break;
    }
  }

  return { pages, totalPages };
}

function buildScenario(pageSpecs, pageSize) {
  return {
    fetchPage: async (page) => {
      const spec = pageSpecs[page - 1] ?? { rowCount: 0, totalPages: pageSpecs.length };
      return { page, ...spec };
    },
    getPageInfo: (payload) => ({
      rowCount: payload.rowCount,
      totalPages: payload.totalPages,
    }),
    pageSize,
  };
}

async function assertMatchesSequential(pageSpecs, { pageSize, maxPages }) {
  const scenario = buildScenario(pageSpecs, pageSize);
  const expected = await sequentialReference({ ...scenario, maxPages });
  const actual = await fetchPagesWithReplay({
    ...scenario,
    maxPages,
    concurrency: 3,
  });

  assert.deepEqual(actual.pages, expected.pages);
  assert.equal(actual.totalPages, expected.totalPages);
}

test("replay matches sequential pagination for a single short page", async () => {
  await assertMatchesSequential(
    [{ rowCount: 4, totalPages: 1 }],
    { pageSize: 10, maxPages: 20 },
  );
});

test("replay matches sequential pagination across full pages with a short tail", async () => {
  await assertMatchesSequential(
    [
      { rowCount: 10, totalPages: 3 },
      { rowCount: 10, totalPages: 3 },
      { rowCount: 5, totalPages: 3 },
    ],
    { pageSize: 10, maxPages: 20 },
  );
});

test("replay matches sequential pagination when every page is exactly full", async () => {
  await assertMatchesSequential(
    [
      { rowCount: 10, totalPages: 2 },
      { rowCount: 10, totalPages: 2 },
    ],
    { pageSize: 10, maxPages: 20 },
  );
});

test("replay stops at a short middle page exactly like the sequential loop", async () => {
  await assertMatchesSequential(
    [
      { rowCount: 10, totalPages: 4 },
      { rowCount: 3, totalPages: 4 },
      { rowCount: 10, totalPages: 4 },
      { rowCount: 10, totalPages: 4 },
    ],
    { pageSize: 10, maxPages: 20 },
  );
});

test("replay honors totalPages growing after the first page", async () => {
  await assertMatchesSequential(
    [
      { rowCount: 10, totalPages: 2 },
      { rowCount: 10, totalPages: 4 },
      { rowCount: 10, totalPages: 4 },
      { rowCount: 2, totalPages: 4 },
    ],
    { pageSize: 10, maxPages: 20 },
  );
});

test("replay honors totalPages shrinking after the first page", async () => {
  await assertMatchesSequential(
    [
      { rowCount: 10, totalPages: 5 },
      { rowCount: 10, totalPages: 2 },
      { rowCount: 10, totalPages: 5 },
    ],
    { pageSize: 10, maxPages: 20 },
  );
});

test("replay caps at maxPages exactly like the sequential loop", async () => {
  await assertMatchesSequential(
    Array.from({ length: 8 }, () => ({ rowCount: 10, totalPages: 8 })),
    { pageSize: 10, maxPages: 3 },
  );
});
