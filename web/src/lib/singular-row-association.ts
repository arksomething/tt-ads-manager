export type SingularRowAssociationMode = "ad-id-or-name" | "exact-ad-id-only";

type SingularAssociationRow = {
  rowKey: string;
  creativeId?: string | null;
};

export function getSingularRowsForTikTokAdGroup<
  Row extends SingularAssociationRow,
>(args: {
  groupAdId: string;
  groupNameKeys: string[];
  groupIdsByNameKey: Map<string, Set<string>>;
  rowsByCreativeId: Map<string, Row[]>;
  rowsByNameKey: Map<string, Row[]>;
  mode?: SingularRowAssociationMode;
}) {
  const mode = args.mode ?? "ad-id-or-name";
  const matchedRows = new Map<string, Row>();
  const adIdRows = args.rowsByCreativeId.get(args.groupAdId) ?? [];

  for (const row of adIdRows) {
    matchedRows.set(row.rowKey, row);
  }

  let blockedNameOnlyMatch = false;

  for (const nameKey of args.groupNameKeys) {
    if ((args.groupIdsByNameKey.get(nameKey)?.size ?? 0) !== 1) {
      continue;
    }

    const nameRows = args.rowsByNameKey.get(nameKey) ?? [];

    if (mode === "exact-ad-id-only") {
      if (adIdRows.length === 0 && nameRows.length > 0) {
        blockedNameOnlyMatch = true;
      }

      continue;
    }

    for (const row of nameRows) {
      matchedRows.set(row.rowKey, row);
    }
  }

  return {
    rows: [...matchedRows.values()],
    matchedByAdId: adIdRows.length > 0,
    blockedNameOnlyMatch,
  };
}

export function canUseSingularCreativeIdAsVideoSignal(args: {
  creativeId: string;
  groupAdId: string;
  mode?: SingularRowAssociationMode;
}) {
  return (
    (args.mode ?? "ad-id-or-name") !== "exact-ad-id-only" ||
    args.creativeId !== args.groupAdId
  );
}
