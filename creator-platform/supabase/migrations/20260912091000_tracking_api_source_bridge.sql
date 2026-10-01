-- The API copies only public video facts from explicitly bound collector tenants.
-- Polling this bridge does not add a failure dependency to canonical ingestion.
create table public.tracking_source_bindings (
  source_organization_id text primary key,
  organization_id uuid not null references public.tracking_organizations(id)
);
create table public.tracking_source_accounts (
  source_organization_id text not null references public.tracking_source_bindings(source_organization_id),
  source_account_id uuid not null,
  target_id uuid not null references public.tracking_targets(id),
  primary key(source_organization_id,source_account_id)
);
create table public.tracking_source_batches (
  batch_id uuid primary key references public.creator_tracker_ingest_batches(id),
  imported_at timestamptz not null default now()
);
alter table public.tracking_source_bindings enable row level security;
alter table public.tracking_source_accounts enable row level security;
alter table public.tracking_source_batches enable row level security;
revoke all on public.tracking_source_bindings,public.tracking_source_accounts,public.tracking_source_batches from public,anon,authenticated;
grant all on public.tracking_source_bindings,public.tracking_source_accounts,public.tracking_source_batches to service_role;

create function public.tracking_sync_sources(p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare batch_ids uuid[]; source_row record; account_target uuid; imported integer;
begin
  if not exists(select 1 from tracking_worker_keys where token_hash=p_hash and revoked_at is null) then return jsonb_build_object('error','UNAUTHORIZED'); end if;
  if not pg_try_advisory_xact_lock(hashtextextended('tracking-api-source-sync',0)) then return jsonb_build_object('batches',0); end if;
  select array_agg(id) into batch_ids from (
    select b.id from creator_tracker_ingest_batches b join tracking_source_bindings binding on binding.source_organization_id=b.organization_id
    where b.status='committed' and not exists(select 1 from tracking_source_batches imported where imported.batch_id=b.id)
    order by b.committed_at,b.id limit 20
  ) due;
  if batch_ids is null then return jsonb_build_object('batches',0); end if;
  for source_row in
    select s.*,binding.organization_id as api_org from creator_tracker_staged_entities s join tracking_source_bindings binding on binding.source_organization_id=s.organization_id
    where s.entity_type='account' and s.platform in ('tiktok','instagram')
      and s.payload->>'profileUrl' is not null and s.native_account_id is not null
  loop
    insert into tracking_targets(platform,kind,identity,url,native_account_id,resolved_native_account_id,collection_state,last_success_at,next_collection_at)
      values(source_row.platform,'account',lower(trim(both '/' from regexp_replace(source_row.payload->>'profileUrl','^https://(www\.)?(tiktok\.com/@|instagram\.com/)',''))),
        source_row.payload->>'profileUrl',source_row.native_account_id,source_row.native_account_id,
        case when source_row.payload->>'lastSuccessAt' is null then 'pending' else 'active' end,(source_row.payload->>'lastSuccessAt')::timestamptz,
        coalesce((source_row.payload->>'nextDiscoveryAt')::timestamptz,now()))
      on conflict(platform,kind,identity,native_account_id) do update set last_success_at=greatest(tracking_targets.last_success_at,excluded.last_success_at)
      returning id into account_target;
    insert into tracking_source_accounts(source_organization_id,source_account_id,target_id) values(source_row.organization_id,source_row.tracker_entity_id,account_target)
      on conflict(source_organization_id,source_account_id) do update set target_id=excluded.target_id;
    -- Existing collection continues in its original scheduler. Imported API
    -- subscriptions grant reads without launching a second paid collection loop.
    insert into tracking_subscriptions(organization_id,target_id,state,metadata)
      values(source_row.api_org,account_target,'paused','{"collection":"existing_collector"}') on conflict(organization_id,target_id) do nothing;
  end loop;

  insert into tracking_videos(platform,native_video_id,native_account_id,url,caption,published_at)
    select s.platform,s.payload->>'nativeVideoId',account.native_account_id,s.payload->>'canonicalUrl',s.payload->>'captionCurrent',(s.payload->>'publishedAt')::timestamptz
    from creator_tracker_staged_entities s
    join tracking_source_bindings binding on binding.source_organization_id=s.organization_id
    join creator_tracker_staged_entities account on account.organization_id=s.organization_id and account.entity_type='account' and account.tracker_entity_id=(s.payload->>'accountId')::uuid
    where s.entity_type='video' and s.platform in ('tiktok','instagram')
    on conflict(platform,native_video_id) do update set url=excluded.url,caption=excluded.caption,published_at=coalesce(tracking_videos.published_at,excluded.published_at);

  insert into tracking_target_videos(target_id,video_id)
    select mapping.target_id,v.id from creator_tracker_staged_entities s
    join tracking_source_accounts mapping on mapping.source_organization_id=s.organization_id and mapping.source_account_id=(s.payload->>'accountId')::uuid
    join tracking_videos v on v.platform=s.platform and v.native_video_id=s.payload->>'nativeVideoId'
    where s.entity_type='video' on conflict do nothing;

  insert into tracking_observations(video_id,observed_at,source_observed_at,source,confidence,views,likes,comments,shares,saves,availability,is_complete,counter_regression,evidence_key)
    select v.id,(obs.payload->>'observedAt')::timestamptz,(obs.payload->>'sourceObservedAt')::timestamptz,
      obs.payload->>'adapter',obs.payload->>'confidence',(obs.payload->>'views')::bigint,(obs.payload->>'likes')::bigint,(obs.payload->>'comments')::bigint,
      (obs.payload->>'shares')::bigint,(obs.payload->>'saves')::bigint,obs.payload->>'availability',(obs.payload->>'isComplete')::boolean,
      (obs.payload->>'counterRegression')::boolean,'collector:'||obs.organization_id||':'||obs.tracker_entity_id
    from creator_tracker_staged_entities obs
    join tracking_source_bindings binding on binding.source_organization_id=obs.organization_id
    join creator_tracker_staged_entities video on video.organization_id=obs.organization_id and video.entity_type='video' and video.tracker_entity_id=(obs.payload->>'videoId')::uuid
    join tracking_videos v on v.platform=video.platform and v.native_video_id=video.payload->>'nativeVideoId'
    where obs.entity_type='observation' and obs.latest_batch_id=any(batch_ids)
    on conflict(evidence_key) do nothing;

  insert into tracking_source_batches(batch_id) select unnest(batch_ids) on conflict do nothing;
  get diagnostics imported=row_count;
  return jsonb_build_object('batches',imported);
end $$;
revoke all on function public.tracking_sync_sources(text) from public,anon,authenticated;
grant execute on function public.tracking_sync_sources(text) to service_role;
