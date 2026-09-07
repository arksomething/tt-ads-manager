import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831167000_creator_tracker_ingestion_bridge.sql",
  ),
  "utf8",
);

describe("creator tracker ingestion database contract", () => {
  it("has a service-role-only, durable, organization-scoped receipt boundary", () => {
    expect(migration).toContain("function public.ingest_creator_tracker_batch(");
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("unique (organization_id, idempotency_key)");
    expect(migration).toContain("'IDEMPOTENCY_KEY_REUSED'");
    expect(migration).toContain("to service_role;");
    expect(migration).toContain("from public, anon, authenticated;");
  });

  it("retains the full bounded provider entity before account ownership exists", () => {
    expect(migration).toContain("create table public.creator_tracker_staged_entities");
    expect(migration).toContain("payload jsonb not null");
    expect(migration).toContain("'verified_account_not_found'");
    expect(migration).toContain("creator_tracker_ingest_items_append_only");
    expect(migration).toContain("resolution_state in ('retained', 'matched', 'unmatched', 'error')");
    expect(migration).toContain("function public.get_creator_tracker_ingestion_status(");
    expect(migration).toContain("'unmatchedObservations'");
  });

  it("promotes only exact verified stable identities and never fabricates metrics", () => {
    expect(migration).toContain("verified_account.status = 'verified'");
    expect(migration).toContain("verified_account.native_account_id = item_native_account_id");
    expect(migration).toContain("when 'tiktok' then 'TIKTOK'");
    expect(migration).toContain("when 'instagram' then 'INSTAGRAM_REELS'");
    expect(migration).toContain("view_metric := nullif(item_payload->>'views', '')::bigint");
    expect(migration).not.toMatch(/coalesce\([^\n]*views[^\n]*,\s*0\)/iu);
  });

  it("makes canonical observations immutable and duplicate-safe", () => {
    expect(migration).toContain("creator_tracker_observations_immutable");
    expect(migration).toContain("on conflict (source_system, external_observation_id) do nothing");
    expect(migration).toContain("Observation identity was reused with different immutable evidence.");
    expect(migration).not.toMatch(/on conflict \(source_system, external_observation_id\) do update/iu);
  });

  it("rejects staged identity rebinding and stale canonical attribution", () => {
    expect(migration).toContain(
      "existing_stage.payload->>'creatorId' is distinct from item_payload->>'creatorId'",
    );
    expect(migration).toContain(
      "existing_stage.payload->>'accountId' is distinct from item_payload->>'accountId'",
    );
    expect(migration).toContain(
      "existing_stage.payload->>'firstSeenAt' is distinct from item_payload->>'firstSeenAt'",
    );
    expect(migration).toContain("'staged_canonical_link_conflict'");
    expect(migration).toContain("staged_video.resolution_state <> 'matched'");
    expect(migration).toContain("staged_account.resolution_state <> 'matched'");
    expect(migration).toContain("staged_account.platform is distinct from item_platform");
    expect(migration).toContain("'staged_account_platform_mismatch'");
    expect(migration).toContain("verified_account.platform = canonical_platform");
    expect(migration).toContain(
      "verified_account.native_account_id = staged_account.native_account_id",
    );
    expect(migration).toContain(
      "staged_account.canonical_platform_account_id is distinct from platform_account_id",
    );
    expect(migration).toContain(
      "existing_post.platform_account_id is distinct from platform_account_id",
    );
  });

  it("reconciles native-ID and URL identities without cross-account rebinding", () => {
    expect(migration).toContain(
      "hashtextextended('creator-post-identity:' || canonical_platform, 0)",
    );
    expect(migration).toContain("post.canonical_url = incoming_canonical_url");
    expect(migration).toContain(
      "existing_post.id <> url_identity_post.id",
    );
    expect(migration).toContain("existing_post := url_identity_post");
    expect(migration).toContain(
      "existing_post.account_id <> canonical_account_id",
    );
    expect(migration).toContain(
      "existing_post.native_post_id <> item_payload->>'nativeVideoId'",
    );
    expect(migration).toContain(
      "existing_post.canonical_url <> incoming_canonical_url",
    );
    expect(migration).toContain(
      "native_post_id = coalesce(creator_posts.native_post_id, item_payload->>'nativeVideoId')",
    );
    expect(migration).toContain(
      "platform_account_id = coalesce(creator_posts.platform_account_id, platform_account_id)",
    );
  });

  it("resolves pgcrypto from the production Supabase extensions schema", () => {
    expect(migration).toContain(
      "set search_path = pg_catalog, extensions, public, auth, pg_temp",
    );
  });
});
