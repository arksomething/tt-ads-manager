-- Real admin home, creator directory, profiles, activity, and finance summary.
-- Unknown tracking coverage remains null instead of being rendered as zero.

create or replace function public.get_creator_admin_workspace(
  range_start date default (current_date - 6),
  range_end date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_staff boolean;
begin
  ignored_staff := public.creator_is_active_staff('reviewer');
  if not ignored_staff then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  if range_start is null or range_end is null or range_end < range_start
    or range_end - range_start > 366
  then
    raise exception 'Choose a valid reporting range of 367 days or fewer.' using errcode = '22023';
  end if;

  return (
    with post_deltas as (
      select
        post.id,
        post.account_id,
        (
          select observation.view_count
          from public.creator_post_observations observation
          where observation.post_id = post.id
            and observation.observed_at < (range_end + 1)::timestamptz
            and observation.view_count is not null
          order by observation.observed_at desc
          limit 1
        ) as ending_views,
        (
          select observation.view_count
          from public.creator_post_observations observation
          where observation.post_id = post.id
            and observation.observed_at < range_start::timestamptz
            and observation.view_count is not null
          order by observation.observed_at desc
          limit 1
        ) as starting_views
      from public.creator_posts post
    ),
    view_coverage as (
      select
        count(*) filter (where ending_views is not null)::integer as observed_post_count,
        count(*) filter (where ending_views is not null and starting_views is not null)::integer as known_delta_post_count,
        case
          when count(*) filter (where ending_views is not null and starting_views is not null) = 0 then null
          else sum(greatest(ending_views - starting_views, 0))
            filter (where ending_views is not null and starting_views is not null)
        end as views_gained
      from post_deltas
    ),
    daily_activity as (
      select jsonb_agg(jsonb_build_object(
        'date', day_record.day,
        'posts', (
          select count(*)::integer from public.creator_posts post
          where post.published_at >= day_record.day::timestamptz
            and post.published_at < (day_record.day + 1)::timestamptz
        ),
        'submissions', (
          select count(*)::integer from public.creator_content_submissions submission
          where submission.submitted_at >= day_record.day::timestamptz
            and submission.submitted_at < (day_record.day + 1)::timestamptz
        ),
        'observedPosts', (
          select count(distinct observation.post_id)::integer
          from public.creator_post_observations observation
          where observation.observed_at >= day_record.day::timestamptz
            and observation.observed_at < (day_record.day + 1)::timestamptz
        )
      ) order by day_record.day) as rows
      from generate_series(range_start, range_end, interval '1 day') generated(day_value)
      cross join lateral (select generated.day_value::date as day) day_record
    ),
    creator_directory as (
      select jsonb_agg(jsonb_build_object(
        'accountId', account_record.auth_user_id,
        'name', application_record.name,
        'email', account_record.email_snapshot,
        'lifecycleStatus', account_record.lifecycle_status,
        'applicationId', application_record.id,
        'applicationStatus', application_record.status,
        'enrollmentStatus', enrollment_record.status,
        'joinedAt', account_record.created_at,
        'approvedAt', enrollment_record.approved_at,
        'platforms', coalesce((
          select jsonb_agg(jsonb_build_object(
            'platform', platform_account.platform,
            'handle', platform_account.current_handle,
            'status', platform_account.status
          ) order by platform_account.platform, platform_account.normalized_handle)
          from public.creator_platform_accounts platform_account
          where platform_account.account_id = account_record.auth_user_id
        ), '[]'::jsonb),
        'postCount', (
          select count(*)::integer from public.creator_posts post
          where post.account_id = account_record.auth_user_id
        ),
        'openSubmissionCount', (
          select count(*)::integer from public.creator_content_submissions submission
          where submission.account_id = account_record.auth_user_id
            and submission.match_state in ('submitted', 'matching', 'needs_review')
        ),
        'lastPostAt', (
          select max(post.published_at) from public.creator_posts post
          where post.account_id = account_record.auth_user_id
        ),
        'lastActivityAt', greatest(
          account_record.updated_at,
          coalesce((select max(post.created_at) from public.creator_posts post where post.account_id = account_record.auth_user_id), '-infinity'::timestamptz),
          coalesce((select max(submission.submitted_at) from public.creator_content_submissions submission where submission.account_id = account_record.auth_user_id), '-infinity'::timestamptz),
          coalesce((select max(assignment.assigned_at)
            from public.creator_script_assignments assignment
            join public.creator_enrollments enrollment on enrollment.id = assignment.enrollment_id
            where enrollment.account_id = account_record.auth_user_id), '-infinity'::timestamptz)
        )
      ) order by greatest(
        account_record.updated_at,
        coalesce((select max(post.created_at) from public.creator_posts post where post.account_id = account_record.auth_user_id), '-infinity'::timestamptz),
        coalesce((select max(submission.submitted_at) from public.creator_content_submissions submission where submission.account_id = account_record.auth_user_id), '-infinity'::timestamptz)
      ) desc) as rows
      from public.creator_accounts account_record
      left join public.creator_applications application_record
        on application_record.account_id = account_record.auth_user_id
      left join public.creator_enrollments enrollment_record
        on enrollment_record.account_id = account_record.auth_user_id
    )
    select jsonb_build_object(
      'range', jsonb_build_object('start', range_start, 'end', range_end),
      'summary', jsonb_build_object(
        'creatorCount', (select count(*)::integer from public.creator_accounts),
        'activeCreatorCount', (select count(*)::integer from public.creator_accounts where lifecycle_status = 'active'),
        'applicationAttentionCount', (
          select count(*)::integer from public.creator_applications
          where status in ('submitted', 'in_review', 'changes_requested')
        ),
        'verifiedPlatformAccountCount', (
          select count(*)::integer from public.creator_platform_accounts where status = 'verified'
        ),
        'publishedPostCount', (
          select count(*)::integer from public.creator_posts
          where published_at >= range_start::timestamptz
            and published_at < (range_end + 1)::timestamptz
        ),
        'contentAttentionCount', (
          select count(*)::integer from public.creator_content_submissions
          where match_state in ('submitted', 'matching', 'needs_review')
        ),
        'observedPostCount', (select observed_post_count from view_coverage),
        'knownDeltaPostCount', (select known_delta_post_count from view_coverage),
        'viewsGained', (select views_gained::text from view_coverage),
        'discordConnectedCount', (
          select count(*)::integer from public.creator_discord_connections
          where disconnected_at is null
        )
      ),
      'earnings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', grouped.currency,
          'currencyExponent', grouped.currency_exponent,
          'state', grouped.state,
          'amountMinor', grouped.amount_minor::text,
          'entryCount', grouped.entry_count
        ) order by grouped.currency, grouped.state)
        from (
          select currency, currency_exponent, state,
            sum(amount_minor) as amount_minor,
            count(*)::integer as entry_count
          from public.creator_earning_entries
          where earned_at >= range_start::timestamptz
            and earned_at < (range_end + 1)::timestamptz
          group by currency, currency_exponent, state
        ) grouped
      ), '[]'::jsonb),
      'settlements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', grouped.currency,
          'currencyExponent', grouped.currency_exponent,
          'state', grouped.state,
          'amountMinor', grouped.amount_minor::text,
          'settlementCount', grouped.settlement_count
        ) order by grouped.currency, grouped.state)
        from (
          select currency, currency_exponent, state,
            sum(total_minor) as amount_minor,
            count(*)::integer as settlement_count
          from public.creator_settlements
          where created_at >= range_start::timestamptz
            and created_at < (range_end + 1)::timestamptz
          group by currency, currency_exponent, state
        ) grouped
      ), '[]'::jsonb),
      'dailyActivity', coalesce((select rows from daily_activity), '[]'::jsonb),
      'creators', coalesce((select rows from creator_directory), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_creator_admin_profile(target_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_staff boolean;
  result jsonb;
begin
  ignored_staff := public.creator_is_active_staff('reviewer');
  if not ignored_staff then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'account', jsonb_build_object(
      'id', account_record.auth_user_id,
      'email', account_record.email_snapshot,
      'lifecycleStatus', account_record.lifecycle_status,
      'createdAt', account_record.created_at
    ),
    'application', case when application_record.id is null then null else jsonb_build_object(
      'id', application_record.id,
      'name', application_record.name,
      'phoneNumber', application_record.phone_e164,
      'discordUsername', application_record.discord_username,
      'status', application_record.status,
      'submittedAt', application_record.submitted_at,
      'reviewedAt', application_record.reviewed_at
    ) end,
    'enrollment', case when enrollment_record.id is null then null else jsonb_build_object(
      'id', enrollment_record.id,
      'status', enrollment_record.status,
      'approvedAt', enrollment_record.approved_at,
      'activatedAt', enrollment_record.activated_at
    ) end,
    'agreement', case when agreement_record.id is null then null else jsonb_build_object(
      'status', agreement_record.status,
      'provider', agreement_record.provider,
      'sentAt', agreement_record.sent_at,
      'completedAt', agreement_record.completed_at
    ) end,
    'platformClaims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', claim.id,
        'platform', claim.platform,
        'handle', claim.entered_handle,
        'status', claim.status,
        'lastCheckedAt', claim.last_checked_at,
        'verifiedAt', claim.ownership_verified_at
      ) order by claim.platform, claim.normalized_handle)
      from public.creator_platform_account_claims claim
      where claim.account_id = account_record.auth_user_id
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', post.id,
        'platform', post.platform,
        'nativePostId', post.native_post_id,
        'url', post.canonical_url,
        'publishedAt', post.published_at,
        'attributionState', post.attribution_state,
        'latestObservation', (
          select jsonb_build_object(
            'observedAt', observation.observed_at,
            'viewCount', observation.view_count::text,
            'likeCount', observation.like_count::text,
            'commentCount', observation.comment_count::text,
            'shareCount', observation.share_count::text
          )
          from public.creator_post_observations observation
          where observation.post_id = post.id
          order by observation.observed_at desc
          limit 1
        )
      ) order by post.published_at desc nulls last, post.created_at desc)
      from public.creator_posts post
      where post.account_id = account_record.auth_user_id
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', submission.id,
        'platform', submission.platform,
        'url', submission.submitted_url,
        'matchState', submission.match_state,
        'submittedAt', submission.submitted_at,
        'matchedAt', submission.matched_at
      ) order by submission.submitted_at desc)
      from public.creator_content_submissions submission
      where submission.account_id = account_record.auth_user_id
    ), '[]'::jsonb),
    'earnings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', earning.id,
        'postId', earning.post_id,
        'category', earning.category,
        'currency', earning.currency,
        'currencyExponent', earning.currency_exponent,
        'amountMinor', earning.amount_minor::text,
        'state', earning.state,
        'earnedAt', earning.earned_at
      ) order by earning.earned_at desc)
      from public.creator_earning_entries earning
      where earning.account_id = account_record.auth_user_id
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', settlement.id,
        'currency', settlement.currency,
        'currencyExponent', settlement.currency_exponent,
        'totalMinor', settlement.total_minor::text,
        'state', settlement.state,
        'createdAt', settlement.created_at
      ) order by settlement.created_at desc)
      from public.creator_settlements settlement
      where settlement.account_id = account_record.auth_user_id
    ), '[]'::jsonb),
    'scripts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', script.title,
        'state', assignment.state,
        'assignedAt', assignment.assigned_at,
        'dueAt', assignment.due_at
      ) order by assignment.assigned_at desc)
      from public.creator_script_assignments assignment
      join public.program_scripts script on script.id = assignment.script_id
      where assignment.enrollment_id = enrollment_record.id
    ), '[]'::jsonb)
  ) into result
  from public.creator_accounts account_record
  left join public.creator_applications application_record
    on application_record.account_id = account_record.auth_user_id
  left join public.creator_enrollments enrollment_record
    on enrollment_record.account_id = account_record.auth_user_id
  left join lateral (
    select agreement.* from public.agreement_records agreement
    where agreement.enrollment_id = enrollment_record.id
    order by agreement.created_at desc limit 1
  ) agreement_record on true
  where account_record.auth_user_id = target_account_id;

  if result is null then
    raise exception 'Creator account was not found.' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

revoke execute on function public.get_creator_admin_workspace(date, date) from public, anon;
revoke execute on function public.get_creator_admin_profile(uuid) from public, anon;
grant execute on function public.get_creator_admin_workspace(date, date) to authenticated;
grant execute on function public.get_creator_admin_profile(uuid) to authenticated;

comment on function public.get_creator_admin_workspace(date, date) is
  'Staff-only creator operations projection. View gains are null unless both boundary observations exist.';
