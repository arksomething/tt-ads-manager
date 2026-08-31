-- Supabase installs pgcrypto in the locked `extensions` schema, while a
-- standalone PostgreSQL installation commonly installs it in `public`.
-- Keep pg_catalog first and pg_temp last so SECURITY DEFINER routines resolve
-- pgcrypto consistently without admitting temporary-schema shadowing.

alter function public.hash_program_deal_terms()
  set search_path = pg_catalog, extensions, public, pg_temp;

alter function public.enqueue_creator_notification(jsonb)
  set search_path = pg_catalog, extensions, public, auth, pg_temp;

alter function public.complete_creator_notification_delivery(uuid, uuid, jsonb)
  set search_path = pg_catalog, extensions, public, auth, pg_temp;

alter function public.schedule_creator_reminder_tick()
  set search_path = pg_catalog, extensions, public, auth, pg_temp;
