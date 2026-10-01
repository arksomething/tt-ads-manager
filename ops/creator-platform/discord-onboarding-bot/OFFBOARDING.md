# Creator offboarding

Implemented September 29, 2026 for the production GoTall Discord. Deploying this workflow does not select or offboard any creator. Existing inactive-category members are not enrolled automatically.

## Start a case

A Manager or Admin runs:

```
/creator offboard creator:@creator reason:Clear creator-facing explanation payout-date:YYYY-MM-DD
```

The date is an internal minimum-retention date, interpreted through the end of that UTC date. For the user-approved month-start payout window, use the first of the next month (October 1 for September offboarding). Creator-facing wording says payout is expected around the start of that month, not guaranteed on a specific day. Actual settlement and report/reply grace periods still gate removal. Review the named creator, private channel, exact explanation and payment policy, then click **Offboard creator** within 15 minutes. Confirmation belongs to the staff member who requested it; changes to the creator record or roles invalidate the preview.

The bot saves the case and previous roles/overwrites, stops program access and script delivery, invalidates pending onboarding forms and program notifications, and restricts the creator to their existing private text channel plus read-only Announcements. It assigns the zero-permission **Offboarded** role and moves their channel into **Offboarded Creators**. Each creator has their own channel. Existing inactive channels are untouched until individually selected.

A durable, restricted-mention notice asks them to stop new GoTall creation and posting, identify approved/scheduled work, and keep existing posts. It links their current status. The stop-work cutoff is notice delivery, not the earlier staff click. Delivery is recorded by Discord message ID; it does not prove the notice was read.

The bot removes non-managed roles, removes outside member grants, applies deny overwrites on channels (including unsynced children), closes any remaining managed-role access with member denies, disconnects voice and reads permissions back. Verification requires that the only two visible non-category channels are the creator's own channel (history, messages, attachments and embedded links enabled) and the configured Announcements channel (view/history enabled, posting and thread actions denied). Announcements uses a direct member overwrite so retained managed roles cannot restore posting permissions. Missing or invalid Announcements configuration blocks the action before membership changes. Bots, owner/admin/staff accounts and unmanageable role hierarchies are rejected. The bot uses its existing Administrator permission for a complete audit; it does not grant itself that permission.

New assignments and onboarding buttons are blocked. Payment/deal/post-history views, payment details and reported-issue support remain available. Legacy cohort and financial records are preserved. Missing historical post links can be supplied in the private conversation for staff to reconcile. The historical trial-end shortcut is disabled in favor of this process.

## Final report and settlement

1. Review all earned work, applicable terms, pending approved work, maturing metrics, bonuses, prior payments and disputes. Unknown terms do not imply zero owed. Continue tracking existing posts as required by the evidenced agreement.
2. Deliver the **final** payment report into the private channel. A draft estimate does not qualify. Staff must explicitly register the delivered message:

   ```
   /creator offboarding report creator:@creator message:https://discord.com/channels/GUILD/CHANNEL/MESSAGE
   ```

   The bot verifies channel, author, content and delivery after the stop-work notice. The message must come from human staff or the GoTall Management bot. The report itself never counts as a human answer to an outstanding question. A corrected or replacement report grants a fresh 14 days and resets settlement to unverified.
3. After actual payment evidence has been reviewed, record:

   ```
   /creator offboarding settlement creator:@creator state:paid evidence:Transfer reference and review evidence
   ```

   For a reviewed final statement with no outstanding balance, choose `no_balance` and record the review evidence. Choose `unverified` to revoke an earlier settlement finding. These are attributable staff attestations, not automatic bank verification; this bot does not execute a transfer. A report, invoice or payment instruction alone is not proof of payment.

The internal retention date and report/settlement commands are deliberate staff inputs. The bot does not infer a final payout from a generic PDF, a payment link or a calendar date. This keeps estimated or incomplete calculations from accidentally starting removal.

## Automatic removal

The user-approved rule is:

```
earliest removal = max(
  internal minimum-retention date,
  final report delivery + 14 days,
  latest human staff reply + 7 days
)
```

Removal also requires verified restrictions, delivered stop-work notice, an unchanged final report, recorded paid/no-balance settlement, no manual hold, no unresolved reported Hub issue, and no unanswered creator message.

Every human creator message pauses removal until a human Manager/Admin replies. Automated responses, webhook messages and the final report do not clear that pause. A reply explicitly addressed to an older creator message does not clear a newer message. Any later human reply after a creator message refreshes the seven-day period. The later deadline always wins; replies never shorten the original 14 days.

**A reply is not proof a dispute is resolved.** Staff must place a hold when a dispute or another unresolved matter is raised, including matters received through DMs or other systems:

```
/creator offboarding hold creator:@creator reason:Outstanding payment dispute
/creator offboarding release creator:@creator reason:Resolution and supporting evidence
```

