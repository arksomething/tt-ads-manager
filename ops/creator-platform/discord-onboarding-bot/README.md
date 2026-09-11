# Retconned server onboarding bot

Standalone Discord Gateway/REST + SQLite runtime, restricted to test guild
`1245112089647775877`. Production creator-server writes are disabled.

Blazie's ten messages and Jotform agreement are integrated. See
[MESSAGE-SOURCES.md](MESSAGE-SOURCES.md) for source links, copy adaptations,
placeholder guides, compensation assumptions and remaining content work.

## Creator flow

Use **Complete onboarding** in `start-here`, then continue in the private channel:

1. Save account links and timezone; send accounts for review.
2. Staff verify accounts; creator completes warm-up; staff approve warm-up.
3. Staff send the Jotform agreement; creator confirms signing; staff verify the
   actual submission and record a reference. Test signature simulation is separate.
4. Creator submits a first-video draft. Staff request revisions or approve it.
5. Staff open Creator Hub, granting access and starting the seven-day trial.
6. Submit published posts for tracking; staff review the trial after seven days.

The scripts, winning-formats and assets channels are read-only to active creators;
the creator-community channel is writable. All are gated by Active Creator or
staff access. Actual resource content still needs to be supplied. Each creator
also keeps a separate private channel as their lifecycle category changes.

Use the status card's **Staff controls** for new review steps. `/creator help`
explains cross-channel staff commands. Chat text such as DONE does not advance
stages: use the buttons to record completion. Coach feedback and concept discussion
happen in the private channel. Signing verification is manual, not a Jotform webhook.

Three missed local posting days trigger At Risk; four full days later the test
record becomes removal-due. Pending/approved time off pauses checks. The bot does
not kick users or make payments. Bonus estimates do not include the conditional
monthly base and do not finalize bonus stacking or cross-platform counting.

## Verify and install

From the repository root, using Node 24:

```sh
node --test ops/creator-platform/discord-onboarding-bot/workspace.test.mjs ops/creator-platform/discord-onboarding-bot/media.test.mjs
npm run creator:verify
node ops/creator-platform/discord-onboarding-bot/install.mjs
```

The installer updates only the existing test service and copies all runtime
modules. It reuses the encrypted Management bot credential and preserves SQLite.

September 10 validation: all 27 standalone bot/media tests passed. The broader creator
suite passed 549 tests with six existing SignWell failures; its chained lint,
typecheck and build did not run. Test service deployed and Gateway READY verified.
Discord API readback verified the live welcome button and four gated Hub channels.
A live Discord walkthrough exercised the creator and staff flow using the owner account in the test server, including draft revisions, Hub access, post submission and leave. Separate nonstaff-account UI permissions were not exercised. The subsequent upload, share-link and response-visibility changes have automated coverage; their new upload UI has not been exercised interactively.


## Draft uploads, share links and channel visibility

Submit first video accepts either an accessible HTTPS draft link or one MP4, MOV, WebM or M4V file, up to 25 MB and the Discord upload limit. The bot copies uploads into the private creator channel and stores a durable message link for staff review, rather than an expiring attachment URL. Bigger drafts should use a link. Resubmissions use the same form.

Published posts accept full TikTok, Instagram and YouTube URLs, TikTok vm/vt share links, and copied TikTok share text containing one URL. Redirects are limited to approved TikTok hosts and normalized to the original video ID for duplicate protection. If TikTok refuses resolution, the creator is asked for the full video URL. A draft file alone does not prove publication.

Creator actions and receipts are visible to everyone who can access the channel. Staff controls, commands, private notes and review responses remain ephemeral. Applications publish only a receipt and channel pointer, not the submitted personal details.
