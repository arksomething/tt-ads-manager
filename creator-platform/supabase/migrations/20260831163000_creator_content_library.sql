-- Operational scripts and creator asset library.
--
-- Content is private by default. Staff authors publish and explicitly assign
-- records to an enrollment; creators can only read their own assignments. The
-- storage bucket is private and object access follows the same assignment
-- boundary. No service-role credential is required by the browser.

create extension if not exists pgcrypto;

create or replace function public.creator_is_active_staff(required_role text default 'reviewer')
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.staff_members staff
    where staff.auth_user_id = auth.uid()
      and staff.active
      and (
        required_role = 'reviewer' and staff.role in ('reviewer', 'admin')
        or required_role = 'admin' and staff.role = 'admin'
      )
  );
$$;

create table public.program_scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 140),
  summary text not null default '' check (char_length(summary) <= 500),
  body_markdown text not null check (char_length(btrim(body_markdown)) between 1 and 100000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  updated_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);

create table public.creator_script_assignments (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.program_scripts(id) on delete cascade,
  enrollment_id uuid not null references public.creator_enrollments(id) on delete cascade,
  assigned_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  note_to_creator text not null default '' check (char_length(note_to_creator) <= 1000),
  due_at timestamptz,
  state text not null default 'assigned' check (state in ('assigned', 'viewed', 'used', 'withdrawn')),
  assigned_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  used_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (script_id, enrollment_id),
  check (state <> 'viewed' or first_viewed_at is not null),
  check (state <> 'used' or used_at is not null)
);

create table public.program_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 140),
  description text not null default '' check (char_length(description) <= 1000),
  asset_kind text not null check (
    asset_kind in ('brand', 'template', 'footage', 'audio', 'image', 'document', 'link', 'other')
  ),
  source_type text not null check (source_type in ('upload', 'external_url')),
  storage_bucket text,
  storage_path text,
  external_url text,
  original_filename text check (original_filename is null or char_length(original_filename) <= 255),
  mime_type text check (mime_type is null or char_length(mime_type) <= 160),
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 52428800),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  updated_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null),
  check (
    (source_type = 'upload'
      and storage_bucket = 'creator-program-assets'
      and storage_path is not null
      and external_url is null)
    or
    (source_type = 'external_url'
      and storage_bucket is null
      and storage_path is null
      and external_url ~ '^https://')
  )
);

create unique index program_assets_storage_object_unique
  on public.program_assets (storage_bucket, storage_path)
  where source_type = 'upload';

create table public.creator_asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.program_assets(id) on delete cascade,
  enrollment_id uuid not null references public.creator_enrollments(id) on delete cascade,
  assigned_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  note_to_creator text not null default '' check (char_length(note_to_creator) <= 1000),
  state text not null default 'assigned' check (state in ('assigned', 'viewed', 'withdrawn')),
  assigned_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (asset_id, enrollment_id),
  check (state <> 'viewed' or first_viewed_at is not null)
);

create index creator_script_assignments_enrollment
  on public.creator_script_assignments (enrollment_id, state, assigned_at desc);
create index creator_asset_assignments_enrollment
  on public.creator_asset_assignments (enrollment_id, state, assigned_at desc);

create trigger program_scripts_touch_updated_at
before update on public.program_scripts
for each row execute function public.creator_touch_updated_at();

create trigger creator_script_assignments_touch_updated_at
before update on public.creator_script_assignments
for each row execute function public.creator_touch_updated_at();

create trigger program_assets_touch_updated_at
before update on public.program_assets
for each row execute function public.creator_touch_updated_at();

create trigger creator_asset_assignments_touch_updated_at
before update on public.creator_asset_assignments
for each row execute function public.creator_touch_updated_at();

