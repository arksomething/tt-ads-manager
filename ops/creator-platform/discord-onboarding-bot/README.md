# GoTall Discord onboarding bot

Production cutover completed September 14: guild `1400610531189985310`.
See [CUTOVER.md](CUTOVER.md) for live state, permissions, verification and rollback.
The historical service/directory name contains `onboarding-test`; its production
drop-in selects real mode and a fresh imported legacy roster. Older test-only
notes below are historical and do not override the cutover record.

Blazie's ten messages and Jotform agreement are integrated. See
[MESSAGE-SOURCES.md](MESSAGE-SOURCES.md) for source links, copy adaptations,
guide sources, compensation assumptions and remaining content work.

## Creator flow

Use **Complete onboarding** in `start-here`, then continue in the private channel:

1. Save account links and timezone; send accounts for review.
2. Staff verify accounts; creator completes warm-up; staff approve warm-up.
3. The bot sends a uniquely linked Jotform agreement and detects completed
   submissions through the API. A complete linked signature automatically opens
   first-video preparation and notifies the creator and the Manager role.
4. Creator submits a first-video draft. Staff request revisions or approve it.
5. Creator publishes the approved video and clicks First video posted. The bot
   records the confirmation time, starts the seven-day trial and grants Scripts
   and New Deal. Hub resources open during first-video preparation, not trial start.
6. Submit future assigned drafts for approval; published links are not required.
   Judy receives the preliminary trial report 24 hours before the deadline.

The compiled guides, app access, formats and assets are published and pinned in
the test server; see [RESOURCE-GUIDANCE.md](RESOURCE-GUIDANCE.md). Resources are
read-only for creators, including threads; community chat remains writable.
Scripts uses the Scripts role. Legacy submission channels are writable only to
Legacy and staff. Each creator keeps a separate private channel as their
lifecycle category changes. No production resource migration has run.

Use the status card's **Staff controls** for new review steps. `/creator help`
explains cross-channel staff commands. Chat text such as DONE does not advance
stages: use the buttons to record completion. Coach feedback and concept discussion
happen in the private channel. Jotform receipts are checked immediately after a webhook, with five-minute
polling as a fallback. The agreement card has no signing-confirmation button. There is no manual
signature approval gate for linked Jotform submissions. Custom or old unlinked
agreements require staff help. See [JOTFORM.md](JOTFORM.md) for setup and limits.

Three missed local posting days trigger At Risk; four full days later the test
record becomes removal-due. Pending/approved time off pauses checks. Inactivity alone does not enroll a creator for offboarding. The staff-confirmed
[offboarding workflow](OFFBOARDING.md) restricts access immediately and removes members
only after final settlement and the approved report/reply grace periods. The bot does not make payments. Bonus estimates do not include the conditional
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

Guide links now use the supplied Account Creation, Warming Up and GoTall Content Formats Notion pages. Payment setup prefers US bank transfers (US/USD only), supports PayPal email, and routes international bank details through Wise. Country-specific receiving requirements are confirmed privately by managers.

First published-video submission now moves approved creators from Hub Ready or
trial to Active Creator and synchronizes their role and channel category. The historical inactivity transition logic exists, but the current scheduler skips
active/trial/At Risk and legacy records; it is not a production offboarding process.
Use the explicit [offboarding workflow](OFFBOARDING.md).
