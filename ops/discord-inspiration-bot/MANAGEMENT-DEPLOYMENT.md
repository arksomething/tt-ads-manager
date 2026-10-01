# Management integration — 2026-09-14

The inspiration feed and `/predict`, `/bestcreators`, `/bestvideos` now run as
**GoTall - Management** inside the existing XPS management process:
`gotall-discord-onboarding-test.service`. The service name is historical;
onboarding remains restricted to the test guild, while this feature is scoped
to GoTall Creators (`1400610531189985310`).

The feature uses a REST-only discord.js client. It never logs into another
Gateway; `bot.mjs` forwards only the matching production feature interactions.
Unrelated management commands and onboarding restrictions are preserved.
Initialization failures retry without taking management onboarding offline.

- Library source: `ops/discord-inspiration-bot/src/management.ts`
- Loader: `ops/creator-platform/discord-onboarding-bot/inspiration.mjs`
- Runtime config: `inspiration.conf` in that directory, installed as a service drop-in.
- Runtime library: `/usr/local/lib/gotall-discord-onboarding-test/inspiration`
- State: `/var/lib/gotall-discord-onboarding-test/inspiration/video-milestones.json`
- Encrypted credentials: `inspiration-openai-key`, `inspiration-viral-key`; existing management Discord token is reused.
- Chrome uses `/usr/bin/google-chrome` and writable XDG paths in the service state directory.
- Opt-in role preserved: `1548936204186030111`, no permission grants or automatic subscriptions.
- New pinned controls: https://discord.com/channels/1400610531189985310/1481528900025847838/1548940975018352641
- 362 records transferred from the paused Railway worker; first XPS poll found 186 eligible videos and zero new announcements.
- The Railway worker has no active deployment and no GitHub source. Its saved backup/volume is retained for recovery.
- The old GoTall bot (`1433587504908341269`) left both GoTall Creators and Retconned's server. Its historical posts remain; old controls are disabled and point to Management.

Verification: 58 inspiration tests, 103 management tests, TypeScript build;
live Management role add/remove readbacks; native Discord command interaction
construction and real prediction rendering (264261-byte image) under the service
user; production command registration; successful feed startup and Gateway READY.
No synthetic test result was posted to creators.

Deploy with `node ops/creator-platform/discord-onboarding-bot/install.mjs` from
the repository root on XPS. Keep the archive runtime stopped. Do not deploy the
standalone `bot.ts` to Railway again. The installer materializes node_modules
rather than retaining the archive symlink, since ProtectHome blocks that path.