create or replace function public.get_creator_content_admin_overview()
returns table (overview jsonb)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'scripts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', script.id,
        'title', script.title,
        'summary', script.summary,
        'body_markdown', script.body_markdown,
        'status', script.status,
        'revision', script.revision,
        'published_at', script.published_at,
        'updated_at', script.updated_at,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', assignment.id,
            'enrollment_id', assignment.enrollment_id,
            'creator_name', application.name,
            'state', assignment.state,
            'due_at', assignment.due_at
          ) order by application.name)
          from public.creator_script_assignments assignment
          join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
          join public.creator_applications application on application.id = enrollment.application_id
          where assignment.script_id = script.id and assignment.state <> 'withdrawn'
        ), '[]'::jsonb)
      ) order by script.updated_at desc, script.id)
      from public.program_scripts script
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', asset.id,
        'title', asset.title,
        'description', asset.description,
        'asset_kind', asset.asset_kind,
        'source_type', asset.source_type,
        'original_filename', asset.original_filename,
        'mime_type', asset.mime_type,
        'size_bytes', asset.size_bytes,
        'external_url', asset.external_url,
        'status', asset.status,
        'revision', asset.revision,
        'published_at', asset.published_at,
        'updated_at', asset.updated_at,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', assignment.id,
            'enrollment_id', assignment.enrollment_id,
            'creator_name', application.name,
            'state', assignment.state
          ) order by application.name)
          from public.creator_asset_assignments assignment
          join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
          join public.creator_applications application on application.id = enrollment.application_id
          where assignment.asset_id = asset.id and assignment.state <> 'withdrawn'
        ), '[]'::jsonb)
      ) order by asset.updated_at desc, asset.id)
      from public.program_assets asset
    ), '[]'::jsonb),
    'creators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'enrollment_id', enrollment.id,
        'name', application.name,
        'email', account.email_snapshot,
        'status', enrollment.status
      ) order by application.name)
      from public.creator_enrollments enrollment
      join public.creator_applications application on application.id = enrollment.application_id
      join public.creator_accounts account on account.auth_user_id = enrollment.account_id
      where enrollment.status <> 'ended'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_program_script(script_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  script_id uuid;
  supplied_id text := nullif(btrim(coalesce(script_input->>'id', '')), '');
  supplied_title text := btrim(coalesce(script_input->>'title', ''));
  supplied_summary text := btrim(coalesce(script_input->>'summary', ''));
  supplied_body text := btrim(coalesce(script_input->>'bodyMarkdown', ''));
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  if char_length(supplied_title) not between 2 and 140
    or char_length(supplied_summary) > 500
    or char_length(supplied_body) not between 1 and 100000 then
    raise exception 'Script fields are invalid.' using errcode = '22023';
  end if;

  if supplied_id is null then
    insert into public.program_scripts (
      title, summary, body_markdown, created_by, updated_by
    ) values (
      supplied_title, supplied_summary, supplied_body, actor_id, actor_id
    ) returning id into script_id;
  else
    begin
      script_id := supplied_id::uuid;
    exception when invalid_text_representation then
      raise exception 'Script ID is invalid.' using errcode = '22023';
    end;

    update public.program_scripts
    set title = supplied_title,
        summary = supplied_summary,
        body_markdown = supplied_body,
        revision = revision + 1,
        updated_by = actor_id
    where id = script_id and status <> 'archived';
    if not found then
      raise exception 'Editable script was not found.' using errcode = '22023';
    end if;
  end if;

  return script_id;
end;
$$;

create or replace function public.set_program_script_status(target_script_id uuid, target_status text)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_status text;
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  if target_status not in ('published', 'archived') then
    raise exception 'Script status is invalid.' using errcode = '22023';
  end if;
  select status into current_status from public.program_scripts where id = target_script_id for update;
  if current_status is null then
    raise exception 'Script was not found.' using errcode = '22023';
  end if;
  if current_status = 'archived' and target_status = 'published' then
    raise exception 'Archived scripts cannot be republished.' using errcode = '22023';
  end if;
  update public.program_scripts
  set status = target_status,
      published_at = case when target_status = 'published' then coalesce(published_at, now()) else published_at end,
      updated_by = auth.uid()
  where id = target_script_id;
  return target_status;
end;
$$;

create or replace function public.delete_draft_program_script(target_script_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  delete from public.program_scripts where id = target_script_id and status = 'draft';
  if not found then
    raise exception 'Only draft scripts can be deleted.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.assign_program_script(assignment_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  result_id uuid;
  supplied_script_id uuid;
  supplied_enrollment_id uuid;
  supplied_due_at timestamptz;
  supplied_note text := btrim(coalesce(assignment_input->>'note', ''));
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  begin
    supplied_script_id := (assignment_input->>'scriptId')::uuid;
    supplied_enrollment_id := (assignment_input->>'enrollmentId')::uuid;
    supplied_due_at := nullif(assignment_input->>'dueAt', '')::timestamptz;
  exception when others then
    raise exception 'Assignment fields are invalid.' using errcode = '22023';
  end;
  if char_length(supplied_note) > 1000 then
    raise exception 'Assignment note is too long.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.program_scripts where id = supplied_script_id and status = 'published')
    or not exists (select 1 from public.creator_enrollments where id = supplied_enrollment_id and status <> 'ended') then
    raise exception 'Published script and active enrollment are required.' using errcode = '22023';
  end if;

  insert into public.creator_script_assignments (
    script_id, enrollment_id, assigned_by, note_to_creator, due_at
  ) values (
    supplied_script_id, supplied_enrollment_id, auth.uid(), supplied_note, supplied_due_at
  )
  on conflict (script_id, enrollment_id) do update
  set assigned_by = excluded.assigned_by,
      note_to_creator = excluded.note_to_creator,
      due_at = excluded.due_at,
      state = 'assigned',
      first_viewed_at = null,
      used_at = null,
      assigned_at = now()
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.set_program_script_assignment_state(
  target_assignment_id uuid,
  target_state text
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if target_state = 'withdrawn' then
    if not public.creator_is_active_staff('reviewer') then
      raise exception 'Reviewer access required.' using errcode = '42501';
    end if;
    update public.creator_script_assignments
    set state = 'withdrawn'
    where id = target_assignment_id;
  elsif target_state in ('viewed', 'used') then
    update public.creator_script_assignments assignment
    set state = target_state,
        first_viewed_at = coalesce(assignment.first_viewed_at, now()),
        used_at = case when target_state = 'used' then now() else assignment.used_at end
    from public.creator_enrollments enrollment
    where assignment.id = target_assignment_id
      and enrollment.id = assignment.enrollment_id
      and enrollment.account_id = auth.uid()
      and assignment.state <> 'withdrawn';
  else
    raise exception 'Assignment state is invalid.' using errcode = '22023';
  end if;
  if not found then
    raise exception 'Assignment was not found.' using errcode = '22023';
  end if;
  return target_state;
end;
$$;

create or replace function public.register_program_asset(asset_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  result_id uuid;
  supplied_title text := btrim(coalesce(asset_input->>'title', ''));
  supplied_description text := btrim(coalesce(asset_input->>'description', ''));
  supplied_kind text := btrim(coalesce(asset_input->>'assetKind', ''));
  supplied_source text := btrim(coalesce(asset_input->>'sourceType', ''));
  supplied_url text := nullif(btrim(coalesce(asset_input->>'externalUrl', '')), '');
  supplied_path text := nullif(btrim(coalesce(asset_input->>'storagePath', '')), '');
  supplied_filename text := nullif(btrim(coalesce(asset_input->>'originalFilename', '')), '');
  supplied_mime text := nullif(btrim(coalesce(asset_input->>'mimeType', '')), '');
  supplied_size bigint;
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  begin
    supplied_size := nullif(asset_input->>'sizeBytes', '')::bigint;
  exception when others then
    raise exception 'Asset size is invalid.' using errcode = '22023';
  end;
  if char_length(supplied_title) not between 2 and 140
    or char_length(supplied_description) > 1000
    or supplied_kind not in ('brand', 'template', 'footage', 'audio', 'image', 'document', 'link', 'other')
    or supplied_source not in ('upload', 'external_url')
    or supplied_size is not null and supplied_size not between 0 and 52428800 then
    raise exception 'Asset fields are invalid.' using errcode = '22023';
  end if;
  if supplied_source = 'upload' then
    if supplied_path is null or split_part(supplied_path, '/', 1) <> auth.uid()::text then
      raise exception 'Uploaded asset path is invalid.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects stored_object
      where stored_object.bucket_id = 'creator-program-assets'
        and stored_object.name = supplied_path
    ) then
      raise exception 'Uploaded asset object was not found.' using errcode = '22023';
    end if;
  else
    if supplied_url is null or supplied_url !~ '^https://' then
      raise exception 'External asset URL must use HTTPS.' using errcode = '22023';
    end if;
  end if;

  insert into public.program_assets (
    title, description, asset_kind, source_type, storage_bucket, storage_path,
    external_url, original_filename, mime_type, size_bytes, created_by, updated_by
  ) values (
    supplied_title, supplied_description, supplied_kind, supplied_source,
    case when supplied_source = 'upload' then 'creator-program-assets' else null end,
    case when supplied_source = 'upload' then supplied_path else null end,
    case when supplied_source = 'external_url' then supplied_url else null end,
    supplied_filename, supplied_mime, supplied_size, auth.uid(), auth.uid()
  ) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.set_program_asset_status(target_asset_id uuid, target_status text)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare current_status text;
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  if target_status not in ('published', 'archived') then
    raise exception 'Asset status is invalid.' using errcode = '22023';
  end if;
  select status into current_status from public.program_assets where id = target_asset_id for update;
  if current_status is null then raise exception 'Asset was not found.' using errcode = '22023'; end if;
  if current_status = 'archived' and target_status = 'published' then
    raise exception 'Archived assets cannot be republished.' using errcode = '22023';
  end if;
  update public.program_assets
  set status = target_status,
      published_at = case when target_status = 'published' then coalesce(published_at, now()) else published_at end,
      updated_by = auth.uid()
  where id = target_asset_id;
  return target_status;
end;
$$;

create or replace function public.save_program_asset_metadata(asset_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_asset_id uuid;
  supplied_title text := btrim(coalesce(asset_input->>'title', ''));
  supplied_description text := btrim(coalesce(asset_input->>'description', ''));
  supplied_kind text := btrim(coalesce(asset_input->>'assetKind', ''));
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  begin
    target_asset_id := (asset_input->>'id')::uuid;
  exception when others then
    raise exception 'Asset ID is invalid.' using errcode = '22023';
  end;
  if char_length(supplied_title) not between 2 and 140
    or char_length(supplied_description) > 1000
    or supplied_kind not in ('brand', 'template', 'footage', 'audio', 'image', 'document', 'link', 'other') then
    raise exception 'Asset fields are invalid.' using errcode = '22023';
  end if;
  update public.program_assets
  set title = supplied_title,
      description = supplied_description,
      asset_kind = supplied_kind,
      revision = revision + 1,
      updated_by = auth.uid()
  where id = target_asset_id and status <> 'archived';
  if not found then raise exception 'Editable asset was not found.' using errcode = '22023'; end if;
  return target_asset_id;
end;
$$;

create or replace function public.delete_draft_program_asset(target_asset_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  return query
  delete from public.program_assets asset
  where asset.id = target_asset_id and asset.status = 'draft'
  returning asset.storage_bucket, asset.storage_path;
  if not found then
    raise exception 'Only draft assets can be deleted.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.assign_program_asset(assignment_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare result_id uuid; supplied_asset_id uuid; supplied_enrollment_id uuid;
declare supplied_note text := btrim(coalesce(assignment_input->>'note', ''));
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  begin
    supplied_asset_id := (assignment_input->>'assetId')::uuid;
    supplied_enrollment_id := (assignment_input->>'enrollmentId')::uuid;
  exception when others then
    raise exception 'Assignment fields are invalid.' using errcode = '22023';
  end;
  if char_length(supplied_note) > 1000
    or not exists (select 1 from public.program_assets where id = supplied_asset_id and status = 'published')
    or not exists (select 1 from public.creator_enrollments where id = supplied_enrollment_id and status <> 'ended') then
    raise exception 'Published asset and active enrollment are required.' using errcode = '22023';
  end if;
  insert into public.creator_asset_assignments (
    asset_id, enrollment_id, assigned_by, note_to_creator
  ) values (
    supplied_asset_id, supplied_enrollment_id, auth.uid(), supplied_note
  )
  on conflict (asset_id, enrollment_id) do update
  set assigned_by = excluded.assigned_by,
      note_to_creator = excluded.note_to_creator,
      state = 'assigned',
      first_viewed_at = null,
      assigned_at = now()
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.set_program_asset_assignment_state(
  target_assignment_id uuid,
  target_state text
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if target_state = 'withdrawn' then
    if not public.creator_is_active_staff('reviewer') then
      raise exception 'Reviewer access required.' using errcode = '42501';
    end if;
    update public.creator_asset_assignments set state = 'withdrawn' where id = target_assignment_id;
  elsif target_state = 'viewed' then
    update public.creator_asset_assignments assignment
    set state = 'viewed', first_viewed_at = coalesce(assignment.first_viewed_at, now())
    from public.creator_enrollments enrollment
    where assignment.id = target_assignment_id
      and enrollment.id = assignment.enrollment_id
      and enrollment.account_id = auth.uid()
      and assignment.state <> 'withdrawn';
  else
    raise exception 'Assignment state is invalid.' using errcode = '22023';
  end if;
  if not found then raise exception 'Assignment was not found.' using errcode = '22023'; end if;
  return target_state;
end;
$$;

create or replace function public.get_own_creator_content_library()
returns table (library jsonb)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  return query select jsonb_build_object(
    'scripts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', assignment.id,
        'title', script.title,
        'summary', script.summary,
        'body_markdown', script.body_markdown,
        'revision', script.revision,
        'note', assignment.note_to_creator,
        'due_at', assignment.due_at,
        'state', assignment.state,
        'assigned_at', assignment.assigned_at
      ) order by assignment.assigned_at desc)
      from public.creator_script_assignments assignment
      join public.program_scripts script on script.id = assignment.script_id
      join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
      where enrollment.account_id = auth.uid()
        and enrollment.status <> 'ended'
        and script.status = 'published'
        and assignment.state <> 'withdrawn'
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', assignment.id,
        'asset_id', asset.id,
        'title', asset.title,
        'description', asset.description,
        'asset_kind', asset.asset_kind,
        'source_type', asset.source_type,
        'original_filename', asset.original_filename,
        'mime_type', asset.mime_type,
        'size_bytes', asset.size_bytes,
        'revision', asset.revision,
        'note', assignment.note_to_creator,
        'state', assignment.state,
        'assigned_at', assignment.assigned_at
      ) order by assignment.assigned_at desc)
      from public.creator_asset_assignments assignment
      join public.program_assets asset on asset.id = assignment.asset_id
      join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
      where enrollment.account_id = auth.uid()
        and enrollment.status <> 'ended'
        and asset.status = 'published'
        and assignment.state <> 'withdrawn'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_own_creator_asset_download(target_asset_id uuid)
returns table (
  source_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  download_filename text,
  assignment_id uuid
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  return query
  select asset.source_type, asset.external_url, asset.storage_bucket, asset.storage_path,
         coalesce(asset.original_filename, asset.title), assignment.id
  from public.program_assets asset
  join public.creator_asset_assignments assignment on assignment.asset_id = asset.id
  join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
  where asset.id = target_asset_id
    and asset.status = 'published'
    and assignment.state <> 'withdrawn'
    and enrollment.status <> 'ended'
    and enrollment.account_id = auth.uid();
end;
$$;

create or replace function public.get_program_asset_download_staff(target_asset_id uuid)
returns table (
  source_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  download_filename text,
  assignment_id uuid
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  return query
  select asset.source_type, asset.external_url, asset.storage_bucket, asset.storage_path,
         coalesce(asset.original_filename, asset.title), null::uuid
  from public.program_assets asset
  where asset.id = target_asset_id;
end;
$$;

create or replace function public.creator_can_read_program_asset_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.creator_is_active_staff('reviewer') or exists (
    select 1
    from public.program_assets asset
    join public.creator_asset_assignments assignment on assignment.asset_id = asset.id
    join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
    where asset.storage_bucket = 'creator-program-assets'
      and asset.storage_path = object_name
      and asset.status = 'published'
      and assignment.state <> 'withdrawn'
      and enrollment.status <> 'ended'
      and enrollment.account_id = auth.uid()
  );
$$;

create or replace function public.creator_can_delete_program_asset_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.creator_is_active_staff('reviewer') and not exists (
    select 1
    from public.program_assets asset
    where asset.storage_bucket = 'creator-program-assets'
      and asset.storage_path = object_name
  );
$$;

alter table public.program_scripts enable row level security;
alter table public.creator_script_assignments enable row level security;
alter table public.program_assets enable row level security;
alter table public.creator_asset_assignments enable row level security;

revoke all on public.program_scripts from public, anon, authenticated;
revoke all on public.creator_script_assignments from public, anon, authenticated;
revoke all on public.program_assets from public, anon, authenticated;
revoke all on public.creator_asset_assignments from public, anon, authenticated;

revoke execute on function public.creator_is_active_staff(text) from public, anon;
grant execute on function public.creator_is_active_staff(text) to authenticated;

revoke execute on function public.get_creator_content_admin_overview() from public, anon, authenticated;
grant execute on function public.get_creator_content_admin_overview() to authenticated;
revoke execute on function public.save_program_script(jsonb) from public, anon, authenticated;
grant execute on function public.save_program_script(jsonb) to authenticated;
revoke execute on function public.set_program_script_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_program_script_status(uuid, text) to authenticated;
revoke execute on function public.delete_draft_program_script(uuid) from public, anon, authenticated;
grant execute on function public.delete_draft_program_script(uuid) to authenticated;
revoke execute on function public.assign_program_script(jsonb) from public, anon, authenticated;
grant execute on function public.assign_program_script(jsonb) to authenticated;
revoke execute on function public.set_program_script_assignment_state(uuid, text) from public, anon, authenticated;
grant execute on function public.set_program_script_assignment_state(uuid, text) to authenticated;
revoke execute on function public.register_program_asset(jsonb) from public, anon, authenticated;
grant execute on function public.register_program_asset(jsonb) to authenticated;
revoke execute on function public.set_program_asset_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_program_asset_status(uuid, text) to authenticated;
revoke execute on function public.save_program_asset_metadata(jsonb) from public, anon, authenticated;
grant execute on function public.save_program_asset_metadata(jsonb) to authenticated;
revoke execute on function public.delete_draft_program_asset(uuid) from public, anon, authenticated;
grant execute on function public.delete_draft_program_asset(uuid) to authenticated;
revoke execute on function public.assign_program_asset(jsonb) from public, anon, authenticated;
grant execute on function public.assign_program_asset(jsonb) to authenticated;
revoke execute on function public.set_program_asset_assignment_state(uuid, text) from public, anon, authenticated;
grant execute on function public.set_program_asset_assignment_state(uuid, text) to authenticated;
revoke execute on function public.get_own_creator_content_library() from public, anon, authenticated;
grant execute on function public.get_own_creator_content_library() to authenticated;
revoke execute on function public.get_own_creator_asset_download(uuid) from public, anon, authenticated;
grant execute on function public.get_own_creator_asset_download(uuid) to authenticated;
revoke execute on function public.get_program_asset_download_staff(uuid) from public, anon, authenticated;
grant execute on function public.get_program_asset_download_staff(uuid) to authenticated;
revoke execute on function public.creator_can_read_program_asset_object(text) from public, anon;
grant execute on function public.creator_can_read_program_asset_object(text) to authenticated;
revoke execute on function public.creator_can_delete_program_asset_object(text) from public, anon;
grant execute on function public.creator_can_delete_program_asset_object(text) to authenticated;

-- Supabase Storage bootstrap. The insert is idempotent and deliberately does
-- not overwrite an operator's later bucket limits.
insert into storage.buckets (id, name, public, file_size_limit)
values ('creator-program-assets', 'creator-program-assets', false, 52428800)
on conflict (id) do nothing;

create policy creator_program_assets_staff_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'creator-program-assets'
  and public.creator_is_active_staff('reviewer')
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy creator_program_assets_authorized_read
on storage.objects for select to authenticated
using (
  bucket_id = 'creator-program-assets'
  and public.creator_can_read_program_asset_object(name)
);

create policy creator_program_assets_staff_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'creator-program-assets'
  and public.creator_can_delete_program_asset_object(name)
);

comment on table public.program_scripts is
  'Staff-authored script revisions. Publication and explicit enrollment assignment are separate gates.';
comment on table public.program_assets is
  'Private uploaded or HTTPS-linked campaign assets. Creators receive access only through assignments.';
