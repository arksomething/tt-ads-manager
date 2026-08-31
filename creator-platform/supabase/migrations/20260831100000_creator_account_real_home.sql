-- Completed creator accounts stay inside the authenticated account experience.
-- Public preview routes are marketing demos and must never be an onboarding
-- destination for a real creator.

create or replace function public.get_creator_account_state()
returns table (
  account_status text,
  application_id uuid,
  application_status text,
  agreement_status text,
  next_path text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_confirmed_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select email_confirmed_at into current_user_confirmed_at
  from auth.users where id = current_user_id;

  if current_user_confirmed_at is not null then
    update public.creator_accounts
    set lifecycle_status = 'profile_incomplete'
    where auth_user_id = current_user_id
      and lifecycle_status = 'email_unverified';
  end if;

  return query
  select
    ca.lifecycle_status,
    app.id,
    app.status,
    agr.status,
    case
      when current_user_confirmed_at is null then '/auth/check-email'
      when app.id is null then '/apply'
      when app.status in ('submitted', 'in_review', 'rejected', 'withdrawn') then '/application/status'
      when enrollment.id is null then '/application/status'
      when agr.status is null or agr.status <> 'completed' then '/onboarding/agreement'
      else '/account'
    end
  from public.creator_accounts ca
  left join public.creator_applications app on app.account_id = ca.auth_user_id
  left join public.creator_enrollments enrollment on enrollment.account_id = ca.auth_user_id
  left join lateral (
    select agreement_records.status
    from public.agreement_records
    where agreement_records.enrollment_id = enrollment.id
    order by agreement_records.created_at desc
    limit 1
  ) agr on true
  where ca.auth_user_id = current_user_id;
end;
$$;

revoke execute on function public.get_creator_account_state() from public, anon;
grant execute on function public.get_creator_account_state() to authenticated;
