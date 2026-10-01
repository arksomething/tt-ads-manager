# Production Discord cutover - September 14, 2026

Production guild: `1400610531189985310`. Owner authorized the cutover in this task.
The existing single onboarding/scripts runtime now serves production, with
`DISCORD_TEST_MODE=false` and explicit production enablement. Its historical
systemd name and installation directory still contain `onboarding-test`; they
are not evidence that the active runtime targets the test guild.

## Preserved

- All 60 original channels remain. All 34 creator channels keep their categories
  and original member access; Manager/Admin access is explicit.
- 36 current creator members receive Legacy, never New Deal. The durable legacy
  roster also blocks former channel participants from entering new-rate onboarding.
- 32 single-owner channels have creator directory cards. The two multi-owner
  channels remain intact without a guessed primary account. Judy was notified
  in onboarding-reviews about these and uncertain script eligibility.
- Original creator terms were not changed. 13 single-account verified identities
  have their existing terms imported for My deal. No test agreements, trial dates,
  payment profiles or simulated earnings were copied to production.
- General and opt-in inspiration remain. The inspiration feed preserved its cursor
  and emitted no duplicate announcements at startup. The old Railway bot remains off.

## Access

Creator Hub and compiled guides replace the old resource area. Eleven original
resource channels are archived with their messages intact. Ordinary creators and
Managers cannot see the archive; Discord Administrators and the server owner
necessarily bypass channel denies. Bot access is preserved.

Guides/tutorials are read-only for creators, writable by Managers/Admins. Scripts
requires Scripts; only staff can publish. Legacy submissions/account-link channels
are Legacy + staff only. New Deal is granted to new creators after first publication
and remains after trial. Legacy channels do not enter new-deal approval/lifecycle
automation. Founder remains visual identity; founders received Admin where needed.
Manager is the operational ping role. Admin-only commands has its own channel.

The old `gotall-creator-discord-worker.service` is disabled to prevent competing
role/reminder writes. The support agent remains a separate message-handling gateway;
it does not run the onboarding state machine. Its production channel configuration
now references the new resource channels. The Jotform webhook listener is live.

## Evidence and rollback

Protected checkpoint: `/var/lib/gotall-discord-cutover-20260914/`.
Contains `before.json` (guild/roles/channels/member roles/commands), `roster.json`,
`runtime-before/`, `test-before.sqlite3`, prior deal allowlist/support config,
prepared production SQLite, `applied.json`, `installed.json`, `verified.json`.
Do not put these private files in Git. Original archived messages were not deleted.
Permission verification: support state `production-cutover-verification.json`.

Rollback must first stop the onboarding service and its four bridge timers/services.
Back up the CURRENT production SQLite so new submissions are retained. Restore the
test SQLite, runtime-before, original `/etc/gotall-discord-deal-bindings.json` and
support configuration from the checkpoint. Remove only the production.conf drop-in.
Restore original channel names/categories/overwrites and migration-changed member
roles from before.json; hide newly created channels rather than deleting history.
Restore original guild commands. Only then restart the old runtime, support service,
bridge timers and (if returning to the prior arrangement) the old role worker.
Do not run the old and new role workers concurrently or discard post-cutover records.

## Verification

114 standalone Discord tests, 7 creator-platform Discord tests, 8 tracker tests and
86 support tests passed during cutover (an additional production callback test was
added afterward). Live REST verified all creator access, legacy isolation, three
native app videos, preserved general and clean command registration. Both gateways
reported ready. No interactive real-newcomer signing flow was fabricated.

The wider creator-platform web verification still fails its six pre-existing
SignWell tests; that web application was not deployed. The Discord flow uses Jotform.
