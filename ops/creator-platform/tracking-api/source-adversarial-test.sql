\set ON_ERROR_STOP on
do $$
declare o uuid; first_batch uuid; last_batch uuid; a uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); obs uuid:=gen_random_uuid(); result jsonb; before_count integer; t record; f record;
begin
  insert into tracking_organizations(name) values('Out of order source') returning id into o;
  insert into tracking_source_bindings values('out-of-order',o);
  insert into creator_tracker_ingest_batches
    select gen_random_uuid(),'out-of-order','committed',now()+make_interval(secs=>n)
    from generate_series(1,21) n;
  select id into first_batch from creator_tracker_ingest_batches where organization_id='out-of-order' order by committed_at limit 1;
  select id into last_batch from creator_tracker_ingest_batches where organization_id='out-of-order' order by committed_at desc limit 1;
  insert into creator_tracker_staged_entities values
    ('out-of-order','account',a,last_batch,jsonb_build_object('profileUrl','https://www.tiktok.com/@latefoundation','lastSuccessAt','2026-09-12T00:00:00Z'),'tiktok','777'),
    ('out-of-order','video',v,last_batch,jsonb_build_object('nativeVideoId','source-late','accountId',a,'canonicalUrl','https://www.tiktok.com/@latefoundation/video/777','captionCurrent','Late foundation','publishedAt','2026-09-01T00:00:00Z'),'tiktok',null),
    ('out-of-order','observation',obs,first_batch,jsonb_build_object('videoId',v,'observedAt','2026-09-12T00:00:00Z','adapter','legacy_provider','confidence','provider','views',321,'availability','available','isComplete',true,'counterRegression',false),null,null);
  result:=tracking_sync_sources(repeat('b',64));
  assert result->>'batches'='20';
  assert tracking_read(o,'videos')->'data'->0->'latest_observation'->>'views'='321';
  assert tracking_sync_sources(repeat('b',64))->>'batches'='1';
  assert tracking_sync_sources(repeat('b',64))->>'batches'='0';
  assert (select count(*) from tracking_observations where evidence_key='collector:out-of-order:'||obs)=1;
  select count(*) into before_count from tracking_videos;
  insert into creator_tracker_ingest_batches values(gen_random_uuid(),'unbound','committed',now());
  insert into creator_tracker_staged_entities values('unbound','account',gen_random_uuid(),last_batch,jsonb_build_object('profileUrl','https://www.tiktok.com/@unbound'),'tiktok','9999');
  assert tracking_sync_sources(repeat('b',64))->>'batches'='0';
  assert (select count(*) from tracking_videos)=before_count;
  assert not exists(select 1 from tracking_targets where identity='unbound');
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'tracking_%' loop
    assert not has_table_privilege('anon',t.tablename,'SELECT');
    assert not has_table_privilege('authenticated',t.tablename,'SELECT');
    assert not has_table_privilege('authenticated',t.tablename,'INSERT');
    assert not has_table_privilege('authenticated',t.tablename,'UPDATE');
    assert not has_table_privilege('authenticated',t.tablename,'DELETE');
  end loop;
  for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'tracking_%' loop
    assert not has_function_privilege('anon',f.oid,'EXECUTE');
    assert not has_function_privilege('authenticated',f.oid,'EXECUTE');
  end loop;
  raise notice 'PASS: out-of-order source foundations, chunk boundaries, replay, unbound exclusion, all-table/RPC permissions';
end $$;
