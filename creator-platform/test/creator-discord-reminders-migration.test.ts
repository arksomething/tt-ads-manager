import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260831140000_creator_discord_reminders.sql",
);
const migration = readFileSync(migrationPath, "utf8");

function section(from: string, until: string) {
  const start = migration.indexOf(from);
  const end = migration.indexOf(until, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

const tables = [
  "discord_oauth_attempts",
  "creator_discord_connections",
  "creator_discord_preferences",
  "creator_discord_subscriptions",
  "creator_notifications",
  "creator_notification_deliveries",
  "creator_notification_delivery_attempts",
  "creator_discord_role_sync_jobs",
  "creator_discord_worker_heartbeats",
  "creator_discord_worker_requests",
] as const;

describe("creator Discord and reminder migration", () => {
  it("puts every Discord table behind RLS and grants creators read-only own-row access", () => {
    for (const table of tables) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(migration).toContain(
        `revoke all on public.${table} from public, anon, authenticated;`,
      );
    }

    expect(migration).toContain(
      ") on public.creator_discord_connections to authenticated;",
    );
    expect(migration).toContain(
      ") on public.creator_discord_preferences to authenticated;",
    );
    expect(migration).toContain(
      "on public.creator_discord_subscriptions to authenticated;",
    );
    expect(migration).toContain(
      ") on public.creator_notifications to authenticated;",
    );
    expect(migration).toContain(
      ") on public.creator_notification_deliveries to authenticated;",
    );
    expect(migration).not.toMatch(
      /grant\s+select\s+on\s+public\.creator_(discord|notification)/i,
    );
    const creatorReadGrants = section(
      "grant select (\n  account_id, discord_user_id",
      "revoke execute on function public.creator_valid_discord_snowflake",
    );
    for (const internalColumn of [
      "lease_token",
      "leased_by",
      "provider_nonce",
      "provider_message_id",
      "provider_channel_id",
      "dm_channel_id",
      "desired_managed_role_keys",
      "managed_role_revision",
      "variables",
      "payload_sha256",
    ]) {
      expect(creatorReadGrants).not.toContain(internalColumn);
    }

    expect(migration).not.toMatch(/grant\s+(insert|update|delete)\s+on\s+public\.creator_/i);
    expect(migration).toContain("notification.account_id = auth.uid()");
  });

  it("stores verified Discord snowflakes without OAuth or bot tokens", () => {
    const connectionTable = section(
      "create table public.creator_discord_connections",
      "create unique index creator_discord_connections_one_active_account",
    );
    expect(connectionTable).toContain("discord_user_id text not null");
    expect(migration).toContain("candidate ~ '^[0-9]{17,20}$'");
    expect(migration).toContain("where disconnected_at is null;");
    expect(migration).toContain("creator_discord_connections_one_active_discord_user");
    expect(connectionTable).not.toMatch(/access_token|refresh_token|bot_token/i);
    expect(migration).toContain("state_hash text not null unique");
    expect(migration).toContain("discord_oauth_attempts_one_active_account");
    expect(migration).toContain("where consumed_at is null;");
    expect(migration).toContain("and oauth_attempt.consumed_at is null;");
    expect(migration).toContain("set consumed_at = now()");
    expect(migration).toContain("oauth_attempt.consumed_at is null");
  });

  it("defaults to no Discord consent and fail-closed optional topics", () => {
    expect(migration).toContain("discord_opt_in boolean not null default false");
    expect(migration).toContain("discord_opted_in_at timestamptz");
    expect(migration).toContain(
      "check (discord_opt_in = (discord_opted_in_at is not null))",
    );
    expect(migration).toContain("timezone text not null default 'UTC'");
    expect(migration).toContain("quiet_start time without time zone not null default time '21:00'");
    expect(migration).toContain("quiet_end time without time zone not null default time '09:00'");
    expect(migration).toContain("select 1 from pg_timezone_names where name = requested_timezone");
    expect(migration).toContain("topic_name not in ('posting', 'performance')");
    expect(migration).toContain("topic in ('posting', 'performance')");
    expect(migration).toContain("and enabled;");
    expect(migration).toContain(
      "function public.set_creator_discord_preferences(preference_input jsonb)",
    );
  });

  it("uses logical and delivery idempotency keys without storing rendered message bodies", () => {
    expect(migration).toContain("unique (account_id, event_key)");
    expect(migration).toContain("idempotency_key text not null unique");
    expect(migration).toContain("provider_nonce text not null unique");
    expect(migration).toContain("char_length(provider_nonce) between 1 and 25");
    expect(migration).toContain("existing_payload_sha256 <> submitted_payload_sha256");
    expect(migration).toContain("notification_created boolean");
    expect(migration).not.toMatch(/rendered_(body|content)|message_body/i);
  });

  it("claims atomically and counts only actual begin-send attempts", () => {
    const claim = section(
      "create or replace function public.claim_creator_notification_deliveries",
      "create or replace function public.begin_creator_notification_delivery",
    );
    const begin = section(
      "create or replace function public.begin_creator_notification_delivery",
      "create or replace function public.complete_creator_notification_delivery",
    );

    expect(claim).toContain("for update of delivery skip locked");
    expect(claim).toContain("delivery.recovery_required");
    expect(claim).toContain("claim_candidates.recovery_required as requires_recovery");
    expect(claim).toContain("claimed.requires_recovery");
    expect(claim).toContain("delivery.attempt_count + 1 as prospective_attempt_number");
    expect(claim).not.toContain("attempt_count = delivery.attempt_count + 1");
    expect(begin).toContain("attempt_count = attempt_count + 1");
    expect(begin).toContain("delivery_context.attempt_count + 1");
    expect(begin).toContain("discord_opt_out");
    expect(begin).toContain("topic_disabled");
    expect(begin).toContain("discord_connection_changed");
    expect(begin).toContain("quiet_hours");
    expect(begin).toContain("creator_timezone");
  });

  it("enforces automated cadence while allowing explicit creator tests", () => {
    const enqueue = section(
      "create or replace function public.enqueue_creator_notification",
      "create or replace function public.enqueue_creator_discord_test",
    );
    const creatorTest = section(
      "create or replace function public.enqueue_creator_discord_test",
      "create or replace function public.claim_creator_notification_deliveries",
    );
    const begin = section(
      "create or replace function public.begin_creator_notification_delivery",
      "create or replace function public.complete_creator_notification_delivery",
    );
    expect(begin).toContain("notification_type <> 'creator_test'");
    expect(begin).toContain("template_key <> 'creator.test'");
    expect(begin).toContain("automated_sent_today >= 2");
    expect(begin).toContain("last_automated_sent_at + interval '4 hours'");
    expect(begin).toContain("'daily_cadence'");
    expect(begin).toContain("'four_hour_cadence'");
    expect(begin).toContain("at time zone delivery_context.creator_timezone");
    expect(begin).toContain("pg_advisory_xact_lock");
    expect(begin).toContain("delivery_context.notification_type <> 'creator_test'");
    expect(begin).toContain("and delivery_context.quiet_hours_enabled");
    expect(enqueue).toContain("submitted_notification_type = 'creator_test'");
    expect(enqueue).toContain(
      "(submitted_notification_type = 'creator_test') <>\n      (submitted_template_key = 'creator.test')",
    );
    expect(enqueue).toContain("submitted_template_version <> 1");
    expect(enqueue).toContain("and preferences.discord_opt_in");
    expect(enqueue).toContain("and connection.membership_status = 'member'");
    expect(enqueue).toContain("and subscription.topic = 'account'");
    expect(creatorTest).toContain("function public.enqueue_creator_discord_test(target_account_id uuid)");
    expect(creatorTest).toContain("date_trunc('hour', now())");
    expect(creatorTest).toContain("hour_start + interval '2 hours'");
    expect(creatorTest).toContain("from public.enqueue_creator_notification(jsonb_build_object(");
    expect(creatorTest).toContain("and not delivery.recovery_required");
  });

  it("persists evidence-only recovery across leases and policy deferrals", () => {
    const deliveryTable = section(
      "create table public.creator_notification_deliveries",
      "create index creator_notification_deliveries_claim",
    );
    const claim = section(
      "create or replace function public.claim_creator_notification_deliveries",
      "create or replace function public.begin_creator_notification_delivery",
    );
    const begin = section(
      "create or replace function public.begin_creator_notification_delivery",
      "create or replace function public.complete_creator_notification_delivery",
    );
    const complete = section(
      "create or replace function public.complete_creator_notification_delivery",
      "create or replace function public.schedule_creator_reminder_tick",
    );
    const scheduler = section(
      "create or replace function public.schedule_creator_reminder_tick",
      "create or replace function public.consume_creator_discord_worker_request",
    );

    expect(deliveryTable).toContain("recovery_required boolean not null default false");
    expect(claim).toContain("recovery_required = recovery_required or state = 'sending'");
    expect(claim).toContain("set recovery_required = true");
    expect(claim).toContain("where state = 'delivery_unknown'");
    expect(claim).toContain("claim_candidates.recovery_required as requires_recovery");
    expect(claim).toContain(
      "when claim_candidates.recovery_required then delivery.target_connection_id",
    );
    expect(claim).toContain(
      "when claim_candidates.recovery_required then delivery.target_discord_user_id",
    );
    expect(claim).toContain(
      "when claim_candidates.recovery_required then delivery.target_dm_channel_id",
    );
    expect(scheduler).toContain("recovery_required = recovery_required or state = 'sending'");
    expect(scheduler).toContain("set recovery_required = true");
    expect(begin).not.toMatch(/recovery_required\s*=\s*false/u);
    expect(begin).toContain("not delivery_context.recovery_required");
    expect(complete).toContain("when final_state = 'delivery_unknown' then true");
    expect(complete).toContain("when final_state in ('sent', 'dead') then false");
    expect(complete).toContain("else delivery.recovery_required");
    expect(complete).toContain("when final_state = 'retry'\n      and delivery_record.attempt_count >= 8");
    expect(complete).not.toContain("when final_state in ('retry', 'delivery_unknown')");
    expect(complete).toContain("where id = delivery_record.target_connection_id");
    expect(complete).toContain("and discord_user_id = delivery_record.target_discord_user_id");
    expect(complete).toContain("and disconnected_at is null");
  });

  it("accepts the exact worker delivery receipt and completes idempotently", () => {
    const complete = section(
      "create or replace function public.complete_creator_notification_delivery",
      "create or replace function public.schedule_creator_reminder_tick",
    );
    for (const key of [
      "outcome",
      "error_class",
      "http_status",
      "discord_code",
      "retry_at",
      "delivered_at",
      "discord_channel_id",
      "discord_message_id",
      "rendered_sha256",
    ]) {
      expect(complete).toContain(`$3->>'${key}'`);
    }
    expect(complete).toContain("requested_outcome = 'sent'");
    expect(complete).toContain("supplied_rendered_sha256 !~ '^[a-f0-9]{64}$'");
    expect(complete).toContain("attempt.completed_at is not null");
    expect(complete).toContain("return query select prior_attempt.outcome, prior_attempt.receipt");
    expect(complete).toContain("delivery_record.attempt_count >= 8");
    expect(complete).toContain("'not_guild_member'");
    expect(complete).toContain("'bot_guild_access'");
    expect(complete).toContain("requested_outcome not in ('retry', 'unknown')");
    expect(complete).toContain(
      "coalesce(supplied_error_code, '') not in ('bot_unauthorized', 'bot_guild_access')",
    );
    expect(complete).toContain("creator_mark_discord_connection_not_member(");
  });

  it("closes all nonterminal Discord work when live membership is revoked", () => {
    const membership = section(
      "create or replace function public.creator_mark_discord_connection_not_member",
      "create or replace function public.enqueue_creator_notification",
    );
    expect(membership).toContain("set membership_status = 'not_member'");
    for (const state of ["'scheduled'", "'leased'", "'sending'", "'retry'", "'delivery_unknown'"]) {
      expect(membership).toContain(state);
    }
    expect(membership).toContain("else 'not_guild_member'");
    expect(membership).toContain("then 'creator_test_membership_lost'");
    expect(membership).toContain(
      "recovery_required = delivery.recovery_required or delivery.state = 'sending'",
    );
    expect(membership).toContain("where discord_user_id = target_discord_user_id");
    expect(membership).toContain("state in ('scheduled', 'retry')");
    expect(migration).toContain(
      "revoke execute on function public.creator_mark_discord_connection_not_member(uuid)",
    );
  });

  it("uses each fresh opt-in as a no-backfill watermark", () => {
    const preferences = section(
      "create or replace function public.set_creator_discord_preferences",
      "create or replace function public.upsert_creator_discord_connection",
    );
    const enqueue = section(
      "create or replace function public.enqueue_creator_notification",
      "create or replace function public.enqueue_creator_discord_test",
    );
    const begin = section(
      "create or replace function public.begin_creator_notification_delivery",
      "create or replace function public.complete_creator_notification_delivery",
    );
    expect(preferences).toContain(
      "when requested_opt_in and not existing_preferences.discord_opt_in then now()",
    );
    expect(preferences).toContain("when requested_opt_in then existing_preferences.discord_opted_in_at");
    expect(preferences).toContain("else null");
    expect(preferences).toContain("notification.source_occurred_at >= preferences.discord_opted_in_at");
    expect(preferences).toContain("notification.scheduled_for >= preferences.discord_opted_in_at");
    expect(enqueue).toContain("'source_occurred_at', submitted_source_occurred_at");
    expect(enqueue).toContain("'predates_discord_opt_in'");
    expect(begin).toContain(
      "delivery_context.notification_source_occurred_at < delivery_context.discord_opted_in_at",
    );
    expect(begin).toContain(
      "delivery_context.notification_scheduled_for < delivery_context.discord_opted_in_at",
    );
  });

  it("never resurrects a creator test without a fresh explicit click", () => {
    const preferences = section(
      "create or replace function public.set_creator_discord_preferences",
      "create or replace function public.upsert_creator_discord_connection",
    );
    const creatorTest = section(
      "create or replace function public.enqueue_creator_discord_test",
      "create or replace function public.claim_creator_notification_deliveries",
    );
    const begin = section(
      "create or replace function public.begin_creator_notification_delivery",
      "create or replace function public.complete_creator_notification_delivery",
    );
    const scheduler = section(
      "create or replace function public.schedule_creator_reminder_tick",
      "create or replace function public.consume_creator_discord_worker_request",
    );
    expect(preferences).toContain("then 'creator_test_opted_out'");
    expect(preferences).toContain("then 'cancelled'");
    expect(preferences).toContain(
      "recovery_required = delivery.recovery_required or delivery.state = 'sending'",
    );
    expect(creatorTest).toContain("delivery.attempt_count = 0");
    expect(creatorTest).toContain("'creator_test_membership_lost'");
    expect(creatorTest).toContain("'creator_test_connectivity_lost'");
    expect(begin).toContain("then 'creator_test_connectivity_lost'");
    expect(scheduler).toContain("notification.notification_type <> 'creator_test'");
    expect(scheduler).not.toMatch(
      /notification\.notification_type = 'creator_test'\s+or\s+\(/u,
    );
  });

  it("derives only reviewed application and agreement reminders from canonical rows", () => {
    const scheduler = section(
      "create or replace function public.schedule_creator_reminder_tick",
      "create or replace function public.consume_creator_discord_worker_request",
    );
    expect(scheduler).toContain("'application:' || application_source.id::text || ':submitted'");
    expect(scheduler).toContain("'application.received'");
    expect(scheduler).toContain("':status:' || application_source.status");
    expect(scheduler).toContain("'application.status'");
    expect(scheduler).toContain("jsonb_build_object('status', application_source.status)");
    expect(scheduler).toContain("('day1'::text, interval '24 hours')");
    expect(scheduler).toContain("('day3'::text, interval '72 hours')");
    expect(scheduler).toContain("('day7'::text, interval '7 days')");
    expect(scheduler).toContain("'agreement.ready'");
    expect(scheduler).toContain("'agreement.reminder'");
    expect(scheduler).toContain("'creator_accepted', 'completed', 'declined', 'voided', 'error'");
    expect(scheduler).toContain("application_source.status = 'withdrawn'");
    expect(scheduler).not.toContain("'posting'");
    expect(scheduler).not.toContain("'performance'");
    expect(scheduler).not.toMatch(/viral|view[_ ]?limit/i);
  });

  it("reconciles only semantic managed roles on links and lifecycle changes", () => {
    expect(migration).toContain(
      "desired_role_keys <@ array['onboarding', 'active', 'at_risk', 'top_performer']::text[]",
    );
    expect(migration).toContain("after update of lifecycle_status on public.creator_accounts");
    expect(migration).toContain("new.lifecycle_status is not distinct from old.lifecycle_status");
    expect(migration).toContain("creator_discord_desired_role_keys(new.auth_user_id)");
    expect(migration).toContain("desired_role_keys text[]");
    expect(migration).toContain("managed_role_revision = managed_role_revision + 1");
    expect(migration).toContain("authority_revision bigint not null unique");
    expect(migration).toContain("role_job.state in ('scheduled', 'retry', 'blocked')");
    expect(migration).toContain("last_error_code = 'superseded'");
    expect(migration).toContain("leased_job.state = 'leased'");
    expect(migration).toContain(
      "newer_job.authority_revision > role_job.authority_revision",
    );
    expect(migration).toContain("reassertion_key text default null");
    expect(migration).toContain("':late:' || reassertion_key");
    expect(migration).toContain(
      "target_connection_id::text || ':' || current_role_revision::text",
    );
    expect(migration).toContain("current_role_keys is distinct from normalized_role_keys");
    expect(migration).not.toMatch(/desired_role_ids|discord_role_ids/i);
    const roleComplete = section(
      "create or replace function public.complete_creator_discord_role_sync_job",
      "create or replace function public.get_current_staff_member",
    );
    expect(roleComplete).toContain("'bot_guild_access'");
    expect(roleComplete).toContain("requested_outcome <> 'retry'");
    expect(roleComplete).toContain("'late_completion', true");
    expect(roleComplete).toContain("public.creator_discord_desired_role_keys(reassert_connection.account_id)");
    expect(roleComplete).toContain("$2::text");
    expect(roleComplete).toContain(
      "coalesce(supplied_error_code, '') not in ('bot_unauthorized', 'bot_guild_access')",
    );
  });

  it("uses single-use worker request nonces and the exact heartbeat contract", () => {
    const replay = section(
      "create or replace function public.consume_creator_discord_worker_request",
      "create or replace function public.record_creator_discord_worker_heartbeat",
    );
    const heartbeat = section(
      "create or replace function public.record_creator_discord_worker_heartbeat",
      "create or replace function public.claim_creator_discord_role_sync_jobs",
    );
    expect(replay).toContain("abs(extract(epoch from (now() - $3))) > 300");
    expect(replay).toContain("on conflict on constraint creator_discord_worker_requests_pkey do nothing");
    expect(replay).toContain("now() + interval '10 minutes'");
    for (const key of [
      "worker_id",
      "boot_id",
      "protocol_version",
      "worker_version",
      "observed_at",
    ]) {
      expect(heartbeat).toContain(`$1->>'${key}'`);
    }
    expect(heartbeat).toContain("submitted_protocol_version <> 1");
  });

  it("freezes first-seen event timestamps so mutable source timestamps cannot abort a tick", () => {
    const enqueue = section(
      "create or replace function public.enqueue_creator_notification",
      "create or replace function public.enqueue_creator_discord_test",
    );
    expect(enqueue).toContain(
      "submitted_source_occurred_at := existing_source_occurred_at",
    );
    expect(enqueue).toContain("submitted_scheduled_for := existing_scheduled_for");
    expect(enqueue).toContain("submitted_expires_at := existing_expires_at");
    expect(enqueue).toContain("existing_payload_sha256 <> submitted_payload_sha256");
  });

  it("keeps worker mutations service-only and creator mutations narrow", () => {
    expect(migration).toContain(
      "grant execute on function public.create_discord_oauth_attempt(text, text, timestamptz)\n" +
        "to authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.disconnect_creator_discord()\n" +
        "to authenticated;",
    );
    for (const signature of [
      "consume_discord_oauth_attempt(text)",
      "upsert_creator_discord_connection(uuid, jsonb, text)",
      "enqueue_creator_notification(jsonb)",
      "enqueue_creator_discord_test(uuid)",
      "claim_creator_notification_deliveries(text, integer, integer)",
      "begin_creator_notification_delivery(uuid, uuid)",
      "complete_creator_notification_delivery(uuid, uuid, jsonb)",
      "schedule_creator_reminder_tick()",
      "record_creator_discord_worker_heartbeat(jsonb)",
    ]) {
      expect(migration).toContain(`grant execute on function public.${signature}\nto service_role;`);
    }
  });

  it("returns only sanitized aggregate operations data to staff", () => {
    const overview = section(
      "create or replace function public.get_creator_discord_operations_overview",
      "alter table public.discord_oauth_attempts enable row level security",
    );
    expect(overview).toContain("'recent_delivery_failures'");
    expect(overview).toContain("'attempt_number'");
    expect(overview).toContain("'delivery_state'");
    expect(overview).toContain("'error_code'");
    expect(overview).toContain("'provider_status'");
    expect(overview).not.toContain("'attempt_id'");
    expect(overview).not.toContain("'delivery_id'");
    expect(overview).not.toContain("discord_user_id");
    expect(overview).not.toContain("target_discord_user_id");
    expect(overview).not.toContain("variables");
    expect(overview).not.toContain("receipt");
  });
});
