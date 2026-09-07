import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const runbook = readFileSync(
  join(process.cwd(), "../ops/creator-platform/staff-access-recovery.md"),
  "utf8",
);

describe("staff access recovery runbook", () => {
  it("keeps zero-admin recovery outside the browser trust boundary", () => {
    expect(runbook).toMatch(/zero active administrators/i);
    expect(runbook).toMatch(/not a browser flow/i);
    expect(runbook).toContain("service_role");
    expect(runbook).toMatch(/database owner/i);
    expect(runbook).toMatch(/never place the service-role key\s+in browser code/i);
    expect(runbook).toMatch(/do not add a web route around this RPC/i);
  });

  it("requires exact project, account, zero-admin, and typed-confirmation checks", () => {
    expect(runbook).toContain("ops/creator-platform/supabase-project.json");
    expect(runbook).toContain("where active and role = 'admin'");
    expect(runbook).toContain("auth_user.email_confirmed_at is not null");
    expect(runbook).toContain("recover_zero_active_creator_admin");
    expect(runbook).toContain("RECOVER ADMIN ACCESS FOR target@example.com");
  });

  it("documents immutable audit verification and the account-vs-human limit", () => {
    expect(runbook).toContain("public.creator_staff_access_events");
    expect(runbook).toMatch(/immutable event/i);
    expect(runbook).toMatch(/do not prove that two different humans/i);
    expect(runbook).toMatch(/not evidence of independent business or legal approval/i);
  });
});
