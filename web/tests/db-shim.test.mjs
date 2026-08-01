import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const authorCount = 1500;
const bookCount = 2600;

const authors = Array.from({ length: authorCount }, (_, index) => ({
  id: `author-${index}`,
  name: `Author ${index}`,
  active: index % 2 === 0,
  createdAt: new Date(Date.UTC(2026, 0, 1 + (index % 28))).toISOString(),
}));

const books = Array.from({ length: bookCount }, (_, index) => ({
  id: `book-${index}`,
  authorId: index % 97 === 0 ? null : `author-${index % authorCount}`,
  title: `Book ${index}`,
  published: index % 3 === 0,
  views: index,
  createdAt: new Date(Date.UTC(2026, 1, 1 + (index % 28))).toISOString(),
}));

globalThis.__dbShimTestTables = {
  Author: authors,
  Book: books,
};
globalThis.__dbShimTestRequests = [];

const schemaMock = `
const scalar = (type, isOptional = false) => ({
  kind: "scalar",
  type,
  isList: false,
  isOptional,
});
const relationField = (type, isList) => ({
  kind: "relation",
  type,
  isList,
  isOptional: true,
});

export const modelSchema = {
  Author: {
    table: "Author",
    fields: {
      id: scalar("String"),
      name: scalar("String"),
      active: scalar("Boolean"),
      createdAt: scalar("DateTime"),
      books: relationField("Book", true),
    },
    relations: {
      books: {
        model: "Book",
        isList: true,
        localFields: ["id"],
        remoteFields: ["authorId"],
      },
    },
  },
  Book: {
    table: "Book",
    fields: {
      id: scalar("String"),
      authorId: scalar("String", true),
      title: scalar("String"),
      published: scalar("Boolean"),
      views: scalar("Int"),
      createdAt: scalar("DateTime"),
      author: relationField("Author", false),
    },
    relations: {
      author: {
        model: "Author",
        isList: false,
        localFields: ["authorId"],
        remoteFields: ["id"],
      },
    },
  },
  Ghost: {
    table: "Ghost",
    fields: {
      id: scalar("String"),
    },
    relations: {},
  },
};
`;

const supabaseMock = `
class FakeQuery {
  constructor(table) {
    this.table = table;
    this.rangeFrom = null;
    this.rangeTo = null;
    this.wantCount = false;
  }

  select(_columns, options) {
    this.wantCount = Boolean(options && options.count);
    return this;
  }

  range(from, to) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  order() {
    return this;
  }

  then(resolve, reject) {
    try {
      const rows = globalThis.__dbShimTestTables[this.table];

      globalThis.__dbShimTestRequests.push({
        table: this.table,
        from: this.rangeFrom,
        to: this.rangeTo,
      });

      if (!rows) {
        resolve({
          data: null,
          error: { code: "PGRST205", message: "table missing" },
          count: null,
        });
        return;
      }

      const slice =
        this.rangeTo == null
          ? rows
          : rows.slice(this.rangeFrom ?? 0, this.rangeTo + 1);

      resolve({
        data: slice.map((row) => ({ ...row })),
        error: null,
        count: this.wantCount ? rows.length : null,
      });
    } catch (error) {
      reject(error);
    }
  }
}

export function createClient() {
  return {
    from(table) {
      return new FakeQuery(table);
    },
  };
}
`;

const mockModules = new Map([
  ["@/lib/db-schema.generated", schemaMock],
  ["@supabase/supabase-js", supabaseMock],
  [
    "@/lib/server-env",
    `
export function getSupabaseDatabaseEnv() {
  return {
    SUPABASE_URL: "http://supabase.test",
    SUPABASE_SERVER_KEY: "test-key",
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

const { prisma } = await import("../src/lib/db.ts");

test("findMany with include resolves every to-one relation exactly", async () => {
  const rows = await prisma.book.findMany({ include: { author: true } });

  assert.equal(rows.length, bookCount);

  for (const row of rows) {
    if (row.authorId === null) {
      assert.equal(row.author, null);
    } else {
      assert.ok(row.author, `book ${row.id} is missing its author`);
      assert.equal(row.author.id, row.authorId);
    }
  }

  assert.ok(rows[0].createdAt instanceof Date);
});

test("findMany with include resolves to-many relations in table order", async () => {
  const rows = await prisma.author.findMany({ include: { books: true } });

  assert.equal(rows.length, authorCount);

  const expectedForAuthor0 = books
    .filter((book) => book.authorId === "author-0")
    .map((book) => book.id);
  const author0 = rows.find((row) => row.id === "author-0");

  assert.deepEqual(
    author0.books.map((book) => book.id),
    expectedForAuthor0,
  );
});

test("relation where filters match an independent reimplementation", async () => {
  const rows = await prisma.author.findMany({
    where: {
      books: {
        some: {
          published: true,
          views: { gt: 2000 },
        },
      },
    },
  });

  const expectedIds = authors
    .filter((author) =>
      books.some(
        (book) =>
          book.authorId === author.id && book.published && book.views > 2000,
      ),
    )
    .map((author) => author.id);

  assert.deepEqual(
    rows.map((row) => row.id),
    expectedIds,
  );
  assert.ok(rows.length > 0);
});

test("OR filters with ordering, skip, and take match an independent reimplementation", async () => {
  const rows = await prisma.book.findMany({
    where: {
      OR: [{ views: { lt: 5 } }, { title: { contains: "Book 259" } }],
    },
    orderBy: { views: "desc" },
    skip: 2,
    take: 5,
  });

  const expectedIds = books
    .filter((book) => book.views < 5 || book.title.includes("Book 259"))
    .sort((left, right) => right.views - left.views)
    .slice(2, 7)
    .map((book) => book.id);

  assert.deepEqual(
    rows.map((row) => row.id),
    expectedIds,
  );
  assert.equal(rows.length, 5);
});

test("full-table loads fetch each page exactly once", () => {
  const requests = globalThis.__dbShimTestRequests;
  const bookRequests = requests.filter((request) => request.table === "Book");
  const authorRequests = requests.filter((request) => request.table === "Author");

  const uniqueRanges = (tableRequests) =>
    new Set(tableRequests.map((request) => `${request.from}-${request.to}`));

  assert.equal(
    bookRequests.length,
    uniqueRanges(bookRequests).size,
    "duplicate Book page fetches indicate the table cache did not dedupe loads",
  );
  assert.equal(
    authorRequests.length,
    uniqueRanges(authorRequests).size,
    "duplicate Author page fetches indicate the table cache did not dedupe loads",
  );

  const coveredBookRows = bookRequests.reduce(
    (total, request) => total + Math.min(request.to + 1, bookCount) - request.from,
    0,
  );

  assert.ok(
    coveredBookRows >= bookCount,
    "page fetches did not cover the whole Book table",
  );
});

test("findMany on a missing table returns an empty list", async () => {
  const rows = await prisma.ghost.findMany({ where: { OR: [{ id: "x" }] } });

  assert.deepEqual(rows, []);
});
