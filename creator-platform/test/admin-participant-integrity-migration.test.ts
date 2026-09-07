import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260903121000_admin_participant_integrity.sql",
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

describe("admin participant integrity migration", () => {
  it("keeps the previous projections private while retaining the public RPC signatures", () => {
    expect(migration).toContain(
      "rename to get_creator_admin_workspace_unfiltered_20260831166000",
    );
    expect(migration).toContain(
      "rename to get_creator_admin_profile_unfiltered_20260831166000",
    );
    expect(migration).toContain(
      "revoke execute on function public.get_creator_admin_workspace_unfiltered_20260831166000(date, date)\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke execute on function public.get_creator_admin_profile_unfiltered_20260831166000(uuid)\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.get_creator_admin_workspace(date, date) to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.get_creator_admin_profile(uuid) to authenticated",
    );
  });

  it("lists and counts only accounts with an application or enrollment", () => {
    const workspace = section(
      "create function public.get_creator_admin_workspace(",
      "create function public.get_creator_admin_profile(",
    );

    expect(workspace).toContain("from public.creator_applications application_record");
    expect(workspace).toContain("from public.creator_enrollments enrollment_record");
    expect(workspace).toContain(
      "application_record.account_id = (creator_row.value ->> 'accountId')::uuid",
    );
    expect(workspace).toContain(
      "enrollment_record.account_id = (creator_row.value ->> 'accountId')::uuid",
    );
    expect(workspace).toContain("'{creators}'");
    expect(workspace).toContain("'{summary,creatorCount}'");
    expect(workspace).toContain("to_jsonb(participant_count)");
    expect(workspace).toContain("'{summary,activeCreatorCount}'");
    expect(workspace).toContain("to_jsonb(active_participant_count)");
  });

  it("does not expose a direct profile for a staff-only account", () => {
    const profile = section(
      "create function public.get_creator_admin_profile(",
      "revoke execute on function public.get_creator_admin_workspace(date, date)",
    );

    expect(profile).toContain(
      "profile_result := public.get_creator_admin_profile_unfiltered_20260831166000",
    );
    expect(profile).toContain("from public.creator_applications application_record");
    expect(profile).toContain("from public.creator_enrollments enrollment_record");
    expect(profile).toContain("where application_record.account_id = target_account_id");
    expect(profile).toContain("where enrollment_record.account_id = target_account_id");
    expect(profile).toContain(
      "raise exception 'Creator account was not found.' using errcode = 'P0002'",
    );
  });

  it("keeps both wrappers stable, security definer, and search-path pinned", () => {
    expect(migration.match(/language plpgsql\nstable\nsecurity definer\nset search_path = public, auth, pg_temp/g))
      .toHaveLength(2);
    expect(migration.match(/public\.creator_is_active_staff\('reviewer'\)/g))
      .toHaveLength(2);
    expect(migration.match(/errcode = '42501'/g)).toHaveLength(2);
    expect(migration).not.toContain("service_role");
  });
});
