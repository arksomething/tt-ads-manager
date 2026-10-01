-- Client control plane. Collector credentials and raw evidence never enter responses.
create table public.tracking_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  subscription_limit integer not null default 100 check (subscription_limit between 1 and 10000),
  requests_per_minute integer not null default 120 check (requests_per_minute between 1 and 10000),
  rate_window timestamptz not null default now(),
  rate_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.tracking_api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tracking_organizations(id),
  name text not null check (length(name) between 1 and 120),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  prefix text not null,
  scopes text[] not null check (scopes <@ array['tracking:read','tracking:write','keys:manage']::text[] and cardinality(scopes) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index tracking_api_keys_organization on public.tracking_api_keys(organization_id);

create table public.tracking_targets (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok','instagram')),
  kind text not null check (kind in ('account','video')),
  identity text not null check (length(identity) between 1 and 256),
  url text not null check (length(url) <= 2048),
  native_account_id text,
  resolved_native_account_id text,
  collection_state text not null default 'pending' check (collection_state in ('pending','active','retrying','blocked')),
  coverage text not null default 'unknown' check (coverage in ('unknown','complete','capped','empty_unconfirmed')),
  last_success_at timestamptz,
  next_collection_at timestamptz not null default now(),
  last_error_code text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct(platform,kind,identity,native_account_id)
);
create table public.tracking_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.tracking_organizations(id),
  target_id uuid not null references public.tracking_targets(id),
  state text not null default 'active' check (state in ('active','paused','deleted')),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,target_id)
);
create index tracking_subscriptions_target on public.tracking_subscriptions(target_id,state);
create table public.tracking_jobs (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.tracking_targets(id),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index tracking_jobs_pending on public.tracking_jobs(target_id) where state in ('queued','running');
create index tracking_jobs_queue on public.tracking_jobs(created_at) where state = 'queued';
create table public.tracking_videos (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok','instagram')),
  native_video_id text not null,
  native_account_id text,
  url text,
  caption text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(platform,native_video_id)
);
create table public.tracking_target_videos (
  target_id uuid not null references public.tracking_targets(id),
  video_id uuid not null references public.tracking_videos(id),
  primary key(target_id,video_id)
);
create index tracking_target_videos_video on public.tracking_target_videos(video_id,target_id);
create table public.tracking_observations (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.tracking_videos(id),
  observed_at timestamptz not null,
  source_observed_at timestamptz,
  source text not null,
  confidence text not null check (confidence in ('direct','provider','inferred','legacy')),
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  saves bigint check (saves >= 0),
  availability text not null,
  is_complete boolean not null,
  counter_regression boolean not null default false,
  evidence_key text not null unique
);
create index tracking_observations_video_time on public.tracking_observations(video_id,observed_at desc,id desc);
create table public.tracking_idempotency (
  organization_id uuid not null references public.tracking_organizations(id),
  key text not null check (length(key) between 1 and 128),
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(organization_id,key)
);
create table public.tracking_worker_keys (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  name text not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);

do $$ declare t text; begin
  foreach t in array array['tracking_organizations','tracking_api_keys','tracking_targets','tracking_subscriptions','tracking_jobs','tracking_videos','tracking_target_videos','tracking_observations','tracking_idempotency','tracking_worker_keys'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select, insert, update, delete on public.%I to service_role',t);
  end loop;
end $$;

create function public.tracking_authenticate(p_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k tracking_api_keys; o tracking_organizations; reset_at timestamptz;
begin
  select * into k from tracking_api_keys where token_hash=p_hash and revoked_at is null and (expires_at is null or expires_at>now());
  if not found then return jsonb_build_object('error','UNAUTHORIZED'); end if;
  select * into o from tracking_organizations where id=k.organization_id for update;
  if o.rate_window <= now()-interval '1 minute' then
    o.rate_window := now(); o.rate_count := 0;
  end if;
  reset_at := o.rate_window+interval '1 minute';
  if o.rate_count >= o.requests_per_minute then
    return jsonb_build_object('error','RATE_LIMITED','retry_after',greatest(1,ceil(extract(epoch from reset_at-now()))));
  end if;
  update tracking_organizations set rate_window=o.rate_window,rate_count=o.rate_count+1 where id=o.id;
  update tracking_api_keys set last_used_at=now() where id=k.id;
  return jsonb_build_object('organization_id',o.id,'key_id',k.id,'scopes',k.scopes,'remaining',o.requests_per_minute-o.rate_count-1,'limit',o.requests_per_minute,'reset_at',reset_at);
end $$;

create function public.tracking_mutate(p_org uuid,p_operation text,p_input jsonb,p_key text,p_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o tracking_organizations; s tracking_subscriptions; t tracking_targets; previous tracking_idempotency; result jsonb; job_id uuid;
begin
  select * into o from tracking_organizations where id=p_org for update;
  if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
  if p_key is not null then
    select * into previous from tracking_idempotency where organization_id=p_org and key=p_key;
    if found then
      if previous.request_hash<>p_hash then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); end if;
      return previous.result || jsonb_build_object('replayed',true);
    end if;
  end if;
  if p_operation='subscribe' then
    select * into t from tracking_targets where platform=p_input->>'platform' and kind=p_input->>'kind' and identity=p_input->>'identity' and native_account_id is not distinct from p_input->>'native_account_id';
    if found then select * into s from tracking_subscriptions where organization_id=p_org and target_id=t.id; end if;
    if s.id is null or s.state='deleted' then
      if (select count(*) from tracking_subscriptions where organization_id=p_org and state<>'deleted') >= o.subscription_limit then
        return jsonb_build_object('error','SUBSCRIPTION_LIMIT');
      end if;
    end if;
    insert into tracking_targets(platform,kind,identity,url,native_account_id)
      values(p_input->>'platform',p_input->>'kind',p_input->>'identity',p_input->>'url',p_input->>'native_account_id')
      on conflict(platform,kind,identity,native_account_id) do update set identity=excluded.identity returning * into t;
    -- Unverified client claims must never overwrite a shared resolved identity.
    if t.native_account_id is not null and p_input->>'native_account_id' is not null and t.native_account_id<>p_input->>'native_account_id' then
      return jsonb_build_object('error','IDENTITY_CONFLICT');
    end if;
    insert into tracking_target_videos(target_id,video_id)
      select t.id,v.id from tracking_videos v where t.kind='video' and v.platform=t.platform and v.native_video_id=t.identity
        and (t.native_account_id is null or v.native_account_id=t.native_account_id) on conflict do nothing;
    insert into tracking_subscriptions(organization_id,target_id,metadata)
      values(p_org,t.id,coalesce(p_input->'metadata','{}'))
      on conflict(organization_id,target_id) do update set state='active',metadata=excluded.metadata,updated_at=now() returning * into s;
  elsif p_operation in ('update','delete','refresh') then
    select * into s from tracking_subscriptions where id=(p_input->>'id')::uuid and organization_id=p_org and state<>'deleted' for update;
    if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
    select * into t from tracking_targets where id=s.target_id for update;
    if p_operation='refresh' then
      if s.state<>'active' then return jsonb_build_object('error','SUBSCRIPTION_PAUSED'); end if;
      select id into job_id from tracking_jobs where target_id=t.id and state in ('queued','running');
      if job_id is null and t.last_success_at>now()-interval '1 hour' then return jsonb_build_object('error','REFRESH_TOO_SOON'); end if;
      update tracking_targets set next_collection_at=now() where id=t.id;
    else
      update tracking_subscriptions set
        state=case when p_operation='delete' then 'deleted' else coalesce(p_input->>'state',state) end,
        metadata=coalesce(p_input->'metadata',metadata),updated_at=now() where id=s.id returning * into s;
    end if;
  else return jsonb_build_object('error','NOT_FOUND');
  end if;
  if s.state='active' and (t.last_success_at is null or t.next_collection_at<=now() or p_operation='refresh') then
    insert into tracking_jobs(target_id) values(t.id) on conflict(target_id) where state in ('queued','running') do nothing;
    select id into job_id from tracking_jobs where target_id=t.id and state in ('queued','running');
  end if;
  result := jsonb_build_object('subscription',to_jsonb(s),'job_id',job_id,'replayed',false);
  if p_key is not null then insert into tracking_idempotency(organization_id,key,request_hash,result) values(p_org,p_key,p_hash,result); end if;
  return result;
end $$;

create function public.tracking_read(p_org uuid,p_resource text,p_id uuid default null,p_after uuid default null,p_limit integer default 50,p_subscription uuid default null,p_video uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT'; end if;
  if p_subscription is not null and not exists(select 1 from tracking_subscriptions where id=p_subscription and organization_id=p_org and state<>'deleted') then return jsonb_build_object('error','NOT_FOUND'); end if;
  if p_resource='subscriptions' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into result from (
      select s.id,s.state,s.metadata,s.created_at,s.updated_at,t.platform,t.kind,t.url,coalesce(t.resolved_native_account_id,t.native_account_id) as native_account_id,t.collection_state,t.coverage,t.last_success_at,t.next_collection_at,t.last_error_code
      from tracking_subscriptions s join tracking_targets t on t.id=s.target_id
      where s.organization_id=p_org and s.state<>'deleted' and (p_id is null or s.id=p_id) and (p_after is null or s.id>p_after)
      order by s.id limit p_limit+1
    ) r;
  elsif p_resource='videos' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into result from (
      select v.*, (select to_jsonb(obs)-'evidence_key' from tracking_observations obs where obs.video_id=v.id order by observed_at desc,id desc limit 1) as latest_observation
      from tracking_videos v where (p_id is null or v.id=p_id) and (p_after is null or v.id>p_after) and exists(
        select 1 from tracking_target_videos tv join tracking_subscriptions s on s.target_id=tv.target_id
        where tv.video_id=v.id and s.organization_id=p_org and s.state<>'deleted' and (p_subscription is null or s.id=p_subscription)
      ) order by v.id limit p_limit+1
    ) r;
  elsif p_resource='observations' then
    if p_video is null or not exists(select 1 from tracking_target_videos tv join tracking_subscriptions s on s.target_id=tv.target_id where tv.video_id=p_video and s.organization_id=p_org and s.state<>'deleted') then return jsonb_build_object('error','NOT_FOUND'); end if;
    select coalesce(jsonb_agg(to_jsonb(r)-'evidence_key' order by r.id),'[]') into result from (
      select obs.* from tracking_observations obs where video_id=p_video and (p_after is null or id>p_after) order by id limit p_limit+1
    ) r;
  elsif p_resource='jobs' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into result from (
      select j.id,j.state,j.attempts,j.error_code,j.created_at,j.completed_at from tracking_jobs j
      where (p_id is null or j.id=p_id) and (p_after is null or j.id>p_after) and exists(
        select 1 from tracking_subscriptions s where s.target_id=j.target_id and s.organization_id=p_org and s.state<>'deleted' and (p_subscription is null or s.id=p_subscription)
      ) order by j.id limit p_limit+1
    ) r;
  else return jsonb_build_object('error','NOT_FOUND'); end if;
  return jsonb_build_object('data',result);
end $$;

create function public.tracking_worker_lease(p_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j tracking_jobs; t tracking_targets;
begin
  update tracking_worker_keys set last_seen_at=now() where token_hash=p_hash and revoked_at is null;
  if not found then return jsonb_build_object('error','UNAUTHORIZED'); end if;
  -- One scheduler transaction prevents duplicate enqueue/reaping across workers.
  perform pg_advisory_xact_lock(hashtextextended('tracking-api-scheduler',0));
  update tracking_jobs set state=case when attempts>=3 then 'failed' else 'queued' end,
    error_code='WORKER_LEASE_EXPIRED',lease_token=null,lease_expires_at=null,
    completed_at=case when attempts>=3 then now() else null end
    where state='running' and lease_expires_at<now();
  update tracking_targets expired_target set next_collection_at=now()+interval '1 hour',collection_state='retrying',last_error_code='WORKER_LEASE_EXPIRED'
    where exists(select 1 from tracking_jobs expired_job where expired_job.target_id=expired_target.id and expired_job.state='failed' and expired_job.completed_at=now());
  update tracking_jobs queued_job set state='cancelled',completed_at=now() where state='queued' and not exists(select 1 from tracking_subscriptions s where s.target_id=queued_job.target_id and s.state='active');
  insert into tracking_jobs(target_id)
    select due_target.id from tracking_targets due_target where due_target.next_collection_at<=now() and exists(select 1 from tracking_subscriptions s where s.target_id=due_target.id and s.state='active')
    order by due_target.next_collection_at limit 100 on conflict(target_id) where state in ('queued','running') do nothing;
  select * into j from tracking_jobs where state='queued' order by created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('job',null); end if;
  update tracking_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '10 minutes' where id=j.id returning * into j;
  select * into t from tracking_targets where id=j.target_id;
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'lease_token',j.lease_token,'target',to_jsonb(t)));
end $$;

create function public.tracking_worker_complete(p_hash text,p_job uuid,p_lease uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j tracking_jobs; t tracking_targets; item jsonb; v tracking_videos; previous tracking_observations;
begin
  update tracking_worker_keys set last_seen_at=now() where token_hash=p_hash and revoked_at is null;
  if not found then return jsonb_build_object('error','UNAUTHORIZED'); end if;
  select * into j from tracking_jobs where id=p_job for update;
  if not found or j.lease_token is distinct from p_lease then return jsonb_build_object('error','LEASE_CONFLICT'); end if;
  if j.state in ('succeeded','failed') then return jsonb_build_object('ok',true,'replayed',true); end if;
  if j.state<>'running' or j.lease_expires_at<now() then return jsonb_build_object('error','LEASE_CONFLICT'); end if;
  select * into t from tracking_targets where id=j.target_id for update;
  if p_result->>'error_code' is not null then
    update tracking_jobs set state='failed',error_code=p_result->>'error_code',completed_at=now() where id=j.id;
    update tracking_targets set collection_state=case when p_result->>'blocked'='true' then 'blocked' else 'retrying' end,
      last_error_code=p_result->>'error_code',consecutive_failures=consecutive_failures+1,
      next_collection_at=now()+make_interval(secs=>least(43200,1800*power(2,least(consecutive_failures,5)))) where id=t.id;
    return jsonb_build_object('ok',true);
  end if;
  if jsonb_typeof(p_result->'videos')<>'array' or jsonb_array_length(p_result->'videos')>100 then raise exception 'INVALID_RESULT'; end if;
  for item in select value from jsonb_array_elements(p_result->'videos') loop
    if t.native_account_id is not null and item->>'native_account_id' is distinct from t.native_account_id then raise exception 'IDENTITY_CONFLICT'; end if;
    if t.resolved_native_account_id is not null and item->>'native_account_id' is distinct from t.resolved_native_account_id then raise exception 'IDENTITY_CONFLICT'; end if;
    t.resolved_native_account_id := item->>'native_account_id';
    if t.kind='video' and item->>'native_video_id'<>t.identity then raise exception 'IDENTITY_CONFLICT'; end if;
    insert into tracking_videos(platform,native_video_id,native_account_id,url,caption,published_at)
      values(t.platform,item->>'native_video_id',item->>'native_account_id',item->>'url',item->>'caption',(item->>'published_at')::timestamptz)
      on conflict(platform,native_video_id) do update set native_account_id=coalesce(tracking_videos.native_account_id,excluded.native_account_id),url=excluded.url,caption=excluded.caption,published_at=coalesce(tracking_videos.published_at,excluded.published_at)
      returning * into v;
    if v.native_account_id is not null and v.native_account_id is distinct from item->>'native_account_id' then raise exception 'IDENTITY_CONFLICT'; end if;
    insert into tracking_target_videos(target_id,video_id) values(t.id,v.id) on conflict do nothing;
    select * into previous from tracking_observations where video_id=v.id and observed_at<(item->>'observed_at')::timestamptz and is_complete and availability='available' order by observed_at desc,id desc limit 1;
    insert into tracking_observations(video_id,observed_at,source_observed_at,source,confidence,views,likes,comments,shares,saves,availability,is_complete,counter_regression,evidence_key)
      values(v.id,(item->>'observed_at')::timestamptz,(item->>'observed_at')::timestamptz,item->>'source','provider',
        (item->>'views')::bigint,(item->>'likes')::bigint,(item->>'comments')::bigint,(item->>'shares')::bigint,(item->>'saves')::bigint,
        'available',(item->>'views') is not null,
        coalesce((item->>'views')::bigint<previous.views or (item->>'likes')::bigint<previous.likes or (item->>'comments')::bigint<previous.comments or (item->>'shares')::bigint<previous.shares or (item->>'saves')::bigint<previous.saves,false),
        'job:'||j.id||':'||v.id) on conflict(evidence_key) do nothing;
  end loop;
  update tracking_targets set collection_state='active',coverage=p_result->>'coverage',last_success_at=now(),next_collection_at=now()+interval '12 hours',last_error_code=null,consecutive_failures=0,resolved_native_account_id=t.resolved_native_account_id where id=t.id;
  update tracking_jobs set state='succeeded',completed_at=now() where id=j.id;
  return jsonb_build_object('ok',true);
end $$;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('tracking_authenticate','tracking_mutate','tracking_read','tracking_worker_lease','tracking_worker_complete') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
