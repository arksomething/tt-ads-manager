# Creator-platform staff access recovery

This runbook is only for the break-glass case where the production database has
zero active administrators. It is not a browser flow. The creator app and its
authenticated API role cannot invoke the recovery function.

Normal staff additions and reactivations belong in `/admin/staff`. That screen
requires an existing active administrator and never changes a stored role.

## Trust boundary

`recover_zero_active_creator_admin(text, text, text)` is executable only by the
Supabase `service_role` or the database owner. Never place the service-role key
in browser code, a command argument, a ticket, or this repository. Load it only
inside the approved server-side secret boundary.

Two administrator accounts provide account-level separation and a recovery
path. They do not prove that two different humans control the accounts, and
they are not evidence of independent business or legal approval.

## Preconditions

1. Confirm the Supabase project identifier against
   `ops/creator-platform/supabase-project.json`.
2. Open an approved DB-owner SQL session or an approved server-only process
   holding the purpose-isolated service-role credential.
3. Record a non-secret incident or change reference, at least six characters.
4. Verify that no active administrator exists:

```sql
select count(*) as active_admin_count
from public.staff_members
where active and role = 'admin';
```

The result must be exactly `0`. The recovery function locks the membership
table and repeats this check, so a concurrent recovery cannot create an
unreviewed second break-glass change.

5. Verify the target is one exact, confirmed creator-platform account. Use a
lowercase email and inspect no auth metadata beyond these required fields:

```sql
select lower(btrim(auth_user.email)) as email,
       auth_user.email_confirmed_at is not null as email_confirmed,
       staff.role as stored_staff_role,
       staff.active as stored_staff_active
from auth.users auth_user
join public.creator_accounts creator_account
  on creator_account.auth_user_id = auth_user.id
left join public.staff_members staff
  on staff.auth_user_id = auth_user.id
where lower(btrim(auth_user.email)) = 'target@example.com';
```

The target must either have no staff membership or be an inactive
administrator. Recovery intentionally refuses to promote or otherwise change a
reviewer membership.

## Execute once

As the database owner, call the narrow function in the SQL editor or an
equivalent audited session:

```sql
select public.recover_zero_active_creator_admin(
  'target@example.com',
  'incident-or-change-reference',
  'RECOVER ADMIN ACCESS FOR target@example.com'
);
```

For service-role execution, call the same RPC from an approved server-only
client with those three named arguments: `target_email`, `recovery_reference`,
and `recovery_confirmation`. Do not use `curl` with credentials in its command
line and do not add a web route around this RPC.

The call fails closed if an active admin appears, the account is missing or
unconfirmed, the stored role is not eligible, or the confirmation is not an
exact match. A successful real change appends an immutable event identifying
the restricted recovery actor kind, target, prior and new state, outcome,
timestamp, and the private recovery reference.

## Verify and return to the normal path

```sql
select lower(btrim(auth_user.email)) as email, staff.role, staff.active
from public.staff_members staff
join auth.users auth_user on auth_user.id = staff.auth_user_id
where lower(btrim(auth_user.email)) = 'target@example.com';

select actor_kind, target_email_snapshot, prior_role, prior_active,
       new_role, new_active, request_outcome, created_at
from public.creator_staff_access_events
where target_email_snapshot = 'target@example.com'
order by created_at desc, id desc
limit 1;
```

Then sign in as the recovered administrator and use `/admin/staff` to add a
second confirmed administrator account with the exact typed confirmation. Do
not edit or delete the audit event; the table rejects updates and deletions.

If the wrong account was recovered, do not improvise a browser removal flow.
Establish another verified administrator first, then use a separately reviewed
DB-owner repair with the incident reference preserved in the immutable ledger.
