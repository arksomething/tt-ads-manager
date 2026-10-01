\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
\ir ../../../creator-platform/supabase/migrations/20260912090000_tracking_api.sql

do $$
declare a uuid; b uuid; result jsonb; again jsonb; sid uuid; jid uuid; lease jsonb; vid uuid; key_hash text := repeat('a',64); worker_hash text := repeat('b',64);
begin
  insert into tracking_organizations(name,subscription_limit,requests_per_minute) values('Test A',1,2) returning id into a;
  insert into tracking_organizations(name) values('Test B') returning id into b;
  insert into tracking_api_keys(organization_id,name,token_hash,prefix,scopes) values(a,'test',key_hash,'prefix',array['tracking:read','tracking:write']);
  assert tracking_authenticate(repeat('c',64))->>'error'='UNAUTHORIZED';
  assert tracking_authenticate(key_hash)->>'organization_id'=a::text;
  perform tracking_authenticate(key_hash);
  assert tracking_authenticate(key_hash)->>'error'='RATE_LIMITED';
  update tracking_api_keys set revoked_at=now() where token_hash=key_hash;
  assert tracking_authenticate(key_hash)->>'error'='UNAUTHORIZED';
  update tracking_api_keys set revoked_at=null,expires_at=now()-interval '1 second' where token_hash=key_hash;
  assert tracking_authenticate(key_hash)->>'error'='UNAUTHORIZED';

  result := tracking_mutate(a,'subscribe','{"platform":"tiktok","kind":"video","identity":"123","url":"https://www.tiktok.com/@example/video/123"}','request-1','hash-1');
  assert result->>'error' is null;
  sid := (result->'subscription'->>'id')::uuid; jid := (result->>'job_id')::uuid;
  again := tracking_mutate(a,'subscribe','{}','request-1','hash-1');
  assert again->>'replayed'='true' and again->>'job_id'=jid::text;
  assert tracking_mutate(a,'subscribe','{}','request-1','different')->>'error'='IDEMPOTENCY_CONFLICT';
  assert tracking_mutate(a,'subscribe','{"platform":"tiktok","kind":"account","identity":"second","url":"https://www.tiktok.com/@second"}','request-2','hash-2')->>'error'='SUBSCRIPTION_LIMIT';
  assert jsonb_array_length(tracking_read(b,'subscriptions',sid)->'data')=0;
  assert tracking_mutate(b,'delete',jsonb_build_object('id',sid),null,null)->>'error'='NOT_FOUND';
  assert jsonb_array_length(tracking_read(b,'jobs',jid)->'data')=0;

  insert into tracking_worker_keys(token_hash,name) values(worker_hash,'test');
  assert tracking_worker_lease(key_hash)->>'error'='UNAUTHORIZED';
  lease := tracking_worker_lease(worker_hash)->'job';
  assert lease->>'id'=jid::text;
  assert tracking_worker_lease(worker_hash)->'job'='null'::jsonb;
  assert tracking_worker_complete(worker_hash,jid,gen_random_uuid(),'{}')->>'error'='LEASE_CONFLICT';
  result := tracking_worker_complete(worker_hash,jid,(lease->>'lease_token')::uuid,jsonb_build_object('coverage','complete','videos',jsonb_build_array(jsonb_build_object(
    'native_video_id','123','native_account_id','999','url','https://www.tiktok.com/@example/video/123','caption','Test','published_at','2026-09-01T00:00:00Z',
    'observed_at','2026-09-12T00:00:00Z','source','scrapecreators_tiktok','views',42,'likes',null,'comments',0,'shares',null,'saves',null))));
  assert result->>'ok'='true';
  assert tracking_worker_complete(worker_hash,jid,(lease->>'lease_token')::uuid,'{}')->>'replayed'='true';
  select id into vid from tracking_videos where native_video_id='123';
  result := tracking_read(a,'videos',vid);
  assert result->'data'->0->'latest_observation'->>'views'='42';
  assert result->'data'->0->'latest_observation'->'likes'='null'::jsonb;
  assert not(result->'data'->0->'latest_observation' ? 'evidence_key');
  assert jsonb_array_length(tracking_read(b,'videos',vid)->'data')=0;
  assert tracking_read(b,'observations',p_video=>vid)->>'error'='NOT_FOUND';
  assert tracking_mutate(a,'refresh',jsonb_build_object('id',sid),'fresh','fresh')->>'error'='REFRESH_TOO_SOON';
  perform tracking_mutate(a,'update',jsonb_build_object('id',sid,'state','paused'),null,null);
  assert jsonb_array_length(tracking_read(a,'videos',vid)->'data')=1;
  assert tracking_mutate(a,'refresh',jsonb_build_object('id',sid),'pause','pause')->>'error'='SUBSCRIPTION_PAUSED';
  perform tracking_mutate(a,'delete',jsonb_build_object('id',sid),null,null);
  assert jsonb_array_length(tracking_read(a,'videos',vid)->'data')=0;
  assert tracking_read(a,'observations',p_video=>vid)->>'error'='NOT_FOUND';
  assert not has_table_privilege('anon','tracking_videos','SELECT');
  assert not has_function_privilege('authenticated','tracking_read(uuid,text,uuid,uuid,integer,uuid,uuid)','EXECUTE');
  raise notice 'PASS: isolation, idempotency, quota, key expiry/revocation, rate limits, worker fencing, metrics, pause/delete';
