import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260831162000_creator_content_earnings.sql"),
  "utf8",
);

const protectedTables = [
  "creator_posts",
  "creator_content_submissions",
  "creator_content_submission_events",
  "creator_post_provider_identities",
  "creator_post_observations",
  "creator_earning_entries",
  "creator_earning_state_events",
  "creator_settlements",
  "creator_settlement_lines",
  "creator_settlement_state_events",
] as const;

describe("creator content and earnings database contract", () => {
  it("keeps creator claims separate from canonical posts and tracker evidence", () => {
    expect(migration).toContain("create table public.creator_content_submissions");
    expect(migration).toContain("create table public.creator_posts");
    expect(migration).toContain("create table public.creator_post_provider_identities");
    expect(migration).toContain("create table public.creator_post_observations");
    expect(migration).toContain("external_observation_id text not null");
    expect(migration).toContain("external_run_id text");
    expect(migration).toContain("raw_archive_ref text");
    expect(migration).toContain("unique (source_system, external_observation_id)");
    expect(migration).toContain("match_state in (");
    expect(migration).toContain("'submitted',");
    expect(migration).toContain("'needs_review',");
    expect(migration).toContain("'matched',");
  });

  it("treats each exact platform URL as one canonical post identity", () => {
    expect(migration).toContain("create unique index creator_posts_canonical_url_identity");
    expect(migration).toContain("on public.creator_posts (platform, canonical_url)");
    expect(migration).toContain("where canonical_url is not null;");
    expect(migration).toContain("post.canonical_url = matched_url");
    expect(migration).toContain(
      "native_identity_post.id <> url_identity_post.id",
    );
    expect(migration).toContain(
      "The native post ID and canonical URL belong to different canonical posts.",
    );
  });

  it("reuses URL identities only for the same creator and selected post", () => {
    expect(migration).toContain("target_post_record := url_identity_post");
    expect(migration).toContain(
      "target_post_record.account_id <> submission_record.account_id",
    );
    expect(migration).toContain(
      "The selected post conflicts with the supplied native ID or canonical URL.",
    );
    expect(migration).toContain(
      "target_post_record.platform_account_id <> submission_record.platform_account_id",
    );
    expect(migration).toContain(
      "native_post_id = coalesce(creator_posts.native_post_id, matched_native_id)",
    );
    expect(migration).toContain(
      "canonical_url = coalesce(creator_posts.canonical_url, matched_url)",
    );
  });

  it("accepts creator submissions only through the authenticated RPC", () => {
    expect(migration).toContain("function public.submit_creator_content(content_input jsonb)");
    expect(migration).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain("enrollment.status = 'active'");
    expect(migration).toContain(
      "grant execute on function public.submit_creator_content(jsonb) to authenticated;",
    );
    expect(migration).toContain(
      "revoke all on public.creator_content_submissions from public, anon, authenticated;",
    );
  });

  it("uses immutable minor-unit ledger entries and forward-only states", () => {
    expect(migration).toContain("amount_minor bigint not null");
    expect(migration).toContain("currency_exponent smallint not null");
    expect(migration).toContain(
      "state in ('estimated', 'pending', 'approved', 'paid', 'reconciled')",
    );
    expect(migration).toContain("Earning facts are immutable; create a superseding entry.");
    expect(migration).toContain("old.state = 'estimated' and new.state = 'pending'");
    expect(migration).toContain("old.state = 'paid' and new.state = 'reconciled'");
    expect(migration).toContain("creator_earning_state_events");
    expect(migration).toContain("creator_settlement_state_events");
    expect(migration).toContain("A provider payout ID is required before marking paid.");
  });

  it("enables RLS and routes staff writes through role-checked RPCs", () => {
    for (const table of protectedTables) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(migration).toContain("creator_content_require_staff(false)");
    expect(migration).toContain("creator_content_require_staff(true)");
    expect(migration).toContain("function public.match_creator_content_submission(");
    expect(migration).toContain("function public.record_creator_earning(earning_input jsonb)");
    expect(migration).toContain("function public.create_creator_settlement(settlement_input jsonb)");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)\s+on\s+public\.creator_/iu);
  });

  it("exposes creator-safe workspaces without fabricating aggregate balances", () => {
    expect(migration).toContain("function public.get_own_content_workspace()");
    expect(migration).toContain("function public.get_own_earnings_workspace()");
    expect(migration).toContain("earning.amount_minor::text");
    expect(migration).not.toContain("'balance', 0");
    expect(migration).not.toContain("'viewCount', 0");
  });
});
