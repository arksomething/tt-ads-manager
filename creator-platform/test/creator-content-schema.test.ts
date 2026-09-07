import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260831163000_creator_content_library.sql"),
  "utf8",
);

describe("creator content database boundary", () => {
  it("creates separate library and assignment records under RLS", () => {
    for (const table of [
      "program_scripts",
      "creator_script_assignments",
      "program_assets",
      "creator_asset_assignments",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    }
  });

  it("keeps staff writes behind security-definer authorization", () => {
    expect(migration).toContain("function public.creator_is_active_staff(required_role text default 'reviewer')");
    expect(migration).toContain("function public.save_program_script(script_input jsonb)");
    expect(migration).toContain("function public.assign_program_script(assignment_input jsonb)");
    expect(migration).toContain("function public.register_program_asset(asset_input jsonb)");
    expect(migration).toContain("function public.assign_program_asset(assignment_input jsonb)");
    expect(migration).toMatch(/if not public\.creator_is_active_staff\('reviewer'\) then/g);
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)\s+on public\.(program_scripts|program_assets)/i);
  });

  it("only exposes published, explicitly assigned creator content", () => {
    expect(migration).toContain("function public.get_own_creator_content_library()");
    expect(migration).toContain("enrollment.account_id = auth.uid()");
    expect(migration).toContain("script.status = 'published'");
    expect(migration).toContain("asset.status = 'published'");
    expect(migration).toContain("assignment.state <> 'withdrawn'");
  });

  it("bootstraps a private bucket with assignment-aware object reads", () => {
    expect(migration).toContain("values ('creator-program-assets', 'creator-program-assets', false, 52428800)");
    expect(migration).toContain("create policy creator_program_assets_staff_insert");
    expect(migration).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(migration).toContain("create policy creator_program_assets_authorized_read");
    expect(migration).toContain("public.creator_can_read_program_asset_object(name)");
    expect(migration).toContain("public.creator_can_delete_program_asset_object(name)");
    expect(migration).toContain("and not exists (");
    expect(migration).toContain("asset.storage_path = object_name");
    expect(migration).toContain("from storage.objects stored_object");
    expect(migration).not.toContain("values ('creator-program-assets', 'creator-program-assets', true");
  });
});
