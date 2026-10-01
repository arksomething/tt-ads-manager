# Creator offboarding design

Status: original design and audit, September 29, 2026. The implemented Discord workflow and the subsequently approved automatic-removal policy are documented in [OFFBOARDING.md](discord-onboarding-bot/OFFBOARDING.md). That guide supersedes proposed commands, permanent membership and reinstatement suggestions below. No creator is enrolled by deploying the workflow.

## Outcome

An offboarded creator stays in the server and keeps their existing private channel with staff. They can read its history, send messages, supply missing post links and payment evidence, and ask about final payment. They cannot access scripts, inspiration, assets, community, submissions, other creators' channels, or voice channels. Their previous work, deal evidence and payment history remain intact.

Use one **Offboarded** role and an **Offboarded Creators** category containing separate private creator channels. Do not put all former creators into a shared conversation. Keep each channel ID and its message history; a category move is organization, not access enforcement.

## What exists and what is missing

Read-only live audit on September 29:

- Production guild: `1400610531189985310`. The running `gotall-discord-onboarding-test.service` is production despite its historical name. Installed `flow.mjs`, `workspace.mjs` and `scripts.mjs` matched the repository by SHA-256 at inspection.
- An inactive category already exists: `1496975271486689280`, displayed as `NOT ACTIVE CREATORS`. A cosmetic role named `NOT ACTICE CREATORS` also exists. There is no managed `role_offboarded` resource.
- The private channels for vcenreu and kabeerugc are in that category, but both members still have **Legacy** and **Scripts**. Effective permissions calculated from current roles and channel overwrites allow 16 non-category channels each, including scripts, assets, community and legacy submissions. This does not establish that either creator was formally terminated; it establishes that the category does not isolate them.
- Koble also has Legacy and Scripts. His stored cohort is legacy. No action on Koble is included in this design.
- `workspace.mjs` returns early for legacy creators before lifecycle channel/role synchronization. New-cohort synchronization removes certain lifecycle/Hub roles for closed stages but does not comprehensively remove all access grants.
- `flow.mjs` has `removed` and `removal_due`; its `offboard` action requires At Risk and rejects production execution. The scheduler skips active/trial/At Risk and legacy records in the inspected path. The README's three-missed-days/four-day automatic removal description is not evidence of a working production offboarding workflow.
- There is no single audited action combining stop-work notice, access restriction, final-work inventory, payment reconciliation and completion verification.

Evidence anchors: `discord-onboarding-bot/workspace.mjs` (`sync`, `schedule`, `privateOverwrites`); `flow.mjs` (`transition`, `inactivityDecision`); `scripts.mjs` (`reconcile`, recipient selection); `resource-guidance.mjs` (Legacy/Hub access); live Discord GETs and the read-only onboarding database. Recheck this snapshot before implementation.

## Staff workflow

1. **Select and review.** Owner/Admin or Manager selects a creator and previews current accounts, channels, roles, deal/signature evidence, leave, outstanding drafts, recent posts, open invoices and tracking coverage. Show the creator's identity and channel prominently. Record a private reason and a separate respectful creator-facing explanation.
2. **Approve offboarding.** The preview includes the exact notice, effective date/time, roles to remove, remaining visible channels and unresolved settlement items. A confirmed action commits that reviewed version. A changed creator record invalidates a stale preview. Ordinary inactivity generates a staff review suggestion, not an automatic offboarding decision.
3. **Stop assignments and notify.** Freeze new assignments, script delivery, posting reminders and new-work approvals. Deliver a stop-posting notice into the existing private channel, mention only that creator and link their status card. Record the Discord message ID. A successful send establishes delivery, not that the creator read it.
4. **Restrict and verify access.** Preserve the private channel, remove program access, assign Offboarded and move the channel into Offboarded Creators. Read back member roles and all relevant channel overwrites; calculate effective access. Do not report access removal complete until verification passes.
5. **Reconcile final work and payment.** Inventory eligible existing posts, pending approved work, views still maturing, approved bonuses, invoices, prior payments and disputes. Keep the private channel available for corrections. Publish a final statement when supported by evidence; Michael executes payment and supplies transfer evidence.
6. **Close.** Mark the case closed only after notice delivery, verified access restriction, final-work review, and either verified settlement or an evidence-backed, reviewed no-balance statement. Unresolved terms, balances and disputes keep the case open rather than being called paid. The creator remains Offboarded during the final-report and reply grace periods. The approved follow-up policy kicks them after the later of final report +14 days or latest human reply +7 days, never before the payout date, and only with settled payment, no unanswered messages and no unresolved issues. The channel and records are retained.

Suggested UI: `/creator offboard creator:@member` opens a preview and confirmation; `/creator offboarding-status` shows progress; `/creator offboarding-retry` resumes failed steps; `/creator reinstate` starts a separately reviewed return. These commands do not exist yet. Put equivalent controls in the existing staff panel. Confirmation belongs inside this designed workflow, not as an extra approval before drafting this document.

## States and records

Keep participation, access and settlement separate so an unpaid creator can still be offboarded from future assignments without being marked paid.

