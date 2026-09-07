import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260902093000_admin_deal_drafts.sql"),
  "utf8",
);

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("admin deal draft migration", () => {
  it("adds sealed snapshots and strict integer-micro economics without seeding the sample", () => {
    expect(migration).toContain("'draft', 'sealed', 'active', 'retired'");
    expect(migration).toContain("economics_json jsonb");
    expect(migration).toContain("economics_sha256 text");
    expect(migration).toContain("snapshot_sha256 text");
    expect(migration).toContain("numeric_candidate = trunc(numeric_candidate)");
    expect(migration).toContain("rateMicrosPerThousand");
    expect(migration).toContain("creatorAggregateCapMicros");
    expect(migration).not.toContain("standard-creator-agreement-sample.json");
    expect(migration).not.toContain("gotall-standard-creator-agreement-sample");
    expect(migration).not.toMatch(/\$0\.50|\$1\.00|500_000|100_000_000/u);
  });

  it("allocates versions under a per-key transaction lock and owns protected fields", () => {
    const create = section(
      "create or replace function public.create_admin_program_deal_draft",
      "create or replace function public.update_admin_program_deal_draft",
    );
    expect(create).toContain("auth.uid()");
    expect(create).toContain("role = 'admin'");
    expect(create).toContain("pg_advisory_xact_lock");
    expect(create).toContain("coalesce(max(version), 0) + 1");
    expect(create).toContain("'draft', false, actor_id");
    expect(create).not.toContain("status_input");
    expect(create).not.toContain("version_input");
    expect(create).not.toContain("hash_input");
  });

  it("uses optimistic draft revisions and an append-only event ledger", () => {
    const update = section(
      "create or replace function public.update_admin_program_deal_draft",
      "create or replace function public.seal_admin_program_deal_draft",
    );
    expect(update).toContain("for update");
    expect(update).toContain("deal_record.draft_revision <> expected_draft_revision");
    expect(update).toContain("using errcode = '40001'");
    expect(update).toContain("draft_revision = draft_revision + 1");
    expect(update).toContain("'draft_updated'");
    expect(migration).toContain("Program deal events are append-only.");
    expect(migration).toContain("before update or delete on public.program_deal_events");
  });

  it("seals only complete placeholder-free legal and economic content", () => {
    const seal = section(
      "create or replace function public.seal_admin_program_deal_draft",
      "revoke execute on function public.admin_deal_jsonb_integer",
    );
    expect(seal).toContain("admin_deal_placeholder_free(deal_record.terms_markdown)");
    expect(seal).toContain("admin_deal_economics_valid(deal_record.economics_json, true)");
    expect(seal).toContain("status = 'sealed'");
    expect(seal).not.toContain("status = 'active'");
    expect(seal).not.toContain("is_default = true");

    const placeholderGuard = section(
      "create or replace function public.admin_deal_placeholder_free",
      "create or replace function public.admin_deal_economics_valid",
    );
    for (const marker of [
      "to[ _-]?approve",
      "non[ _-]?binding",
      "not[ _-]+for[ _-]+signature",
      "sample([ _-]?draft)?",
      "sample|date",
    ]) expect(placeholderGuard).toContain(marker);

    const economicsGuard = section(
      "create or replace function public.admin_deal_economics_valid",
      "-- Replace the original terms-only trigger",
    );
    expect(economicsGuard).toContain("(economics -> 'fixedFeeMicros') = 'null'::jsonb");
    expect(economicsGuard).toContain("(economics -> 'minimumPayoutMicros') = 'null'::jsonb");
    expect(economicsGuard).not.toContain("(economics -> 'creatorAggregateCapMicros') = 'null'::jsonb");
  });

  it("records exact-snapshot approvals, signing binding, assignments, and fail-closed readiness", () => {
    expect(migration).toContain("create table public.program_deal_signing_bindings");
    expect(migration).toContain("unique (deal_version_id, provider, provider_environment)");
    expect(migration).toContain("bound_snapshot_sha256 text not null");
    expect(migration).not.toContain("function public.hash_program_deal_signing_binding");
    expect(migration).not.toContain("digest(convert_to(new.provider_template_id");
    expect(migration).toContain("create table public.program_deal_approvals");
    expect(migration).toContain("approval_kind in ('business', 'legal')");
    expect(migration).toContain("approval.snapshot_sha256 = deal_record.snapshot_sha256");
    expect(migration).toContain("binding.status = 'verified'");
    expect(migration).toContain("binding.provider_environment = 'production'");
    expect(migration).toContain("binding.bound_snapshot_sha256 = deal_record.snapshot_sha256");
    expect(migration).toContain("'boundSnapshotHash', binding.bound_snapshot_sha256");
    expect(migration).toContain("from public.creator_enrollments");
    expect(migration).toContain("'readinessBlockerCount', cardinality(blockers)");
    expect(migration).toContain("'activationReady', cardinality(blockers) = 0");
  });

  it("allows reviewer/admin reads, admin-only writes, and no authenticated activation", () => {
    for (const functionName of [
      "get_admin_program_deal_catalog",
      "get_admin_program_deal_detail",
    ]) {
      const start = migration.indexOf(`function public.${functionName}`);
      const body = migration.slice(start, start + 2_000);
      expect(body).toContain("auth.uid()");
      expect(body).toContain("role in ('reviewer', 'admin')");
    }
    for (const functionName of [
      "create_admin_program_deal_draft",
      "update_admin_program_deal_draft",
      "seal_admin_program_deal_draft",
    ]) {
      const start = migration.indexOf(`function public.${functionName}`);
      const body = migration.slice(start, start + 2_500);
      expect(body).toContain("auth.uid()");
      expect(body).toContain("role = 'admin'");
    }
    expect(migration).toContain(
      "revoke insert, update, delete on public.program_deal_versions\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke select on public.program_deal_versions from authenticated;",
    );
    expect(migration).not.toMatch(/grant select \([^)]*change_note/i);
    expect(migration).toContain(
      "revoke execute on function public.rotate_default_program_deal_version(uuid, boolean)\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke execute on function public.retire_program_deal_version(uuid)\n" +
      "from public, anon, authenticated;",
    );
  });
});
