import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260831165000_signwell_agreement_adapter.sql"),
  "utf8",
);

describe("SignWell agreement adapter migration", () => {
  it("uses an expiring provisioning lease to prevent ordinary duplicate sends", () => {
    expect(migration).toContain("provisioning_token uuid");
    expect(migration).toContain("provisioning_started_at > now() - interval '10 minutes'");
    expect(migration).toContain("begin_own_signwell_agreement_provisioning");
    expect(migration).toContain("attach_own_signwell_agreement_document");
    expect(migration).toContain("complete_own_signwell_agreement_provisioning");
    expect(migration).toContain("fail_own_signwell_agreement_provisioning");
  });

  it("keeps agreement completion behind verified service-role webhook processing", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("on conflict (provider, external_event_id) do nothing");
    expect(migration).toContain("when 'document_completed' then 'completed'");
    expect(migration).toContain("completion_evidence_sha256 = artifact_hash");
    expect(migration).toContain("completed_artifact_ref = artifact_ref");
    expect(migration).toContain("return 'artifact_required';");
    expect(migration).toContain("deal_terms_sha256 = bound_deal_terms_sha256");
    expect(migration).toContain("set lifecycle_status = 'active'");
    expect(migration).toContain("grant execute on function public.process_signwell_agreement_event(jsonb) to service_role");
    expect(migration).toContain("return 'pending'");
    expect(migration).toContain("external_agreement_id text");
  });

  it("requires platform verification before provisioning", () => {
    expect(migration).toContain("Verify every campaign account before preparing the agreement.");
    expect(migration).toContain("coalesce(claim_record.status, 'missing') <> 'verified'");
  });

  it("keeps provider mutations behind the server service role", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("grant execute on function public.begin_own_signwell_agreement_provisioning(uuid, text) to service_role");
    expect(migration).not.toContain("begin_own_signwell_agreement_provisioning(text) to authenticated");
  });
});