| Dimension | States |
| --- | --- |
| Participation | participating → offboarding → offboarded |
| Notice | pending → delivered; failed/uncertain require recovery |
| Access | pending → verified; failed/drifted require repair |
| Settlement | needs_review → awaiting_metrics → ready_for_review → approved → payment_pending → paid; disputed is explicit |
| Case | open → closed; can reopen for correction without restoring program access |

Add an offboarding case and immutable events rather than overwriting historical agreements. Store creator/guild/channel IDs, actor, reason codes and texts, reviewed record version, request ID, previous participation state, agreement/deal references, previous roles/overwrites, notice text/message ID, requested/effective cutoff, per-step status, access evidence and timestamp, final-work IDs, settlement reference and transfer-proof reference. Store a new participation episode on reinstatement; retain all earlier episodes.

Operational stop-work scope and contractual payment entitlement are separate. Review recorded notice obligations before choosing the effective date. Default to an explicit prospective cutoff at successful notice delivery, not a backdated click time. Honor any evidenced later date or approved work commitment. If delivery fails, record the failure and alert staff; do not claim the creator was told or impose an unseen retroactive cutoff. An urgent security restriction can happen immediately with a separately recorded reason, but does not resolve notice or settlement.

For unknown terms, such as Koble's current record, record `terms_unverified`. The notice stops future assignments; the settlement stays under review. Do not invent a default CPM, impose a new deal retroactively, or turn a missing signature into zero earned compensation.

## Discord access policy

| Resource | Offboarded creator |
| --- | --- |
| Their existing private channel | View, read history, send messages, attach evidence, embed links |
| Other creators' channels, including other offboarded creators | Hidden |
| Scripts, inspiration, assets, guides, announcements, community, legacy submissions | Hidden |
| Voice/stage channels and associated threads | No access; disconnect an existing voice session during restriction |
| Staff/admin channels | Hidden |
| Creator's own historical statement/payment support | Available in their private channel; any portal access limited to historical records |
| New assignments, draft approvals and posting submissions | Disabled; historical evidence intake remains available |

Implementation requirements:

- Create a zero-global-permission Offboarded role, unmentionable and not hoisted. Reuse the existing inactive category only after auditing its current occupants; do not bulk-offboard members just because their channel is there.
- Remove all roles that confer program access: Legacy, Scripts, Non-Talking Scripts, Inspiration Alerts, Creator Hub Access, Active Creator, Onboarding, Newcomer, At Risk, New Deal, and historical/custom roles where effective permissions grant access. Resolve IDs from live resources and audit; do not rely only on role names. Preserve harmless cosmetic roles only if verified harmless.
- Preserve cohort/deal history in the database even when removing the Legacy role. Neither role removal nor category movement changes financial terms.
- Deny Offboarded view/connect on non-private program categories and channels, including unsynced children. Keep a direct member allow only on their own private channel. Never grant the Offboarded role access to all private channels in its category.
- Remove stale direct member allows elsewhere. Audit all retained roles and member overwrites, including threads, forum/media parents and voice/stage channels. A deny role alone is insufficient: another role's channel allow wins over a role deny. Administrator and guild ownership bypass channel overwrites. Stop the ordinary creator flow if the target has staff/admin/owner authority or unmanageable access; report the exact blocker instead of claiming isolation.
- Verify actual effective permissions after changes. The allowed visible channel set is exactly their private support channel (plus its category container). Keep enough bot permissions to enumerate/audit the complete channel set. Permission changes by other services and newly created channels trigger reconciliation; unknown/incomplete coverage cannot be called verified.
- Make offboarding authoritative in all role reconcilers, guild-member handlers, resource setup, script distribution, reminders and self-service actions. Move this check before the current legacy early return. Restart, replayed role events, rejoining the server, stale buttons or delayed signing callbacks must not restore program access.
- Retain private-channel support in `ops/discord-support`: historical payment questions stay available while ideation/new-work workflows are closed. Audit bot commands as well as visible channels.
- Discord restrictions cannot recall downloaded files, revoke public links, block personal DMs or prevent posting on TikTok. Handle individually granted Drive/Notion access, creator app entitlements and portal scopes in a separate checklist; preserve historical payment access. Do not rotate shared credentials or delete creators' social accounts as routine offboarding.

