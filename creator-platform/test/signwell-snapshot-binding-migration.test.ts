import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260903123000_signwell_snapshot_binding.sql",
  ),
  "utf8",
);
const releaseMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260903122000_admin_deal_release_workflow.sql",
  ),
  "utf8",
);

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("SignWell combined snapshot binding migration", () => {
  it("stores combined snapshot evidence separately from legal-text evidence", () => {
    expect(migration).toContain("add column if not exists deal_snapshot_sha256 text");
    expect(migration).toContain("deal_snapshot_sha256 ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("and deal_terms_sha256 is not null");
    expect(migration).toContain("and deal_snapshot_sha256 is not null");
  });

  it("returns the exact verified production template and assigned combined snapshot through the lease", () => {
    const lease = section(
      "create function public.begin_own_signwell_agreement_provisioning",
      "revoke execute on function public.begin_own_signwell_agreement_provisioning",
    );
    expect(lease).toContain("deal_snapshot_sha256 text");
    expect(lease).toContain("provider_template_id text");
    expect(lease).toContain("verified_binding_count <> 1");
    expect(lease).toContain("binding.provider_environment = 'production'");
    expect(lease).toContain("binding.status = 'verified'");
    expect(lease).toContain("binding.bound_snapshot_sha256 = deal_version.snapshot_sha256");
    expect(lease).toContain("join public.program_deal_template_source_artifacts source_artifact");
    expect(lease).toContain("source_artifact.id = binding.source_artifact_id");
    expect(lease).toContain("source_artifact.source_sha256 = binding.provider_template_sha256");
    expect(lease).toContain("source_artifact.deal_snapshot_sha256 = binding.bound_snapshot_sha256");
    expect(lease).toContain("deal_version.status in ('active', 'retired')");
    expect(lease).toContain("agreement_record.provider is distinct from 'signwell'");
    expect(lease).toContain(
      "agreement_record.provider_environment is distinct from normalized_environment",
    );
    expect(lease).toContain("agreement_record.deal_snapshot_sha256 is distinct from deal_snapshot_hash");
    expect(lease).toContain("agreement_record.provider_template_id is distinct from verified_template_id");
    expect(lease).toContain(
      "when agreement_record.external_agreement_id is null then normalized_environment\n" +
      "        else agreement_record.provider_environment",
    );
    expect(lease).not.toContain(
      "set provider = 'signwell',\n      provider_environment = normalized_environment",
    );
    expect(migration).toContain(
      "grant execute on function public.begin_own_signwell_agreement_provisioning(uuid, text)\n" +
      "to service_role;",
    );
  });

  it("attaches only an exact combined snapshot and derives the terms hash separately", () => {
    const attach = section(
      "create function public.attach_own_signwell_agreement_document",
      "revoke execute on function public.attach_own_signwell_agreement_document",
    );
    expect(attach).toContain("bound_deal_snapshot_sha256 text");
    expect(attach).toContain("deal_terms_sha256 = deal_version.terms_sha256");
    expect(attach).toContain("deal_snapshot_sha256 = bound_deal_snapshot_sha256");
    expect(attach).toContain("deal_version.snapshot_sha256 = bound_deal_snapshot_sha256");
    expect(attach).toContain("deal_version.status in ('active', 'retired')");
    expect(attach).toContain("binding.provider_template_id = signwell_template_id");
    expect(attach).toContain("binding.provider_environment = 'production'");
    expect(attach).toContain("binding.status = 'verified'");
    expect(attach).toContain("join public.program_deal_template_source_artifacts source_artifact");
    expect(attach).toContain("source_artifact.id = binding.source_artifact_id");
    expect(attach).toContain("source_artifact.source_sha256 = binding.provider_template_sha256");
    expect(attach).not.toContain("bound_deal_terms_sha256");
    expect(migration).toContain(
      "grant execute on function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text)\n" +
      "to service_role;",
    );
  });

  it("keeps a retired version signable through its own binding after default rollover", () => {
    const lease = section(
      "create function public.begin_own_signwell_agreement_provisioning",
      "revoke execute on function public.begin_own_signwell_agreement_provisioning",
    );
    expect(lease).toContain(
      "where deal_version.id = agreement_record.deal_version_id",
    );
    expect(lease).toContain("deal_version.status in ('active', 'retired')");
    expect(lease).not.toContain("deal_version.is_default");
    expect(lease).not.toContain("AGREEMENT_TEMPLATE_ID");
    expect(releaseMigration).toContain(
      "set is_default = false,\n        status = 'retired'",
    );
  });

  it("does not finalize a document unless its stored snapshot still matches the deal", () => {
    const complete = section(
      "create or replace function public.complete_own_signwell_agreement_provisioning",
      "revoke execute on function public.complete_own_signwell_agreement_provisioning",
    );
    expect(complete).toContain("agreement.deal_snapshot_sha256 is not null");
    expect(complete).toContain(
      "deal_version.snapshot_sha256 = agreement.deal_snapshot_sha256",
    );
    expect(complete).toContain("join public.program_deal_template_source_artifacts source_artifact");
    expect(complete).toContain("source_artifact.id = binding.source_artifact_id");
  });

  it("exposes stored snapshot evidence for fail-closed document resume", () => {
    const context = section(
      "create function public.get_own_agreement_signing_context()",
      "revoke execute on function public.get_own_agreement_signing_context()",
    );
    expect(context).toContain("deal_snapshot_sha256 text");
    expect(context).toContain("verified_provider_template_id text");
    expect(context).toContain("verified_deal_snapshot_sha256 text");
    expect(context).toContain("agreement_record.deal_snapshot_sha256");
    expect(context).toContain("verified_binding.provider_environment = 'production'");
    expect(context).toContain("verified_binding.status = 'verified'");
    expect(context).toContain("from public.program_deal_template_source_artifacts source_artifact");
    expect(context).toContain("source_artifact.id = verified_binding.source_artifact_id");
    expect(context).toContain("enrollment_record.account_id = current_user_id");
  });
});
