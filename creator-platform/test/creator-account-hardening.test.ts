import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const initialMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260830102000_creator_accounts.sql",
  ),
  "utf8",
);

const hardeningMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260830113000_creator_account_hardening.sql",
  ),
  "utf8",
);

function section(from: string, until: string) {
  const start = hardeningMigration.indexOf(from);
  const end = hardeningMigration.indexOf(until, start + from.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return hardeningMigration.slice(start, end);
}

describe("creator account hardening migration", () => {
  it("makes application submission one-shot in every existing state", () => {
    const submitRpc = section(
      "create or replace function public.submit_creator_application",
      "create or replace function public.get_own_creator_application",
    );

    expect(submitRpc).toContain("if existing_application_id is not null then");
    expect(submitRpc).toContain(
      "An application has already been submitted for this account.",
    );
    expect(submitRpc).not.toContain("on conflict (account_id) do update");
    expect(submitRpc).not.toContain(
      "delete from public.creator_application_handles",
    );
    expect(submitRpc).not.toContain("reviewed_by = null");
    expect(submitRpc).not.toContain("review_note = null");
  });

  it("treats application handles as provisional claims", () => {
    expect(initialMigration).toContain(
      "unique (application_id, platform, normalized_handle)",
    );
    expect(hardeningMigration).toContain(
      "pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (platform, normalized_handle)'",
    );
    expect(hardeningMigration).toContain(
      "alter table public.creator_application_handles drop constraint",
    );
    expect(hardeningMigration).toContain(
      "create table if not exists public.creator_platform_accounts",
    );
    expect(hardeningMigration).toContain(
      "alter table public.creator_platform_accounts enable row level security;",
    );
    expect(hardeningMigration).toContain(
      "revoke all on public.creator_platform_accounts from public, anon, authenticated;",
    );
    expect(hardeningMigration).toContain(
      "unique (platform, native_account_id)",
    );
    expect(hardeningMigration).not.toContain(
      "unique (platform, normalized_handle)",
    );
  });

  it("exposes an applicant-safe application snapshot", () => {
    const ownApplicationRpc = section(
      "create or replace function public.get_own_creator_application",
      "revoke select on public.creator_applications",
    );

    expect(hardeningMigration).toContain(
      "revoke select on public.creator_applications from public, anon, authenticated;",
    );
    expect(hardeningMigration).toContain(
      "revoke select on public.creator_application_handles from public, anon, authenticated;",
    );
    expect(hardeningMigration).toContain(
      "grant execute on function public.get_own_creator_application() to authenticated;",
    );
    expect(ownApplicationRpc).not.toContain("reviewed_by");
    expect(ownApplicationRpc).not.toContain("review_note");
    expect(ownApplicationRpc).toContain("application_record.account_id = current_user_id");
    expect(initialMigration).toContain(
      "function public.get_creator_account_state()",
    );
  });

  it("rotates default deals without changing finalized legal content", () => {
    expect(hardeningMigration).toContain(
      "constraint program_deal_versions_default_requires_active",
    );
    expect(hardeningMigration).toContain(
      "check (not is_default or status = 'active')",
    );
    expect(hardeningMigration).toContain(
      "function public.rotate_default_program_deal_version",
    );
    expect(hardeningMigration).toContain(
      "function public.retire_program_deal_version",
    );
    expect(hardeningMigration).toContain("and role = 'admin'");
    expect(hardeningMigration).toContain(
      "status = case when retire_previous then 'retired' else 'active' end",
    );
    expect(hardeningMigration).toContain(
      "Finalized deal legal terms, version, and core content are immutable.",
    );
    expect(hardeningMigration).toContain(
      "Rotate the default before retiring this deal version.",
    );
    expect(hardeningMigration).toContain(
      "new.terms_markdown is distinct from old.terms_markdown",
    );
    expect(hardeningMigration).not.toMatch(
      /insert\s+into\s+public\.program_deal_versions/i,
    );
  });

  it("requires authoritative evidence for completed agreements", () => {
    expect(hardeningMigration).toContain(
      "constraint agreement_records_completed_evidence_required",
    );
    expect(hardeningMigration).toContain("status = 'completed'");
    expect(hardeningMigration).toContain("completed_at is not null");
    expect(hardeningMigration).toContain(
      "completion_evidence_sha256 is not null",
    );
    expect(hardeningMigration).toContain("status <> 'completed'");
    expect(hardeningMigration).toContain("completed_at is null");
  });
});
