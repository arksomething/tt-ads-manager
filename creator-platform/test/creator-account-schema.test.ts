import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260830102000_creator_accounts.sql",
  ),
  "utf8",
);

const creatorTables = [
  "creator_accounts",
  "creator_applications",
  "creator_application_handles",
  "program_deal_versions",
  "staff_members",
  "creator_enrollments",
  "agreement_records",
  "agreement_events",
  "creator_application_events",
  "creator_claim_invitations",
] as const;

describe("creator account database contract", () => {
  it("enables RLS for every account and agreement table", () => {
    for (const table of creatorTables) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }

    expect(migration).toContain(
      "revoke all on all tables in schema public from anon, authenticated;",
    );
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)\s+on/i);
  });

  it("derives applications from verified auth users in one RPC", () => {
    expect(migration).toContain(
      "function public.submit_creator_application(application_input jsonb)",
    );
    expect(migration).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain("if current_user_confirmed_at is null then");
    expect(migration).toContain(
      "One of those creator handles is already connected to another account.",
    );
    expect(migration).toContain(
      "grant execute on function public.submit_creator_application(jsonb) to authenticated;",
    );
  });

  it("keeps approval and agreement completion out of creator control", () => {
    expect(migration).toContain(
      "function public.approve_creator_application(target_application_id uuid)",
    );
    expect(migration).toContain("Reviewer access required.");
    expect(migration).toContain(
      "No active default deal version is configured.",
    );
    expect(migration).toContain(
      "Browser return URLs are never authoritative completion evidence.",
    );
    expect(migration).not.toContain(
      "grant execute on function public.approve_creator_application(uuid) to anon",
    );
  });
});
