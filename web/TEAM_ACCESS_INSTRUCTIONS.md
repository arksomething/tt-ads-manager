# Team Access Instructions

## Recommended role model

- `OWNER`: reserve for the founder or primary operator. This is full control over the organization.
- `ADMIN`: use for people who should access the whole organization and every campaign.
- `MANAGER`: use for people who should run exactly one campaign.
- `MEMBER`: optional baseline role for people who need workspace access without org-wide control.

## How access works now

1. Organization admins and owners manage org-wide access from `Team`.
2. Campaign-specific managers and members are managed from `Campaigns`.
3. Every invited person signs in with Google. There are no passwords.
4. The invite is matched to the exact email address used for Google sign-in.

## Invite flow with Google auth

1. Enter the teammate's email in the invite form.
2. If that email already belongs to an existing user, access applies immediately.
3. If the person has never signed in before, the invite stays pending.
4. The person opens `/login` and signs in with Google using that same email.
5. The app auto-claims the pending invite on first sign-in.

## Important limitation

The app currently does **not** send an invitation email automatically.

That means the human workflow is:

1. Create the invite in the app.
2. Send the teammate a message manually.
3. Tell them to go to `/login`.
4. Tell them to use the exact Google email that was invited.

## How to set up your team

### Give someone full org access

1. Open `Team`.
2. Invite them as `ADMIN`.
3. They sign in with Google using the invited email.
4. They now have access to the whole org and all campaigns.

### Give someone access to only one campaign

1. Open `Campaigns`.
2. Create the campaign if it does not exist yet. Only org admins/owners can do this.
3. Open that campaign's detail panel.
4. Invite the person as `MANAGER`.
5. They sign in with Google using the invited email.
6. They will only see the campaign they were added to.

## Day-to-day admin rules

- Use `ADMIN` for internal operators who should see everything.
- Use `MANAGER` for client-facing leads, campaign operators, or freelancers who should stay scoped.
- Keep `OWNER` count low.
- If someone leaves, remove them from `Team` for org-wide access, or remove them from the specific campaign for campaign-only access.
- If an invite is wrong or no longer needed, revoke it and create a new one with the correct email or role.

## Suggested message to send invitees

```text
You’ve been added to Billion Views.

Open /login and continue with Google using this exact email address:
<their email>

If you use a different Google account, the invite will not attach to your access.
```
