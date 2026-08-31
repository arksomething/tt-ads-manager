import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831141000_creator_pgcrypto_search_path.sql",
  ),
  "utf8",
);

describe("creator pgcrypto search-path compatibility migration", () => {
  it("resolves pgcrypto from Supabase's extensions schema without temp shadowing", () => {
    for (const signature of [
      "hash_program_deal_terms()",
      "enqueue_creator_notification(jsonb)",
      "complete_creator_notification_delivery(uuid, uuid, jsonb)",
      "schedule_creator_reminder_tick()",
    ]) {
      expect(migration).toContain(`alter function public.${signature}`);
    }

    expect(migration.match(/set search_path = pg_catalog, extensions, public(?:, auth)?, pg_temp;/g))
      .toHaveLength(4);
    expect(migration).not.toMatch(/search_path\s*=\s*[^;]*pg_temp[^;]*extensions/u);
  });
});
