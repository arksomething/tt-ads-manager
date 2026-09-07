-- Keep a creator's embedded signing link resumable after SignWell reports that
-- signing has started. `creator_accepted` is reserved for the provider's
-- `document_signed` evidence while `document_completed` remains the only event
-- that can activate an enrollment after artifact archival.

do $migration$
declare
  current_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.process_signwell_agreement_event(jsonb)'::regprocedure
  ) into current_definition;

  if current_definition is null then
    raise exception 'process_signwell_agreement_event(jsonb) is not installed.';
  end if;

  if position(
    'when ''document_in_progress'' then ''creator_accepted''' in current_definition
  ) > 0 then
    patched_definition := replace(
      current_definition,
      'when ''document_in_progress'' then ''creator_accepted''',
      'when ''document_in_progress'' then ''viewed'''
    );
    execute patched_definition;
  elsif position(
    'when ''document_in_progress'' then ''viewed''' in current_definition
  ) = 0 then
    raise exception 'The SignWell in-progress mapping was not recognized.';
  end if;
end
$migration$;

-- Repair any pre-existing record that was advanced solely by an in-progress
-- event. Never move a record backward if signed or completed evidence exists.
update public.agreement_records agreement_record
set status = 'viewed',
    creator_accepted_at = null
where agreement_record.status = 'creator_accepted'
  and exists (
    select 1
    from public.agreement_events event_record
    where event_record.agreement_id = agreement_record.id
      and event_record.provider = 'signwell'
      and event_record.event_type = 'document_in_progress'
      and event_record.processing_status = 'processed'
  )
  and not exists (
    select 1
    from public.agreement_events event_record
    where event_record.agreement_id = agreement_record.id
      and event_record.provider = 'signwell'
      and event_record.event_type in ('document_signed', 'document_completed')
      and event_record.processing_status = 'processed'
  );

comment on function public.process_signwell_agreement_event(jsonb) is
  'Service-role-only SignWell processing. In-progress remains resumable; signed awaits confirmation; completed plus archived artifact activates exactly once.';
