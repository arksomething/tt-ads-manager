import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260903124000_admin_staff_management.sql"),
  "utf8",
);

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("admin staff management migration", () => {
  it("creates a private append-only ledger with every required change field", () => {
    const table = section(
      "create table public.creator_staff_access_events (",
      "create or replace function public.get_creator_staff_directory()",
    );
    for (const field of [
      "actor_kind",
      "actor_user_id",
      "actor_email_snapshot",
      "target_user_id",
      "target_email_snapshot",
      "prior_role",
      "prior_active",
      "new_role",
      "new_active",
      "request_outcome",
      "created_at",
    ]) expect(table).toContain(field);
    expect(table).toContain("request_outcome in ('added', 'reactivated')");
    expect(table).toContain("alter table public.creator_staff_access_events enable row level security");
    expect(table).toContain("revoke all on table public.creator_staff_access_events from public, anon, authenticated, service_role");
    expect(table).toContain("before update or delete on public.creator_staff_access_events");
    expect(table).toContain("before truncate on public.creator_staff_access_events");
    expect(table).toContain("Staff access audit events are immutable.");
  });

  it("returns minimal staff identity plus twenty minimal recent access events", () => {
    const directory = section(
      "create or replace function public.get_creator_staff_directory()",
      "create or replace function public.add_or_reactivate_creator_staff(",
    );
    expect(directory).toContain("public.creator_is_active_staff('admin')");
    expect(directory).toContain("'email', lower(btrim(auth_user.email))");
    expect(directory).toContain("'emailConfirmed', auth_user.email_confirmed_at is not null");
    expect(directory).toContain("'actor', case access_event.actor_kind");
    expect(directory).toContain("'targetEmail', access_event.target_email_snapshot");
    expect(directory).toContain("'priorRole', access_event.prior_role");
    expect(directory).toContain("'priorActive', access_event.prior_active");
    expect(directory).toContain("'newRole', access_event.new_role");
    expect(directory).toContain("'newActive', access_event.new_active");
    expect(directory).toContain("'outcome', access_event.request_outcome");
    expect(directory).toContain("limit 20");
    expect(directory).not.toMatch(/actor_user_id'|target_user_id'|actor_reference'|raw_app_meta_data|encrypted_password|last_sign_in_at/);
  });

  it("requires a target-specific exact confirmation for administrator grants", () => {
    const mutation = section(
      "create or replace function public.add_or_reactivate_creator_staff(",
      "create or replace function public.recover_zero_active_creator_admin(",
    );
    expect(mutation).toContain("admin_confirmation text default null");
    expect(mutation).toContain("'GRANT ADMIN ACCESS TO ' || normalized_email");
    expect(mutation).toContain("admin_confirmation is distinct from required_admin_confirmation");
    expect(mutation).toContain("Administrator confirmation is not accepted for reviewer access.");
  });

  it("matches one exact confirmed app account and preserves every existing stored role", () => {
    const mutation = section(
      "create or replace function public.add_or_reactivate_creator_staff(",
      "create or replace function public.recover_zero_active_creator_admin(",
    );
    expect(mutation).toContain("join public.creator_accounts creator_account");
    expect(mutation).toContain("lower(btrim(coalesce(auth_user.email, ''))) = normalized_email");
    expect(mutation).toContain("auth_user.email_confirmed_at is not null");
    expect(mutation).toContain("if membership_exists and existing_role <> normalized_role then");
    expect(mutation).toContain("set active = true");
    expect(mutation).not.toContain("set role = normalized_role");
    expect(mutation).not.toContain("delete from public.staff_members");
    expect(mutation).not.toContain("set active = false");
  });

  it("records only real add/reactivate changes with actor and prior/new state", () => {
    const mutation = section(
      "create or replace function public.add_or_reactivate_creator_staff(",
      "create or replace function public.recover_zero_active_creator_admin(",
    );
    expect(mutation).toContain("request_outcome text := 'already_active'");
    expect(mutation).toContain("if request_outcome in ('added', 'reactivated') then");
    expect(mutation).toContain("insert into public.creator_staff_access_events (");
    expect(mutation).toContain("current_user_id");
    expect(mutation).toContain("current_user_email");
    expect(mutation).toContain("case when membership_exists then existing_role else null end");
    expect(mutation).toContain("case when membership_exists then existing_active else null end");
  });

  it("keeps zero-admin recovery outside browser roles and fail-closed", () => {
    const recovery = section(
      "create or replace function public.recover_zero_active_creator_admin(",
      "revoke execute on function public.get_creator_staff_directory()",
    );
    expect(recovery).toContain("lock table public.staff_members in share row exclusive mode");
    expect(recovery).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(recovery).toContain("session_user <> current_user");
    expect(recovery).toContain("Service-role or direct database-owner access required.");
    expect(recovery).toContain("where staff.active and staff.role = 'admin'");
    expect(recovery).toContain("'RECOVER ADMIN ACCESS FOR ' || normalized_email");
    expect(recovery).toContain("existing_role <> 'admin'");
    expect(recovery).toContain("insert into public.creator_staff_access_events (");

    expect(migration).toContain(
      "revoke execute on function public.recover_zero_active_creator_admin(text, text, text)\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.recover_zero_active_creator_admin(text, text, text)\n  to service_role",
    );
    expect(migration).not.toMatch(/grant execute on function public\.recover_zero_active_creator_admin[\s\S]*?to authenticated/);
  });

  it("pins all privileged function search paths and exposes browser RPCs only to authenticated", () => {
    expect(migration.match(/security definer\nset search_path = public, auth, pg_temp/g)).toHaveLength(3);
    expect(migration.match(/public\.creator_is_active_staff\('admin'\)/g)).toHaveLength(2);
    expect(migration).toContain("grant execute on function public.get_creator_staff_directory()\n  to authenticated");
    expect(migration).toContain("grant execute on function public.add_or_reactivate_creator_staff(text, text, text)\n  to authenticated");
  });
});