Permission basis: [Discord permission hierarchy and overwrites](https://docs.discord.com/developers/topics/permissions#permission-overwrites), [thread inheritance](https://docs.discord.com/developers/topics/permissions#inherited-permissions-threads), and [category syncing](https://docs.discord.com/developers/topics/permissions#permission-syncing). Verified September 29, 2026.

## Final work and payment

- Snapshot known posts and approved unfinished assignments at cutoff, with platform/native IDs, URLs, publication timestamps and source freshness. Accept a late-submitted link proving a pre-cutoff post without reactivating the creator. Review scheduled or in-flight approved content explicitly.
- Continue measurement on existing payable work until its actual contractual windows mature (seven days where that is the evidenced deal). Stop future creative assignments immediately as scheduled, but do not stop tracking existing work prematurely or erase tracker history. Missing/stale metrics remain unknown.
- Preserve existing rates, caps, fixed fees, bonuses, paid-traffic treatment and agreed usage rights. Separate amount owed, invoice coverage, payment instruction and confirmed external transfer. Reconcile prior payments to avoid duplicates.
- Record the final-pay review owner and a concrete next-update date. If views or terms remain unresolved, send that status and a new update date; no guaranteed payment date without evidence.
- Inventory live ads/Spark authorizations and content usage rights separately. Offboarding alone does not prove rights expire or continue. Follow evidenced agreements and record the owner/action for each unresolved right. Do not automatically request deletion of existing posts or revoke permissions needed to honor an existing agreement.
- Preserve contract/signature evidence, channel history, submissions, invoices, and raw tracking evidence under the existing retention policy. Case closure is not deletion authorization.

## Creator-facing copy

Template for a normal future-work stop; staff must review the dates, explanation and approved-work exceptions before sending:

> Hi @Name — we're ending your current GoTall creator participation effective [date, time and timezone]. [Brief respectful reason.]
>
> Please stop making or posting new GoTall content from that time, including anything scheduled. If you already have approved work in progress, reply here so we can confirm how to handle it.
>
> This private channel will stay open for your final payment and any questions. We're reviewing your existing posts and any outstanding payment under your agreed terms, and we'll update you by [date]. If you have a missing post link or a copy of your agreed terms, please send it here.
>
> You don't need to delete existing posts as part of this notice. [Open your status card]

If terms are unverified, replace "under your agreed terms" with "including confirming the terms that apply to that work." Do not claim access is removed in this initial notice. After verified restriction, update the status card to "Offboarded · Private support channel available" and show the actual final-payment state. Human-facing wording should avoid implementation details.

Queue the notification with a stable event ID and `allowed_mentions.users` containing only the creator. Deliver after status-card synchronization; recover uncertain sends by nonce/message lookup rather than duplicate mentions. Send one private staff-review notification mentioning the Manager role when a decision is required. Separate internal reason text from the public explanation.

## Reliability, reversibility and reinstatement

- Commit state and a durable outbox/job in one local transaction. Discord changes are a resumable sequence, not an atomic transaction. Retry each step idempotently and retain errors without secrets.
- At confirmation, stop automation targeting the creator and suppress queued stale assignments/reminders. A delayed callback may be retained as evidence but cannot reactivate participation. Continue historical tracking and payment jobs.
- Ensure their private channel remains accessible before removing program roles. Persist the notification's returned ID, apply role/channel changes, then verify. Retrying must not duplicate notices, channel creation or settlement instructions.
- Surface partial results: "Notice delivered; permissions incomplete" or "Access restricted; notification failed" with an owner and next step. Alert staff on failure and on meaningful changes, not on every unchanged scheduler tick.
- An accidental offboarding can be canceled before notice delivery. After delivery or restriction, use an audited reinstatement with a correction notice and a newly reviewed permission plan; do not silently resurrect all historical grants.
- Reinstatement confirms accounts, applicable terms and posting start date, then restores only currently approved access. Keep unresolved old settlement separate. If the creator leaves and rejoins, restore the Offboarded restriction until reinstated. No automatic reinstatement from a new post or sign-in.

## Implementation and acceptance

Add a dedicated offboarding module rather than trying to repurpose the current test-only inactivity transition. Integrate it with `admin.mjs`, `workspace.mjs`, `flow.mjs`, `messages.mjs`, `scripts.mjs`, `bot.mjs`, resource guidance, support and the tracker/payment bridges. Update the stale admin guide and README to describe verified behavior. Keep legacy `web/` and creator-platform deployments separate.

Minimum behavior checks before production rollout:

1. New and legacy creators both retain exactly their own private channel and historical-payment support after offboarding.
2. Legacy + Scripts + Non-Talking Scripts, a stray member allow, an unsynced channel and a retained conflicting role cannot leak access. Staff/owner/role-hierarchy blockers are visible.
3. Existing voice membership is disconnected; thread/forum access outside the private channel is absent; other offboarded creators cannot see each other's channels.
4. Repeated commands, restart, delayed callbacks, rejoin and queued reminders neither duplicate notice nor restore access.
5. Notice-send failure, unknown send result, role-update failure, rate limits and channel-sync failure produce recoverable partial states rather than false completion.
6. Post-stop draft/post actions are blocked while late evidence of pre-cutoff work is accepted. Existing metric windows and historical records survive.
7. Unknown terms, disputed invoices, pending metrics and missing transfer evidence cannot become zero owed or paid automatically.
8. Reinstatement restores only the reviewed access and preserves prior terms, case events and payment history.

Roll out first using controlled test members with realistic legacy and new-cohort roles; inspect both their own channel and other creators' channels. Verify production configuration and repeat effective-permission readback after restart. Run the bot's relevant tests and documented deployment checks, reporting any unrelated failures honestly. No bulk reclassification and no creator messages are authorized by this design task alone.