Unresolved issues filed through the private channel's Payments/Posts issue flow also block removal automatically. A release only clears the manual hold; it cannot bypass unanswered messages, open reported issues or settlement checks. Free-form conversations and external support systems are not semantically classified as disputes; staff owns recording these holds.

The scheduler checks roughly every minute. It reconciles paginated message history after downtime, rechecks the final report and human reply, then checks current history again immediately before a due removal. Incomplete history, missing/deleted evidence, permission failures and API errors block removal and alert Managers. A verified member removal is logged; Managers receive a completion notification. The creator is kicked, not banned. The channel and all records are retained for staff.

If the creator leaves voluntarily, the case records `departed`. If they rejoin, the bot restores restrictions and adds a review hold rather than granting onboarding/program access or immediately kicking them again.

## Operate and recover

```
/creator offboarding status creator:@creator
/creator offboarding retry creator:@creator
/creator offboarding payout-date creator:@creator date:YYYY-MM-DD
```

Status shows the current payment/report/removal state and access errors. Retry resumes permission/status work without restarting the timer or duplicating the notice. A case with no final report or unresolved settlement remains open indefinitely. There is no manual force-kick override in this workflow.

Records live in the existing SQLite database: `creators.offboarding_id`, `offboarding_previews`, `offboarding_cases`, `offboarding_events`, and the durable `deliveries` queue. Cases survive restarts. Restriction synchronization precedes legacy role reconciliation. Signing callbacks, stale buttons, queued notices and rejoining must not restore program access. A new participation episode/reinstatement workflow is not implemented; arrange any return with the technical owner rather than editing roles alone.

## Boundaries

This enforces Discord membership and channel access. It cannot recall downloaded files, block personal DMs, revoke public links, prevent social posting, or automatically revoke separately granted Drive/Notion/app/ad-account access. Review those grants, scheduled work, live ads and contractual content-usage obligations separately. The support bot is not a human reply and cannot satisfy the removal timer.

Do not delete creator accounts, posts, agreements, invoices, payment records or tracking history. Do not offboard a real creator to test deployment. Tests use simulated Discord membership and real in-memory SQLite; production verification checks deployment, commands and resources without enrolling anyone.

## Deployment verification — September 29, 2026

- Normal bot installer completed. The first production scheduler cycle completed (cycle timestamp `2026-09-29T05:54:14.326Z`), with no pending deliveries. Production service active, Gateway READY in guild `1400610531189985310`, no restart loop. Installed bot/workspace/admin/scripts/offboarding module hashes match the reviewed source.
- Discord API readback confirms `/creator offboard` and all seven `/creator offboarding` controls. Offboarded role `1554370689023221801` has zero global permissions and is neither hoisted nor mentionable; category `1554370690516263053` denies everyone and allows staff/bot.
- SQLite migrations present. Zero offboarding cases and zero enrolled creators after deployment; all 39 creator identities, channel IDs and stages matched the backup. No live creator was kicked to test this feature.
- All 141 bot tests passed, including 20 offboarding tests. The required broader `npm run creator:verify` finished with 574 passing tests and six existing failures across two SignWell test files; its chained lint/typecheck/build did not run. No creator-platform web deployment was involved.
- The existing inspiration milestone poll still reports Viral API Unauthorized; the same error was present before deployment. It does not drive offboarding or its payment/removal state.
- Private runtime and consistent SQLite backup: `/var/backups/gotall-offboarding-20260929T055344Z`.

September 29 follow-up: user requested month-start payout wording and continued Announcements visibility. The source and tests now enforce exactly the private support channel plus read-only Announcements. Permission semantics were checked against [Discord documentation](https://docs.discord.com/developers/topics/permissions). No creator action is authorized until the requested message preview is finalized.

Follow-up verification: all 143 bot tests passed (22 offboarding tests). The broader creator-platform suite again finished with 574 passing and the same six SignWell failures. Normal production bot installation completed; installed offboarding code matches source. A read-only simulation against current roles/channels for Koble, Snow, Kevin, Isma and Drago produced exactly their own private channel plus read-only Announcements, with no Discord mutations. Offboarding cases remain zero. Backup: `/var/backups/gotall-offboarding-announcements-20260929T115626Z`.

## Approved execution — October 1, 2026

The owner approved offboarding Koble, Snow, Kevin, Isma and Drago, closing out departed creators Mason and Verticle, keeping Seraphim, and banning the heightmaster test account with message history retained. Each delivered notice states that the participation decision is final. Koble has confirmed posted work and was told his payment report is coming in the next few days; the other notices apply that timing conditionally to any posted work and request missing links. Settlement remains unverified until evidence is recorded. See [execution receipt](../../discord-admin-audits/offboarding-2026-10-01.json).

Production verification identified startup resource setup replacing the Announcements member overwrites before the periodic reconciler restored them. Startup now applies the authoritative offboarding overwrites in the same channel update, preserving read-only Announcements and denying other access without that gap. The regression test replaces complete channel overwrite arrays and checks both retained announcement reading and denied member/managed-role posting. All 144 bot tests pass.
