# Test Resource Consolidation

Scope: test guild 1245112089647775877 only. Production remains unchanged.

Source export on 2026-09-14: 2,644 messages across 13 production Details and
Server Info channels, fetched with full pagination by export-resource-guidance.mjs.
Protected raw export: /var/lib/gotall-discord-onboarding-test/resource-audit-2026-09-14/source.json.
Do not commit the raw export: it includes participant communications. Attachments
are references, not downloaded media backups. Threads and private creator-channel
histories are not included. Linked tutorials and example videos are not a claim
of independently verified or watched media.

## Source Decisions

- Screenshot: production video-requirements message 1481516338546606246 says
  full-screen, within 10 seconds, at least 3 seconds. Owner confirmed 3 seconds;
  this supersedes FAQ message 1481520239312375818's 1.5 seconds.
- Bio/caption: 1486970998757527563 supersedes the March 14 alternatives.
  Canonical spelling comes from video-requirements/how-it-works, not the
  malformed Discord role mention in the announcement.
- Talking-only #yap: 1533689256889946273. Do not put CPM claims in shared copy.
- No manual invoices: 1522213991743623230 supersedes invoice tutorials and the
  old how-it-works guide. Payment timing/windows/rates are individual-deal and
  payment-record questions, not universal promises in the shared guide.
- Poll: 1519620429806043199; preserve question/options/indefinite duration.
  If unavailable, ask Judy. No bot validation or new eligibility gate added.
- Advertising authorization: messages 1545073576091193374 and announcement
  1545076314350952448. Keep as manual private-channel instructions, not a new
  onboarding gate; no potentially stale QR copied into permanent guidance.
- Assets: the original screenshot folder from 1481516338546606246 and app
  recording from 1547512867912290304 were copied into the owner-controlled
  `GoTall Creator Assets` Drive folder and the managed assets card was cut over
  on 2026-09-16. Current iOS/Android links come from app-access history.
- Formats: examples from 1528427301170053260, 1493022494825906346 and
  1547512867912290304. Historical examples are not fresh assignments.
- Support: owner decision supersedes DM/WhatsApp advice. Judy is primary;
  Evan is technical review. No personal phone numbers or old codes republished.

## Deliberate Exclusions

Staged comments from a second account were replaced with genuine viewer replies.
Unsupported growth/medical claims and invented first-person results from old
scripts were not republished. Factory resets and paid residential proxies are
not default setup instructions. Historical bans and exclusive-format directions
need staff confirmation rather than silently becoming permanent requirements.
These exclusions are visible in the staff-only resource-audit card.

## Layout and Permissions

Server Info: welcome, announcements. Details: creator-guide, posting-checklist,
FAQ. Creator Hub: get-the-app, assets, winning-formats, scripts, creator-community.
Legacy Details: legacy-guide, submit-your-video, drop-your-tiktok.
Resource Review: staff-only audit. Resource Archive: bot/admin-only retired
test script-library. No production channel or source message is deleted/moved.

Guides/resources deny sending, thread creation/replies, polls and external-app
messages to creators. Manager/Founder can edit/publish. Community and legacy
submission channels remain writable to their authorized cohorts. Scripts retain
their existing Scripts-role permission and announcement trigger. Legacy role
is created without automatically assigning anyone or changing creator deals.

resource-guidance.mjs runs during test setup and updates/pins managed messages.
It stores message IDs, reuses existing cards and has a production guard. The old
script-library resource aliases the real scripts channel after its history is
hidden; first-video preparation links winning-formats instead of that archive.
Run node --test ops/creator-platform/discord-onboarding-bot/*.test.mjs.

## Native App-Access Tutorials

Get-the-app now links to pinned Discord messages containing short numbered
instructions and native MP4 attachments. Only installation links leave Discord.
iPhone source: Slack self-DM F0C1NG1BYL9 (2026-09-14 recording); account email
masked. Android unlock source: F0C1EB5FCMR; notification panel trimmed. Android
install source: the existing creator-platform Android guide recording. Videos
are silent, H.264 MP4 and kept in assets/app-access as independent source copies.
Older Android UI is labeled as such; never confirm without the platform's
explicit test/no-charge notice. iPhone instructions match the current recording.

app-access-guidance.mjs saves message IDs and content hashes, preserves existing
attachments on text edits and uploads changed/missing media to the same message.
Links use Discord channel/message IDs, not expiring signed CDN URLs. The Discord
client refreshes signed attachment URLs; uploads are not a sole archival backup.
