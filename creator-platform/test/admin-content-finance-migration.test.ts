import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260831162000_creator_content_earnings.sql"),
  "utf8",
);

describe("admin content and settlement contract", () => {
  it("projects exact settlement inputs and non-secret provider evidence", () => {
    expect(migration).toContain("'enrollmentId', earning.enrollment_id");
    expect(migration).toContain("'settlementId', (");
    expect(migration).toContain("'earningEntryIds', coalesce((");
    expect(migration).toContain("'payoutProvider', settlement.payout_provider");
    expect(migration).toContain("'externalPayoutId', settlement.external_payout_id");
  });

  it("creates only a pending ledger batch and requires provider evidence for paid", () => {
    expect(migration).toContain("create or replace function public.create_creator_settlement");
    expect(migration).toContain("and earning.state = 'approved'");
    expect(migration).toContain("where line.earning_entry_id = earning.id");
    expect(migration).toContain("A provider payout ID is required before marking paid.");
    expect(migration).not.toMatch(/https:\/\/api\.(wise|paypal|stripe)\./iu);
  });

  it("keeps observations immutable and duplicate delivery idempotent", () => {
    const observationFunction = migration.slice(
      migration.indexOf("create or replace function public.record_creator_post_observation"),
      migration.indexOf("create or replace function public.record_creator_earning"),
    );
    expect(observationFunction).toContain(
      "on conflict (source_system, external_observation_id) do nothing",
    );
    expect(observationFunction).not.toContain("do update");
    expect(observationFunction).toContain("into new_observation_id, existing_post_id");
    expect(migration).toContain("create trigger creator_guard_post_observations");
    expect(migration).toContain("before update or delete on public.creator_post_observations");
  });

  it("makes earning and settlement provider evidence write-once", () => {
    expect(migration).toContain("Earning provider evidence is write-once.");
    expect(migration).toContain("Settlement payout provider evidence is write-once.");
    expect(migration).toContain("Settlement payout ID evidence is write-once.");
    expect(migration).toContain(
      "requested_provider_reference <> current_provider_reference",
    );
    expect(migration).toContain("requested_provider_key <> current_provider_key");
    expect(migration).toContain("requested_payout_id <> current_payout_id");
    expect(migration).toContain(
      "external_reference = coalesce(external_reference, requested_provider_reference)",
    );
    expect(migration).toContain(
      "payout_provider = coalesce(payout_provider, requested_provider_key)",
    );
    expect(migration).toContain("current_payout_id,");
  });

  it("advances settled earnings only as one locked, evidence-consistent batch", () => {
    expect(migration).toContain(
      "Settled earnings must be advanced through their settlement.",
    );
    expect(migration).toContain("for update of earning");
    expect(migration).toContain(
      "Settlement lines do not match the immutable settlement total.",
    );
    expect(migration).toContain(
      "Settlement earning states or payout evidence do not match the requested transition.",
    );
    expect(migration).toContain(
      "Settled earnings can be advanced only by their owning settlement.",
    );
    expect(migration).toContain("'creator.settlement_transition_id'");
    expect(migration).toMatch(
      /where earning\.id = any\(earning_ids\)[\s\S]*?order by earning\.id[\s\S]*?for update;/u,
    );
    expect(migration).toContain(
      "earning.external_reference = coalesce(current_payout_id, requested_payout_id)",
    );
  });
});
