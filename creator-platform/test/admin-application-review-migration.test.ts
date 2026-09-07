import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260831160000_admin_application_review.sql"),
  "utf8",
);

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("admin application review migration", () => {
  it("adds an explicit change-request state and applicant-safe message", () => {
    expect(migration).toContain("'changes_requested'");
    expect(migration).toContain("add column if not exists decision_message text");
    expect(migration).toContain("creator_applications_decision_message_length");

    const ownSnapshot = section(
      "create function public.get_own_creator_application()",
      "create or replace function public.get_staff_creator_application_queue",
    );
    expect(ownSnapshot).toContain("application_record.decision_message");
    expect(ownSnapshot).not.toContain("application_record.review_note");
    expect(ownSnapshot).not.toContain("application_record.reviewed_by");
  });

  it("keeps submission one-shot except after an explicit requested revision", () => {
    const submit = section(
      "create or replace function public.submit_creator_application",
      "drop function if exists public.get_own_creator_application",
    );
    expect(submit).toContain("existing_application_status <> 'changes_requested'");
    expect(submit).toContain("event_type");
    expect(submit).toContain("case when is_revision then 'resubmitted' else 'submitted' end");
    expect(submit).toContain("review_revision = application_record.review_revision + 1");
    expect(submit).toContain("review_note = null");
    expect(submit).toContain("decision_message = null");
  });

  it("authorizes every staff read and mutation from the signed-in staff row", () => {
    for (const functionName of [
      "get_staff_creator_application_queue",
      "get_staff_creator_application",
      "review_creator_application",
    ]) {
      const start = migration.indexOf(`function public.${functionName}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = migration.slice(start, start + 4_500);
      expect(body).toContain("auth.uid()");
      expect(body).toContain("public.staff_members");
      expect(body).toContain("staff.active");
      expect(body).toContain("staff.role in ('reviewer', 'admin')");
    }
    expect(migration).toContain(
      "grant execute on function public.review_creator_application(uuid, text, text, text)\n" +
      "to authenticated;",
    );
    expect(migration).not.toContain("service_role");
  });

  it("makes approval atomic and fail-closed around the current default deal", () => {
    const review = section(
      "create or replace function public.review_creator_application",
      "revoke execute on function public.submit_creator_application",
    );
    expect(review).toContain("deal_version.is_default");
    expect(review).toContain("deal_version.status = 'active'");
    expect(review).toContain("No active default deal version is configured.");
    expect(review).toContain("insert into public.creator_enrollments");
    expect(review).toContain("insert into public.agreement_records");
    expect(review).toContain("'preparing'");
    expect(review).toContain("next_lifecycle_status := 'agreement_pending'");
    expect(review).toContain("insert into public.creator_application_events");
    expect(review).toContain("'deal_version_id', default_deal_id");
  });

  it("requires creator-facing explanations for changes and rejection", () => {
    expect(migration).toContain(
      "normalized_action in ('request_changes', 'reject') and public_message is null",
    );
    expect(migration).toContain(
      "An applicant-facing message is required for this decision.",
    );
    expect(migration).toContain("next_application_status := 'changes_requested'");
    expect(migration).toContain("next_application_status := 'rejected'");
  });
});
