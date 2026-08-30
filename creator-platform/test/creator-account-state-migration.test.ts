import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260830120000_creator_account_state_fix.sql",
  ),
  "utf8",
);

describe("creator account-state SQL fix", () => {
  it("uses the projected agreement status and preserves the authenticated RPC boundary", () => {
    expect(migration).toContain(
      "when agr.status is null or agr.status <> 'completed' then '/onboarding/agreement'",
    );
    expect(migration).not.toContain("when agr.id is null");
    expect(migration).toContain(
      "grant execute on function public.get_creator_account_state() to authenticated;",
    );
  });
});
