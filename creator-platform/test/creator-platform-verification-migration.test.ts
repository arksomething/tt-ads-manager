import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260831164000_creator_platform_verification.sql"),
  "utf8",
);

describe("creator platform verification migration", () => {
  it("keeps provisional claims separate from canonical verified identities", () => {
    expect(migration).toContain("create table public.creator_platform_account_claims");
    expect(migration).toContain("create table public.creator_platform_verification_jobs");
    expect(migration).toContain("create table public.creator_platform_verification_events");
    expect(migration).toContain("native_account_id text");
    expect(migration).toContain("ownership_evidence_sha256 text");
    expect(migration).toContain("'bio_code_manual_review'");
    expect(migration).toContain("insert into public.creator_platform_accounts");
    expect(migration).toContain(
      "returning public.creator_platform_accounts.id into verified_platform_account_id",
    );
  });

  it("seeds approved application handles and persists a durable check job", () => {
    expect(migration).toContain("create trigger seed_creator_platform_claims_after_application_review");
    expect(migration).toContain("create or replace function public.request_creator_platform_verification");
    expect(migration).toContain("where state in ('queued', 'leased', 'retry')");
    expect(migration).toContain("creator_platform_verification_one_active_job");
  });

  it("gates agreement access on every submitted campaign-account claim", () => {
    expect(migration).toContain("then '/onboarding/accounts'");
    expect(migration).toContain("coalesce(claim_record.status, 'missing') <> 'verified'");
    expect(migration).toContain("when application_record.status <> 'approved' then '/application/status'");
    expect(migration).toContain("grant execute on function public.get_creator_account_state() to authenticated");
  });

  it("keeps review and creator mutations behind authenticated RPC checks", () => {
    expect(migration).toContain("Reviewer access required.");
    expect(migration).toContain("where id = target_claim_id and account_id = current_user_id");
    expect(migration).toContain("revoke all on public.creator_platform_account_claims from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.seed_creator_platform_claims() from public, anon, authenticated");
  });
});
