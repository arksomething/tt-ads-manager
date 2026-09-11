# GoTall Discord admin guide

Use `/creator help` for an in-Discord reference. Type `/creator` to browse the command descriptions; selecting a command exposes descriptions, required arguments and allowed choices. These are Discord's native command hints, not custom hover tooltips.

## Access and scope

These commands run only in Retconned's test server. Every response is ephemeral (visible only to the invoking admin). Owner, Administrator, Manage Server, or GoTall Staff is required by the bot, including for read-only commands. `/creator` is initially exposed to Manage Server/admins by Discord. To enable it for the GoTall Staff role without granting Manage Server, use **Server Settings → Integrations → GoTall - Management → Commands** and grant that role access to `/creator`.

Select `creator:@member` explicitly for every individual operation. Commands can be run in a staff channel. A status response outside the creator channel links to that channel instead of displaying buttons that would target the wrong channel. Staff notes stay in the bot database and staff-only history; they are not posted in the creator channel. Reasons for requested account changes and declined leave are sent to the creator; approved-leave reasons appear in the creator's saved record.

## Daily workflow

1. `/creator list queue:accounts` → inspect each creator with `status`, open their accounts and check profile quality manually.
2. `approve-account` if ready, or `request-changes reason:…` with concrete corrections.
3. `attach-agreement url:…` → verify the personal signing link → `send-agreement`.
4. `/creator list queue:trials` → review submissions with `posts` → `trial decision:pass` or `trial decision:extend`.
5. `/creator list queue:leave` → read the requested dates in `status` → approve or decline with a reason.
6. `/creator list queue:risk` → check recent submissions, deadlines and leave before following up.
7. `/creator health` → investigate the sync queue when needed. Read `history` before retrying an uncertain action.

The same stage gates apply to slash commands and buttons. There is no arbitrary set-stage, force-sign, real payment or kick command.

## Command reference

All commands below begin with `/creator`. `page` is optional and defaults to 1. Queues and posts show up to 10 records; history shows 5 complete records per page so long notes fit Discord's message limits. All individual commands require `creator`.

| Command | Arguments beyond creator | Result and constraints |
|---|---|---|
| `help` | None; no creator needed | Private quick reference and limitations. |
| `list` | Optional `queue`, `page`; no creator needed | Queues: all, accounts, trials due, pending leave, risk, sync. Does not change anything. |
| `status` | None | Stage, account links, relevant deadlines, leave details and channel link. Identifies pending synchronization. |
| `posts` | Optional `page` | Submitted URLs with submission times. These are not verified videos or payout approvals. |
| `history` | Optional `page` | Recorded lifecycle actions, actor IDs, timestamps and private notes, newest first. Older actions predating event logging may be absent. |
| `note` | `text` | Private staff note, up to 500 characters. No creator notification or stage change. |
| `approve-account` | None | Requires account_review. Opens the agreement preparation stage; does not start the trial. |
| `request-changes` | `reason` | Requires account_review or account_ready. Shows corrections to the creator, clears account approval and returns to setup. |
| `attach-agreement` | `url` | Requires account_ready. Saves a full HTTPS signing URL; does not send or verify the contract. |
| `send-agreement` | None | Requires recorded account approval. Opens the signing step. Test mode permits no real URL. |
| `trial` | `decision`: pass or extend | Pass requires signing and an elapsed trial end date. Extend adds 3 days from the later of now or the current end date. |
| `approve-leave` | `days` (1–30), `reason` | Trial, active or At Risk only. Begins now; can also grant an urgent exception without a prior creator request. Preserves a later existing expiry and remaining risk time. |
| `decline-leave` | `reason` | Requires a pending request. Notifies the creator; time spent awaiting the decision remains protected. |
| `reopen` | `confirm:true` | Closed/removal_due only. Clears approval, signing, trial and leave state and returns to account setup. Submitted posts and history remain. |
| `retry` | None | Retries status card, channel and role synchronization for this creator. Does not change stage or bypass Discord rate limits. Message deliveries retry separately in the scheduler. |
| `preview` | `days` (0–30) | Reports future inactivity/trial decisions without changing dates, roles or membership. Does not preview future staff decisions. |
| `health` | None; no creator needed | Counts creators pending sync and messages pending delivery. This is queue status, not an external-provider health check. |

Examples (replace `@Alex` with the member selected in Discord):

```text
/creator status creator:@Alex
/creator request-changes creator:@Alex reason:Please add the campaign bio, then resubmit.
/creator approve-leave creator:@Alex days:2 reason:Urgent family matter; two days off starting now.
/creator trial creator:@Alex decision:pass
/creator note creator:@Alex text:Review the next three submissions for caption consistency.
/creator history creator:@Alex page:1
```

## Existing tools

- `/invite hours:24`: creates a one-use server invite; expiry accepts 1–168 hours.
- `/video-check`: staff supplies the video URL, observed views and the plug, @GoTall, #yap and provisional #partner flags. Saves a manual assessment and highest-tier payout estimate. It neither watches the video nor pays the creator.
- `/setup`: repairs the test layout and start card. Use for layout problems, not routine stage changes.
- `/status`: legacy creator status. Prefer `/creator status` for staff management.

## Dates, recovery and limits

Posting days use the creator's saved timezone. Discord renders timestamps in the viewer's timezone. Three missed posting days trigger At Risk; that period lasts four full days. A submitted time-off request pauses checks while pending. **Approving “2 days” means two days from the moment you submit, not the future dates typed in the request.** Approval does not automatically extend a trial deadline; use the trial extension command separately if appropriate.

Lifecycle commands retain Discord interaction IDs to avoid applying a redelivered interaction twice. Submitting a new command creates a new action; in particular, repeating an intentional extension adds another three days. Staff notes also deduplicate redelivered interactions. Synchronization can fail after the stage was saved. Check status/history before repeating a command; use retry for delivery-related recovery.

Real signature callbacks, automatic content/view checks, payments and kicks are not enabled. Simulated signing remains a creator button in the test agreement stage. The pre-existing competing Hermes runtime answered `/status` during the audit; registration of the new `/creator` group does not prove that competing runtime is resolved. Do not stop unrelated production workers to address it.

Implementation: `admin.mjs` owns slash descriptions and routing, `workspace.mjs` owns authorization and durable lifecycle actions, and `flow.mjs` owns stage gates and copy. Keep this guide and `/creator help` aligned with any command changes.
