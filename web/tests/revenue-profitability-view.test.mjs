import assert from "node:assert/strict";
import test from "node:test";

import { getRevenueProfitabilityRoasCopy } from "../src/lib/revenue-profitability-view.ts";

test("labels profitability proceeds and ROAS by selected proceeds model", () => {
  assert.deepEqual(
    getRevenueProfitabilityRoasCopy("new_proceeds"),
    {
      primaryProceedsLabel: "Total proceeds",
      primaryProceedsMetaKind: "new_renewal_split",
      primaryRoasLabel: "Blended ROAS",
      primaryRoasMetaProceedsLabel: "total proceeds",
      showNewProceedsRoas: true,
    },
  );

  assert.deepEqual(
    getRevenueProfitabilityRoasCopy("cohorted_all"),
    {
      primaryProceedsLabel: "Cohorted proceeds",
      primaryProceedsMetaKind: "cohorted_basis",
      primaryRoasLabel: "Cohorted ROAS",
      primaryRoasMetaProceedsLabel: "cohorted proceeds",
      showNewProceedsRoas: false,
    },
  );
});
