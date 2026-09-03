import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260903090000_creator_tracker_deadman_monitor.sql",
  ),
  "utf8",
);

describe("creator tracker off-host monitor database contract", () => {
  it("seeds a disabled 60-second source with a five-minute stale threshold", () => {
    expect(migration).toContain("'creator-tracker-xps'");
    expect(migration).toMatch(/'creator-tracker-xps',\s*false,\s*60,\s*300,\s*1800/iu);
    expect(migration).toContain("A fresh heartbeat is required before enabling the monitor.");
  });

  it("atomically consumes a nonce, uses database receipt time, and enqueues recovery", () => {
    const start = migration.indexOf(
      "function public.record_creator_tracker_monitor_heartbeat(",
    );
    const end = migration.indexOf(
      "function public.set_creator_tracker_monitor_enabled(",
    );
    const recordFunction = migration.slice(start, end);
    expect(recordFunction).toContain("receipt_time timestamptz := clock_timestamp()");
    expect(recordFunction).toContain("insert into public.creator_tracker_monitor_requests");
    expect(recordFunction).toContain("last_received_at = receipt_time");
    expect(recordFunction).toContain("state = 'resolved'");
    expect(recordFunction).toContain("'recovered'");
    expect(recordFunction).toContain("'replayed', true");
    expect(recordFunction).toContain("interval '11 minutes'");
    expect(recordFunction).not.toMatch(/last_received_at\s*=\s*heartbeat_observed_at/iu);
  });

  it("opens one stale incident, repeats at 30 minutes, and leases with fencing", () => {
    expect(migration).toContain("create unique index creator_tracker_monitor_one_open_incident");
    expect(migration).toContain("where state = 'open'");
    expect(migration).toContain("source.last_received_at <= evaluation_time - make_interval");
    expect(migration).toContain("source.repeat_after_seconds");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_token = gen_random_uuid()");
    expect(migration).toContain("completion_lease_token = target_lease_token");
    expect(migration).toContain("last_evaluated_at = evaluation_time");
    expect(migration).toContain("provider_message_id");
  });

  it("pages immediately for runtime failure without treating degraded coverage as down", () => {
    expect(migration).toContain("incident_kind in ('heartbeat_stale', 'runtime_failing')");
    expect(migration).toContain("source_record.enabled and heartbeat_status = 'failing'");
    expect(migration).toContain("'incidentKind', 'runtime_failing'");
    expect(migration).toContain("heartbeat_status <> 'failing'");
    expect(migration).toContain("Degraded coverage remains live and non-paging.");
  });

  it("uses a separate service-role-only operations outbox", () => {
    expect(migration).toContain("create table public.creator_tracker_monitor_deliveries");
    expect(migration).not.toContain("insert into public.creator_notification_deliveries");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("from public, anon, authenticated;");
    expect(migration).toContain("to service_role;");
  });

  it("stops paging cleanly when an operator disables the monitor", () => {
    expect(migration).toContain("last_error_code = 'monitor_disabled'");
    expect(migration).toContain("if not target_enabled then");
    expect(migration).toContain("and source.enabled");
  });

  it("schedules an off-host Edge evaluation every minute using Vault", () => {
    expect(migration).toContain("create extension if not exists pg_net");
    expect(migration).toContain("create extension if not exists pg_cron");
    expect(migration).toContain("from vault.decrypted_secrets");
    expect(migration).toContain("'creator-tracker-monitor-every-minute'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain("net.http_post(");
    expect(migration).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
