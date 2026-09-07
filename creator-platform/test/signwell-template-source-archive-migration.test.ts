import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260903122500_signwell_template_source_archive.sql",
), "utf8");

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("SignWell immutable template source archive migration", () => {
  it("creates one immutable private artifact per deal version", () => {
    expect(migration).toContain("create table public.program_deal_template_source_artifacts");
    expect(migration).toContain("unique (deal_version_id)");
    expect(migration).toContain("unique (provider, provider_environment, provider_template_id)");
    expect(migration).toContain("before update or delete on public.program_deal_template_source_artifacts");
    expect(migration).toContain("alter table public.program_deal_template_source_artifacts enable row level security");
    expect(migration).toContain("revoke all on public.program_deal_template_source_artifacts\nfrom public, anon, authenticated");
    expect(migration).toContain("'creator-deal-template-sources'");
    expect(migration).toContain("false,\n        4194304");
    expect(migration).not.toContain("on storage.objects");
  });

  it("allows only the service role to register server-hashed stored bytes", () => {
    const archive = section(
      "create or replace function public.archive_admin_program_deal_template_source",
      "create or replace function public.get_admin_program_deal_template_source_artifact",
    );
    expect(archive).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(archive).toContain("active and role = 'admin'");
    expect(archive).toContain("deal_record.status <> 'sealed'");
    expect(archive).toContain("deal_record.snapshot_sha256 is distinct from normalized_snapshot");
    expect(archive).toContain("'signwell_template_source_archived'");
    expect(archive).toContain("'sourceArtifactId', artifact_record.id");
    expect(migration).toContain(
      "revoke execute on function public.archive_admin_program_deal_template_source(uuid, uuid, text, text, text, text, text, text, bigint)\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.archive_admin_program_deal_template_source(uuid, uuid, text, text, text, text, text, text, bigint)\n" +
      "to service_role;",
    );
  });

  it("copies binding identity from the artifact and rejects stale browser-hash RPCs", () => {
    const binding = section(
      "create or replace function public.record_admin_program_deal_signwell_binding_from_artifact",
      "create or replace function public.verify_admin_program_deal_signwell_binding_from_artifact",
    );
    expect(binding).toContain("source_artifact_id_input uuid");
    expect(binding).toContain("artifact_record.provider_template_id");
    expect(binding).toContain("artifact_record.source_sha256");
    expect(binding).toContain("artifact_record.deal_snapshot_sha256");
    expect(binding).toContain("'sourceArtifactId', artifact_record.id");
    expect(binding).not.toContain("provider_template_sha256_input");

    const verify = section(
      "create or replace function public.verify_admin_program_deal_signwell_binding_from_artifact",
      "revoke execute on function public.prevent_program_deal_template_source_artifact_mutation",
    );
    expect(verify).toContain("binding_record.source_artifact_id is distinct from artifact_record.id");
    expect(verify).toContain("'sourceArtifactId', artifact_record.id");
    expect(verify).not.toContain("provider_template_sha256_input");
    expect(migration).toContain(
      "revoke execute on function public.record_admin_program_deal_signwell_binding(uuid, text, text, text)\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke execute on function public.verify_admin_program_deal_signwell_binding(uuid, text, text, text, text)\n" +
      "from public, anon, authenticated;",
    );
  });

  it("fails readiness and future binding mutations without an exact archive", () => {
    const trigger = section(
      "create or replace function public.enforce_program_deal_signing_binding_source_artifact",
      "create trigger enforce_program_deal_signing_binding_source_artifact",
    );
    expect(trigger).toContain("artifact.id = new.source_artifact_id");
    expect(trigger).toContain("artifact.source_sha256 = new.provider_template_sha256");
    expect(trigger).toContain("artifact.deal_snapshot_sha256 = new.bound_snapshot_sha256");

    const readiness = section(
      "create or replace function public.admin_program_deal_readiness",
      "create or replace function public.record_admin_program_deal_signwell_binding_from_artifact",
    );
    expect(readiness).toContain("join public.program_deal_template_source_artifacts artifact");
    expect(readiness).toContain("artifact.id = binding.source_artifact_id");
    expect(readiness).toContain("Archive and manually verify exactly one production SignWell template source");
  });

  it("does not seed any release or default state", () => {
    expect(migration).not.toMatch(/insert into public\.program_deal_versions/i);
    expect(migration).not.toMatch(/insert into public\.program_deal_signing_bindings[\s\S]*values\s*\([^)]*'verified'/i);
    expect(migration).not.toMatch(/is_default\s*=\s*true/i);
  });
});
