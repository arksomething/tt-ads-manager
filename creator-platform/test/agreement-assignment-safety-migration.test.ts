import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260902090000_agreement_assignment_safety.sql",
  ),
  "utf8",
);

const originalReviewMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260831160000_admin_application_review.sql",
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

describe("agreement assignment safety migration", () => {
  it("introduces assigned without relabeling real or attached provider attempts", () => {
    expect(migration).toContain("'assigned',");
    const repair = section(
      "update public.agreement_records\nset status = 'assigned'",
      "alter table public.creator_enrollments",
    );
    expect(repair).toContain("where status = 'preparing'");
    expect(repair).toContain("provider = 'unassigned'");
    expect(repair).toContain("provider_environment = 'pending_adapter'");
    expect(repair).toContain("external_agreement_id is null");
    expect(repair).toContain("provider_template_id is null");
    expect(repair).toContain("provisioning_token is null");
    expect(repair).toContain("provisioning_started_at is null");
    expect(repair).toContain("signing_requested_at is null");
  });

  it("makes future staff approvals create assigned agreements", () => {
    expect(migration).toContain(
      "'public.review_creator_application(uuid,text,text,text)'::regprocedure",
    );
    expect(migration).toContain("preparing_occurrences = 1");
    expect(migration).toContain("'''preparing''',\n      '''assigned'''" );
    expect(migration).toContain(
      "The application approval agreement-state mapping was not recognized.",
    );

    const reviewStart = originalReviewMigration.indexOf(
      "create or replace function public.review_creator_application",
    );
    const reviewEnd = originalReviewMigration.indexOf(
      "revoke execute on function public.submit_creator_application",
      reviewStart,
    );
    const installedReviewSource = originalReviewMigration.slice(reviewStart, reviewEnd);
    expect(reviewStart).toBeGreaterThanOrEqual(0);
    expect(reviewEnd).toBeGreaterThan(reviewStart);
    expect(installedReviewSource.match(/'preparing'/gu)).toHaveLength(1);

    const deterministicallyPatched = installedReviewSource.replace(
      "'preparing'",
      "'assigned'",
    );
    expect(deterministicallyPatched).toContain("      'assigned'\n    )");
    expect(deterministicallyPatched).not.toContain("'preparing'");
  });

  it("revokes the incomplete legacy approval RPC from every browser role", () => {
    expect(migration).toContain(
      "revoke execute on function public.approve_creator_application(uuid)\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.approve_creator_application\(uuid\)\s+to authenticated/iu,
    );
  });

  it("requires an agreement deal version to match its enrollment deal version", () => {
    expect(migration).toContain(
      "constraint creator_enrollments_id_deal_version_id_key\n  unique (id, deal_version_id)",
    );
    expect(migration).toContain(
      "constraint agreement_records_enrollment_deal_version_fkey\n" +
      "  foreign key (enrollment_id, deal_version_id)",
    );
    expect(migration).toContain(
      "references public.creator_enrollments (id, deal_version_id)",
    );
  });

  it("leases assigned records and only recovers preparing after ten minutes", () => {
    const begin = section(
      "create or replace function public.begin_own_signwell_agreement_provisioning",
      "revoke execute on function public.begin_own_signwell_agreement_provisioning",
    );
    expect(begin).toContain(
      "agreement_record.status not in ('assigned', 'pending', 'error', 'preparing')",
    );
    expect(begin).toContain("agreement_record.status = 'preparing'");
    expect(begin).toContain("agreement_record.provisioning_token is not null");
    expect(begin).toContain("agreement_record.provisioning_started_at is null");
    expect(begin).toContain(
      "agreement_record.provisioning_started_at > now() - interval '10 minutes'",
    );
    expect(begin).toContain("raise exception 'Agreement preparation is already in progress.'");
    expect(begin).toContain("status = 'preparing'");
    expect(begin).toContain("provisioning_token = next_token");
    expect(begin).toContain("provisioning_started_at = now()");
    expect(begin).toContain("agreement_record.external_agreement_id");
  });

  it("exposes the lease timestamp only through the creator-owned context", () => {
    const context = section(
      "create function public.get_own_agreement_signing_context()",
      "revoke execute on function public.get_own_agreement_signing_context()",
    );
    expect(context).toContain("provisioning_started_at timestamptz");
    expect(context).toContain("agreement_record.provisioning_started_at");
    expect(context).toContain("enrollment_record.account_id = current_user_id");
    expect(migration).toContain(
      "grant execute on function public.get_own_agreement_signing_context()\n" +
      "to authenticated;",
    );
  });
});
