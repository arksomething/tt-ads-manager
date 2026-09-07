import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260831168000_creator_platform_verification_worker.sql"),
  "utf8",
);
const onboardingPage = readFileSync(
  resolve(process.cwd(), "src/app/onboarding/accounts/page.tsx"),
  "utf8",
);

describe("campaign-account verification worker migration", () => {
  it("adds service-only fenced lease, completion, retry, and reap RPCs", () => {
    expect(migration).toContain("add column lease_token uuid");
    expect(migration).toContain("for update of verification_job skip locked");
    expect(migration).toContain("create or replace function public.lease_creator_platform_verification_jobs");
    expect(migration).toContain("create or replace function public.complete_creator_platform_verification_job");
    expect(migration).toContain("create or replace function public.retry_creator_platform_verification_job");
    expect(migration).toContain("create or replace function public.reap_creator_platform_verification_jobs");
    expect(migration).toContain("perform public.creator_require_service_role()");
    expect(migration).toContain("to service_role");
  });

  it("binds completion to the leased code issuance and hashed evidence", () => {
    expect(migration).toContain("claim_code_issued_at");
    expect(migration).toContain("claim_code_sha256");
    expect(migration).toContain("observed_bio_sha256");
    expect(migration).toContain("result_evidence_sha256");
    expect(migration).toContain("'bio_code_worker_v1'");
    expect(migration).toContain("'native_identity_conflict'");
  });

  it("keeps manual review and code rotation authoritative over leased work", () => {
    expect(migration).toContain("cancel_creator_platform_verification_work_after_claim_change");
    expect(migration).toContain("and state in ('queued', 'leased', 'retry')");
    expect(migration).toContain("claim_record.status = 'checking'");
    expect(migration).toContain("claim_record.code_expires_at > now()");
    expect(migration).toContain("'claim_fence_changed'");
  });

  it("makes repeated checks idempotent and preserves database retry backoff", () => {
    const requestStart = migration.indexOf(
      "create or replace function public.request_creator_platform_verification",
    );
    const rotateStart = migration.indexOf(
      "create or replace function public.rotate_creator_platform_verification_code",
    );
    const requestFunction = migration.slice(requestStart, rotateStart);
    expect(requestFunction).toContain("return existing_job_id");
    expect(requestFunction).not.toContain("set available_at =");
    expect(requestFunction).toContain("now() - interval '60 seconds'");
    expect(onboardingPage).toContain("<VerificationStatusRefresh />");
    expect(onboardingPage).toContain("An active check keeps its queue position");
    expect(onboardingPage).not.toContain("Queue again");
  });

  it("persists single-use signed-request nonces without granting browser roles", () => {
    expect(migration).toContain("create table public.creator_platform_verification_worker_requests");
    expect(migration).toContain("on conflict on constraint creator_platform_verification_worker_requests_pkey");
    expect(migration).toContain("from public, anon, authenticated");
  });
});
