> Current deployment: this feature now runs inside GoTall - Management on XPS. See [MANAGEMENT-DEPLOYMENT.md](MANAGEMENT-DEPLOYMENT.md). Railway and the separate bot are retired. The Railway instructions below are historical.

# GoTall Inspiration Bot

Imported from `/home/ark296/projects/archive/gotall-discord-bot` on 2026-09-14.
This is separate from the test-only onboarding bot. It preserves the existing
`predict`, `bestcreators`, and `bestvideos` commands and the Viral.app 100,000-view
milestone feed. Dependencies and lockfile were preserved from the source.

## Notifications

Create a dedicated `Inspiration Alerts` role with zero permissions and no initial
members. Set `INSPIRATION_ROLE_ID` to its ID. The bot requires Manage Roles and
must sit above this role. Make this permissionless role mentionable, while denying the bot Mention Everyone in the channel. It must be able to read/send/embed in the inspiration
channel and mention the configured role. No creator receives this role by default.

The bot posts Notify me / Turn off alerts controls in the inspiration channel.
Buttons affect only the clicking member and reply privately. Announcements allow
only the configured role mention; everyone, here and user mentions are disabled.
The former VIDEO_MILESTONE_MENTION_EVERYONE setting has no effect.

## Verification

Run `npm ci`, `npm test -- --runInBand`, and `npm run build` in this directory.
Secrets must remain in the hosting credential store, never this repository.
Existing DISCORD_TOKEN, DISCORD_CLIENT_ID, OPENAI_API_KEY and VIRAL_API_KEY
configuration is still used. Preserve the existing milestone threshold, polling
interval, channel, and persistent state path when deploying.

## Cutover Gate

Do not start a second production process while the archived deployment is live.
The legacy VPS container was verified stopped on 2026-09-14. Railway is the
documented primary host, service vivacious-integrity; authenticate and verify its
current deployment before changing it. The CLI was unauthenticated during prep.

1. Snapshot the existing deployment configuration and milestone state volume.
2. Create the permissionless opt-in role; configure INSPIRATION_ROLE_ID and guild.
3. Deploy this directory as the replacement service source, retaining the volume
   at /app/data and VIDEO_MILESTONE_STATE_FILE_PATH. Disable the old source's
   auto-deploy linkage. Do not run the archived VPS fallback.
4. Verify subscriptions, announcement payloads, preserved commands and no duplicate
   runtime. Preserve state so old milestones do not get re-announced. Fresh state
   intentionally seeds existing eligible videos without announcing them.
5. Pin the subscription controls using a staff account. Confirm opt-in and opt-out
   readback before considering migration complete.

This import does not authorize production onboarding or legacy-creator changes.
