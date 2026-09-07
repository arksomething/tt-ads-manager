import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260902100000_application_deal_assignment_guard.sql",
  ),
  "utf8",
);

function wrapperBody() {
  const start = migration.indexOf(
    "create or replace function public.review_creator_application_v2",
  );
  const end = migration.indexOf(
    "revoke execute on function public.review_creator_application(uuid, text, text, text)",
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("application deal-assignment guard migration", () => {
  it("exposes the named-argument staff wrapper with the legacy return shape", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain("target_application_id uuid");
    expect(wrapper).toContain("review_action text");
    expect(wrapper).toContain("applicant_message text default null");
    expect(wrapper).toContain("staff_note text default null");
    expect(wrapper).toContain("deal_review_confirmed boolean default false");
    expect(wrapper).toContain("expected_deal_version_id uuid default null");
    expect(wrapper).toContain("expected_deal_snapshot_sha256 text default null");
    expect(wrapper).toContain("application_status text");
    expect(wrapper).toContain("lifecycle_status text");
    expect(wrapper).toContain("enrollment_id uuid");
    expect(wrapper).toContain("agreement_id uuid");
  });

  it("derives authenticated reviewer authority inside a security-definer boundary", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain("security definer");
    expect(wrapper).toContain("reviewer_id uuid := auth.uid()");
    expect(wrapper).toContain("from public.staff_members staff");
    expect(wrapper).toContain("staff.auth_user_id = reviewer_id");
    expect(wrapper).toContain("staff.active");
    expect(wrapper).toContain("staff.role in ('reviewer', 'admin')");
    expect(wrapper).toContain("Reviewer access required.");
  });

  it("requires explicit approval confirmation for one exact canonical snapshot", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain("if normalized_action = 'approve' then");
    expect(wrapper).toContain("deal_review_confirmed is not true");
    expect(wrapper).toContain("expected_deal_version_id is null");
    expect(wrapper).toContain("normalized_expected_snapshot !~ '^[a-f0-9]{64}$'");
    expect(wrapper).toContain("default_deal.id is distinct from expected_deal_version_id");
    expect(wrapper).toContain(
      "default_deal.snapshot_sha256 is distinct from normalized_expected_snapshot",
    );
  });

  it("locks and revalidates the currently effective active default", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain("from public.program_deal_versions deal_version");
    expect(wrapper).toContain("deal_version.is_default");
    expect(wrapper).toContain("deal_version.status = 'active'");
    expect(wrapper).toContain("deal_version.effective_at <= now()");
    expect(wrapper).toContain("limit 1\n    for share;");
    expect(wrapper).toContain("No effective active default deal version is configured.");
  });

  it("requires zero readiness blockers for that locked deal", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain(
      "readiness_blockers := public.admin_program_deal_readiness(default_deal.id)",
    );
    expect(wrapper).toContain(
      "readiness_blockers is null or cardinality(readiness_blockers) <> 0",
    );
    expect(wrapper).toContain("The active default deal is not ready for creator assignment.");
  });

  it("rejects deal-review inputs for every non-approval action", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain("else\n    if coalesce(deal_review_confirmed, false)");
    expect(wrapper).toContain("expected_deal_version_id is not null");
    expect(wrapper).toContain("expected_deal_snapshot_sha256 is not null");
    expect(wrapper).toContain("Deal confirmation is accepted only for approval.");
  });

  it("delegates atomically and removes direct browser access to the legacy RPC", () => {
    const wrapper = wrapperBody();
    expect(wrapper).toContain(
      "from public.review_creator_application(\n" +
      "    target_application_id,\n" +
      "    review_action,\n" +
      "    applicant_message,\n" +
      "    staff_note\n" +
      "  );",
    );
    expect(wrapper).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/iu);
    expect(migration).toContain(
      "revoke execute on function public.review_creator_application(uuid, text, text, text)\n" +
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.review_creator_application_v2(uuid, text, text, text, boolean, uuid, text)\n" +
      "to authenticated;",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.review_creator_application\(uuid, text, text, text\)/iu,
    );
  });
});
