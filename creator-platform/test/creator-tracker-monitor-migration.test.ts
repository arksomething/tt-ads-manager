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
const operatorAlertMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260903230000_creator_tracker_operator_alerts.sql",
  ),
  "utf8",
);
const deliveryFenceMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260903233000_creator_tracker_monitor_delivery_fence.sql",
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

  it("retains the base runtime incident while the forward policy gates human alerts", () => {
    expect(migration).toContain("incident_kind in ('heartbeat_stale', 'runtime_failing')");
    expect(migration).toContain("source_record.enabled and heartbeat_status = 'failing'");
    expect(migration).toContain("'incidentKind', 'runtime_failing'");
    expect(migration).toContain("heartbeat_status <> 'failing'");
    expect(migration).toContain("Degraded coverage remains live and non-paging.");

    expect(operatorAlertMigration).toContain(
      "source.last_issue_codes @> array['operator_action_required']::text[]",
    );
    expect(operatorAlertMigration).toContain("return null;");
    expect(operatorAlertMigration).toContain(
      "before insert on public.creator_tracker_monitor_incidents",
    );
  });

  it("silently resolves raw runtime failures and never queues a recovery email", () => {
    expect(operatorAlertMigration).toContain(
      "after update of enabled, last_received_at, last_status, last_issue_codes",
    );
    expect(operatorAlertMigration).toContain("incident.incident_kind = 'heartbeat_stale'");
    expect(operatorAlertMigration).toMatch(
      /new\.last_status = 'failing'\s+and new\.last_issue_codes\s+@> array\['operator_action_required'\]::text\[\]/u,
    );
    expect(operatorAlertMigration).toContain(
      "delivery.event_kind in ('opened', 'repeat', 'recovered')",
    );
    expect(operatorAlertMigration).toContain("incident_resolved_silently");
    expect(operatorAlertMigration).toContain(
      "before insert on public.creator_tracker_monitor_deliveries",
    );
    expect(operatorAlertMigration).toMatch(
      /if new\.event_kind = 'recovered' then\s+return null;/u,
    );
    expect(operatorAlertMigration).toContain("recovery_email_retired");
    expect(operatorAlertMigration).not.toContain("'eventKind', 'recovered'");
  });

  it("moves reminders from thirty minutes to twelve hours", () => {
    expect(operatorAlertMigration).toContain(
      "alter column repeat_after_seconds set default 43200",
    );
    expect(operatorAlertMigration).toContain("repeat_after_seconds = 43200");
    expect(operatorAlertMigration).toMatch(
      /function public\.authorize_creator_tracker_monitor_delivery[\s\S]+last_repeat_queued_at = greatest\(incident\.last_repeat_queued_at, check_time\)/u,
    );
    expect(operatorAlertMigration).toContain(
      "provider outage can therefore never produce a back-to-back reminder",
    );
  });

  it("resolves and cancels pre-policy non-action incidents without erasing sent evidence", () => {
    expect(operatorAlertMigration).toContain("with non_action_incidents as");
    expect(operatorAlertMigration).toMatch(
      /join public\.creator_tracker_monitor_sources source[\s\S]+source\.last_status = 'failing'[\s\S]+source\.last_issue_codes/u,
    );
    expect(operatorAlertMigration).toContain(
      "delivery.state in ('pending', 'leased', 'retry')",
    );
    expect(operatorAlertMigration).toContain("operator_marker_required");
    expect(operatorAlertMigration).not.toContain("delivery.state = 'sent'");
  });

  it("immediately queues a deterministic alert for an actionable pre-policy incident", () => {
    expect(operatorAlertMigration).toContain("with action_incidents as");
    expect(operatorAlertMigration).toContain(
      "':operator-action'",
    );
    expect(operatorAlertMigration).toContain(
      "outstanding.state in ('pending', 'leased', 'retry')",
    );
    expect(operatorAlertMigration).toContain("'operatorActionQueuedAt'");
    expect(operatorAlertMigration).toMatch(
      /sent_action\.state = 'sent'[\s\S]+sent_action\.event_payload->'issueCodes'[\s\S]+operator_action_required/u,
    );
    expect(operatorAlertMigration).toMatch(
      /source\.last_status = 'failing'[\s\S]+source\.last_issue_codes[\s\S]+operator_action_required/u,
    );
  });

  it("atomically revalidates each live lease immediately before an external send", () => {
    expect(operatorAlertMigration).toContain(
      "function public.authorize_creator_tracker_monitor_delivery(",
    );
    expect(operatorAlertMigration).toContain(
      "for update of delivery, incident, source",
    );
    expect(operatorAlertMigration).toContain(
      "source_last_received_at <= check_time",
    );
    expect(operatorAlertMigration).toContain("source_last_status = 'failing'");
    expect(operatorAlertMigration).toContain(
      "'issueCodes', to_jsonb(source_last_issue_codes)",
    );
    expect(operatorAlertMigration).toContain(
      "set event_payload = delivery_event_payload",
    );
    expect(operatorAlertMigration).toContain("'authorized', true");
    expect(operatorAlertMigration).toContain("send_authorized_at = check_time");
    expect(operatorAlertMigration).toContain(
      "Monitor delivery was not authorized immediately before send.",
    );
    expect(operatorAlertMigration).toContain(
      "grant execute on function public.authorize_creator_tracker_monitor_delivery(uuid, uuid)",
    );
  });

  it("treats authorization as point-of-no-return and backfills the reminder clock", () => {
    expect(deliveryFenceMigration).toContain(
      "function public.creator_tracker_monitor_resolve_silently()",
    );
    expect(deliveryFenceMigration).toMatch(
      /delivery\.state = 'leased'[\s\S]+delivery\.send_authorized_at is not null[\s\S]+delivery\.send_authorized_at >= delivery\.leased_at/u,
    );
    expect(deliveryFenceMigration).toContain("max(delivery.sent_at) as last_sent_at");
    expect(deliveryFenceMigration).toMatch(
      /last_repeat_queued_at = greatest\([\s\S]+latest_sent\.last_sent_at/u,
    );
    expect(deliveryFenceMigration).toContain("incident.state = 'open'");
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
