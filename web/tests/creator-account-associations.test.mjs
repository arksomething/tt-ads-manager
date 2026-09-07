import assert from "node:assert/strict";
import test from "node:test";

import { resolveLinkedProviderAccountIds } from "../src/lib/creator-account-associations.ts";

const providerAccounts = [
  {
    id: "provider-influ-rx",
    platformAccountId: "75739384692",
    username: "influ.rx",
  },
  {
    id: "provider-abdul",
    platformAccountId: "15268702185",
    username: "gotall.abdul",
  },
  {
    id: "provider-brand",
    platformAccountId: "75440693273",
    username: "gotallapp",
  },
];

test("resolves a differently named Instagram account through its explicit creator link", () => {
  assert.deepEqual(
    resolveLinkedProviderAccountIds({
      creatorIds: ["clubgrowth"],
      localAccounts: [
        {
          creatorId: "clubgrowth",
          handle: "influ.rx",
          sourceAccountId: "75739384692",
        },
      ],
      providerAccounts,
    }),
    ["provider-influ-rx"],
  );
});

test("uses the stable native account ID after an Instagram username change", () => {
  assert.deepEqual(
    resolveLinkedProviderAccountIds({
      creatorIds: ["clubgrowth"],
      localAccounts: [
        {
          creatorId: "clubgrowth",
          handle: "old.influ.rx",
          sourceAccountId: "75739384692",
        },
      ],
      providerAccounts,
    }),
    ["provider-influ-rx"],
  );
});

test("keeps a handle fallback only for legacy links without a source account ID", () => {
  assert.deepEqual(
    resolveLinkedProviderAccountIds({
      creatorIds: ["abdul"],
      localAccounts: [
        {
          creatorId: "abdul",
          handle: "@GoTall.Abdul",
          sourceAccountId: null,
        },
      ],
      providerAccounts,
    }),
    ["provider-abdul"],
  );
});

test("excludes unassigned brand accounts and accounts linked to another creator", () => {
  assert.deepEqual(
    resolveLinkedProviderAccountIds({
      creatorIds: ["clubgrowth"],
      localAccounts: [
        {
          creatorId: "clubgrowth",
          handle: "influ.rx",
          sourceAccountId: "75739384692",
        },
        {
          creatorId: "abdul",
          handle: "gotall.abdul",
          sourceAccountId: "15268702185",
        },
      ],
      providerAccounts,
    }),
    ["provider-influ-rx"],
  );
});