end $$;

do $$ declare t record; f record; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'tracking_%' loop
    assert not has_table_privilege('anon',t.tablename,'SELECT');
    assert not has_table_privilege('authenticated',t.tablename,'INSERT');
    assert not has_table_privilege('authenticated',t.tablename,'UPDATE');
    assert not has_table_privilege('authenticated',t.tablename,'DELETE');
  end loop;
  for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'tracking_%' loop
    assert not has_function_privilege('anon',f.oid,'EXECUTE');
    assert not has_function_privilege('authenticated',f.oid,'EXECUTE');
  end loop;
  raise notice 'PASS: all tracking tables and RPCs reject direct public access';
end $$;

-- Minimal collector contract for the separate ingestion-to-read-model bridge.
create table creator_tracker_ingest_batches(id uuid primary key,organization_id text,status text,committed_at timestamptz);
create table creator_tracker_staged_entities(organization_id text,entity_type text,tracker_entity_id uuid,latest_batch_id uuid,payload jsonb,platform text,native_account_id text);
\ir ../../../creator-platform/supabase/migrations/20260912091000_tracking_api_source_bridge.sql
do $$
declare org uuid; account_id uuid:=gen_random_uuid(); video_id uuid:=gen_random_uuid(); obs_id uuid:=gen_random_uuid(); batch_id uuid:=gen_random_uuid(); result jsonb;
begin
  insert into tracking_organizations(name) values('Imported') returning id into org;
  insert into tracking_source_bindings values('bound-source',org);
  insert into creator_tracker_ingest_batches values(batch_id,'bound-source','committed',now());
  insert into creator_tracker_staged_entities values
    ('bound-source','account',account_id,batch_id,jsonb_build_object('profileUrl','https://www.tiktok.com/@imported','lastSuccessAt','2026-09-12T00:00:00Z'),'tiktok','888'),
    ('bound-source','video',video_id,batch_id,jsonb_build_object('nativeVideoId','456','accountId',account_id,'canonicalUrl','https://www.tiktok.com/@imported/video/456','captionCurrent','Imported video','publishedAt','2026-09-01T00:00:00Z'),'tiktok',null),
    ('bound-source','observation',obs_id,batch_id,jsonb_build_object('videoId',video_id,'observedAt','2026-09-12T00:00:00Z','sourceObservedAt',null,'adapter','legacy_provider','confidence','provider','views',100,'likes',null,'comments',0,'shares',null,'saves',null,'availability','available','isComplete',true,'counterRegression',false),null,null);
  assert tracking_sync_sources(repeat('c',64))->>'error'='UNAUTHORIZED';
  result:=tracking_sync_sources(repeat('b',64));
  assert result->>'batches'='1';
  assert jsonb_array_length(tracking_read(org,'videos')->'data')=1;
  assert tracking_read(org,'videos')->'data'->0->'latest_observation'->>'views'='100';
  assert tracking_read(org,'subscriptions')->'data'->0->>'state'='paused';
  assert tracking_sync_sources(repeat('b',64))->>'batches'='0';
  raise notice 'PASS: bound source imports, observation provenance, no duplicate collection, idempotent sync';
end $$;
