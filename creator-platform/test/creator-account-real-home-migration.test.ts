import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260831100000_creator_account_real_home.sql",
  ),
  "utf8",
);

describe("completed creator account destination", () => {
  it("keeps real accounts on a protected route and never sends them to a sample preview", () => {
    expect(migration).toContain("else '/account'");
    expect(migration).not.toContain("'/preview/creator'");
    expect(migration).toContain(
      "revoke execute on function public.get_creator_account_state() from public, anon;",
    );
    expect(migration).toContain(
      "grant execute on function public.get_creator_account_state() to authenticated;",
    );
  });
});
