import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260903122000_admin_deal_release_workflow.sql"),
  "utf8",
);

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("guarded admin deal release migration", () => {
  it("revalidates two distinct current active-admin approvals for the exact snapshot", () => {
    expect(migration).toContain("program_deal_approvals_legal_note_required");
    expect(migration).toContain("approval_kind <> 'legal'");
    expect(migration).toContain("char_length(btrim(note)) between 4 and 2000");
    const readiness = section(
      "create or replace function public.admin_program_deal_readiness",
      "create or replace function public.get_admin_program_deal_detail",
    );
    expect(readiness).toContain("approval.snapshot_sha256 = deal_record.snapshot_sha256");
    expect(readiness).toContain("approver.active");
    expect(readiness).toContain("approver.role = 'admin'");
    expect(readiness).toContain("approval.note is not null");
    expect(readiness).toContain("char_length(btrim(approval.note)) between 4 and 2000");
    expect(readiness).toContain("count(distinct approval.approved_by)");
    expect(readiness).toContain("distinct_approval_actor_count <> 2");

    const approval = section(
      "create or replace function public.record_admin_program_deal_approval",
      "create or replace function public.revoke_admin_program_deal_approval",
    );
    expect(approval).toContain("deal_record.status <> 'sealed'");
    expect(approval).toContain("deal_record.snapshot_sha256 is distinct from normalized_snapshot");
    expect(approval).toContain("normalized_kind = 'legal'");
    expect(approval).toContain("normalized_note is null or char_length(normalized_note) < 4");
    expect(approval).toContain("other_approver = actor_id");
    expect(approval).toContain("An active approval must be explicitly revoked before replacement.");
    expect(approval).toContain("for update");
    expect(approval).toContain("'snapshot_approval_recorded'");
    expect(approval).not.toContain("status_input");
  });

  it("revokes an exact matching approval with an actor and required reason", () => {
    const revoke = section(
      "create or replace function public.revoke_admin_program_deal_approval",
      "create or replace function public.record_admin_program_deal_signwell_binding",
    );
    expect(revoke).toContain("char_length(normalized_note) not between 4 and 2000");
    expect(revoke).toContain("approval_record.snapshot_sha256 is distinct from normalized_snapshot");
    expect(revoke).toContain("revoked_by = actor_id");
    expect(revoke).toContain("revocation_note = normalized_note");
    expect(revoke).toContain("'snapshot_approval_revoked'");
    expect(revoke).not.toContain("update public.creator_enrollments");
  });

  it("records pending SignWell source evidence separately from explicit verification", () => {
    const record = section(
      "create or replace function public.record_admin_program_deal_signwell_binding",
      "create or replace function public.verify_admin_program_deal_signwell_binding",
    );
    expect(record).toContain("'signwell', 'production'");
    expect(record).toContain("normalized_template_id !~*");
    expect(record).toContain("normalized_template_hash !~ '^[a-f0-9]{64}$'");
    expect(record).toContain("normalized_snapshot !~ '^[a-f0-9]{64}$'");
    expect(record).toContain("'pending', actor_id");
    expect(record).toContain("'signwell_binding_recorded'");
    expect(record).toContain("A verified production binding cannot be silently replaced.");
    expect(record).not.toContain("status_input");

    const verify = section(
      "create or replace function public.verify_admin_program_deal_signwell_binding",
      "create or replace function public.activate_admin_program_deal_default",
    );
    expect(verify).toContain(
      "I verified this exact SignWell production template source against this sealed deal snapshot.",
    );
    expect(verify).toContain("verification_attestation is distinct from required_attestation");
    expect(verify).toContain("binding_record.provider_template_id is distinct from normalized_template_id");
    expect(verify).toContain("binding_record.provider_template_sha256 is distinct from normalized_template_hash");
    expect(verify).toContain("binding_record.bound_snapshot_sha256 is distinct from normalized_snapshot");
    expect(verify).toContain("verification_method = 'manual_admin_attestation'");
    expect(verify).toContain("'signwell_binding_verified'");
  });

  it("locks and recomputes readiness before one atomic previous-default handoff", () => {
    const activate = section(
      "create or replace function public.activate_admin_program_deal_default",
      "revoke execute on function public.admin_program_deal_readiness",
    );
    expect(activate).toContain("ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT");
    expect(activate).toContain("deal_record.snapshot_sha256 is distinct from normalized_snapshot");
    expect(activate).toContain("lock table public.staff_members in share mode");
    expect(activate).toContain("public.program_deal_approvals");
    expect(activate).toContain("public.program_deal_signing_bindings");
    expect(activate).toContain("readiness_blockers := public.admin_program_deal_readiness(deal_record.id)");
    expect(activate).toContain("set is_default = false,\n        status = 'retired'");
    expect(activate).toContain("set status = 'active',\n      is_default = true");
    expect(activate).toContain("'default_activated'");
    expect(activate).not.toContain("rotate_default_program_deal_version(");
    expect(activate).not.toContain("update public.creator_enrollments");
  });

  it("grants only guarded functions and keeps historical mutation RPCs unavailable", () => {
    for (const signature of [
      "record_admin_program_deal_approval(uuid, text, text, text)",
      "revoke_admin_program_deal_approval(uuid, text, text, text)",
      "record_admin_program_deal_signwell_binding(uuid, text, text, text)",
      "verify_admin_program_deal_signwell_binding(uuid, text, text, text, text)",
      "activate_admin_program_deal_default(uuid, text, text)",
    ]) {
      expect(migration).toContain(`grant execute on function public.${signature}\nto authenticated;`);
      expect(migration).toContain(`revoke execute on function public.${signature}\nfrom public, anon;`);
    }
    expect(migration).toContain(
      "revoke execute on function public.rotate_default_program_deal_version(uuid, boolean)\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).not.toContain("grant execute on function public.rotate_default_program_deal_version");
    expect(migration).not.toContain("grant insert");
    expect(migration).not.toContain("grant update");
  });
});
