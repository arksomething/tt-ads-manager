# Creator Discord and reminder protocol

## Authority boundaries

The GoTall Management Discord application is shared, but its capabilities are
not:

1. Vercel owns creator OAuth linking with the Discord client secret. It never
   receives the bot token and never retains OAuth access or refresh tokens.
2. Supabase owns creator consent, source events, reminder schedules, leases,
   role intent, attempts, and delivery receipts.
3. The laptop delivery worker owns the bot token. It can render only reviewed
   template/version pairs and can change only the four configured lifecycle
   roles.
4. Hermes remains an operator-only conversational agent. A linked creator is
   never added to `DISCORD_ALLOWED_USERS`, and creator DMs do not grant Hermes
   tool access.

## Connection flow

`GET /api/integrations/discord/start` requires a confirmed creator session. It
creates 32 random bytes, stores only their SHA-256 digest with the account and a
ten-minute expiry, then requests Discord scopes `identify` and
`guilds.members.read`.

The registered callback is currently
`https://gethyperspeed.com/api/integrations/discord/callback`. A narrowly routed
Cloudflare Worker proxies only that path to the isolated Vercel application.
The callback consumes the database state atomically before exchanging the code,
fetches the stable Discord user ID and GoTall Creators membership, stores the
identity snapshot, and revokes/discards the temporary user token. The callback
does not depend on a cross-domain browser cookie.

Connection and notification consent are separate actions. Linking never turns
on DMs. A creator who is not in GoTall Creators gets an authenticated invitation
action and must reconnect after joining so membership is verified.

## Notification states

An immutable logical notification is created first. Its Discord delivery uses
this durable state machine:

`scheduled -> leased -> sending -> sent`

Additional terminal or recovery states are `retry`, `blocked`,
`delivery_unknown`, `cancelled`, and `dead`.

- A unique event key prevents duplicate logical notifications.
- A unique delivery idempotency key prevents duplicate channel work.
- A lease token and `FOR UPDATE SKIP LOCKED` prevent two workers claiming the
  same row.
- Begin-send rechecks the active identity, verified guild membership, opt-in,
  topic selection, cancellation, expiry, quiet hours, and delivery cadence.
- A state change that resolves the source condition cancels future reminders.
- Discord acceptance stores channel/message IDs and a rendered-content hash.
  It is shown to creators as “Accepted by Discord,” never “read.”

The worker signs method, path, timestamp, worker ID, request nonce, and exact
body hash with a dedicated HMAC key. Request nonces are single-use in Supabase,
and timestamps have a five-minute window. The key cannot read general Supabase
data and is not reused as a bot, auth, cron, or ingestion credential.

## Reviewed v1 reminders

The scheduler may derive only these source-backed reminders:

| Source state | Template | Timing |
| --- | --- | --- |
| Application submitted | `application.received.v1` | once |
| Application moves to review, approved, or rejected | `application.status.v1` | once per state |
| Agreement becomes available | `agreement.ready.v1` | once |
| Agreement remains incomplete | `agreement.reminder.v1` | +24 hours, +72 hours, +7 days |
| Creator explicitly asks for a test | `creator.test.v1` | at most once per UTC hour |

Agreement reminders stop on completion, decline, or void. Posting and
performance reminders remain disabled until both structured deal obligations
and complete, fresh canonical tracking coverage exist. A Viral discovery limit,
missing observation, provider outage, or unknown counter is never interpreted
as a creator failing to post.

The default quiet window is 9 p.m.–9 a.m. in the creator's confirmed IANA
timezone. Automated DMs are capped at two per creator-local calendar day and
separated by at least four hours server-side. The creator-requested test is
separately limited to once per UTC hour and is the only v1 action that bypasses
quiet hours, so the creator receives immediate confirmation after pressing the
test button.

## Discord delivery rules

The worker opens a DM only after a linked member explicitly opts in. Every
message uses:

- a reviewed local renderer, not arbitrary database or Hermes prose;
- a stable provider nonce of at most 25 characters;
- `enforce_nonce: true`;
- `allowed_mentions: {"parse": []}`; and
- an authenticated application route instead of a bearer signing URL.

The SQLite WAL journal is written before delivery. If the worker crashes after
Discord accepts a message but before Supabase acknowledges it, the next lease
searches the DM for the stored nonce. If that lookup finds the message, the
worker records its receipt. If the lookup succeeds without evidence or cannot
be completed for a non-systemic reason, the delivery becomes a terminal
`ambiguous_send_timeout` for manual review. Bot-wide access failures preserve
the recovery-only state and open the circuit. The worker never retries an
uncertain message POST.
The central lease carries a recovery-required bit from its pre-lease state. A
missing or invalid bit is treated as recovery-required, and missing local
journal evidence is terminal. This remains fail-closed even if the laptop's
SQLite file is lost or replaced. The bit is durable across policy deferrals and
the original target connection, user, and channel stay pinned across relinks.
Only non-ambiguous prepared work may rebind to a current connection; it replaces
both cached user and channel so a prior creator's DM cannot be reused.

Failures are handled as follows:

- `429`: use Discord's returned retry time with small jitter;
- network or `5xx` before Create Message: bounded exponential/full-jitter retry;
- a transport failure or `5xx` during Create Message: evidence-only recovery,
  then terminal manual review if the exact nonce is not found;
- bot `401`, missing access/permissions, or lost guild/role authority: retry the
  current item, open the worker circuit, mark heartbeat degraded, and stop
  leasing until the full bot/guild/role preflight passes; if this occurs during
  evidence lookup, retain central `delivery_unknown` so no later lease can
  become a blind send after local journal loss;
- guild-member `404/10007`: mark that creator `not_member` and block their
  pending Discord deliveries;
- closed creator DMs (`50007`): block Discord delivery while preserving the
  in-app notification;
- invalid payload/template: dead-letter as a code defect; and
- eight actual send attempts: dead-letter.

Replies are not routed into Hermes. Transactional copy says replies are not
monitored and links to the authenticated account.

## Lifecycle roles

The database expresses only these keys: `onboarding`, `active`, `at_risk`, and
`top_performer`. Raw role IDs live in worker configuration. Reconciliation
fetches current membership, adds/removes only those four managed IDs, and
preserves every unmanaged Discord role.

- pre-activation: `onboarding`;
- active: `active`;
- suspended, closed, or disconnected: remove all managed roles.

At-risk and top-performer intent remains unused until canonical business state
defines it. Notification opt-out does not remove roles; disconnect does.

## Restart and operating proof

Supabase is the durable queue. The laptop runs
`gotall-creator-discord-worker.service` as a system service with
`Restart=always`, `network-online.target`, a systemd-managed state directory,
and host-encrypted credentials. It runs under the dedicated no-login
`gotall-discord` account with home directories inaccessible, using only a
root-owned installed runtime and its state directory. The service starts at
boot independently of an interactive login. Worker heartbeat, queue age, sanitized failures, role-job
states, and link coverage are visible at `/admin/discord` to active staff only.

Production proof requires one explicitly consenting test account to complete:

1. OAuth link and stable native ID persistence;
2. GoTall Creators membership verification;
3. onboarding-role reconciliation without touching unrelated roles;
4. one requested test DM and one recorded Discord receipt;
5. opt-out suppressing another test; and
6. disconnect cancelling pending delivery and removing managed roles.

No unsolicited message to an existing creator is an acceptable test.
