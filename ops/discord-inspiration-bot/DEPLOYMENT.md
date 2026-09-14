# Railway cutover — 2026-09-14

Production inspiration bot migrated from archived gotall-discord-bot into this directory.

- Railway project: vivacious-integrity (`b32f734a-c122-46a8-b1d1-4c245eaa0e7a`)
- Service: worker (`f2303719-9cc3-4727-ba55-711926a720b5`), production environment
- Verified active deployment: `cf5bf311-ae23-4bec-b621-08656479d589`
- Old deployment `03c226c9-0a50-47d7-a095-b4d63182f9a6` removed; old source disconnected.
- Persistent volume `a10c6985-7091-402b-bed0-225395512321`, mounted at `/app/data`.
- State path `/app/data/video-milestones.json`, owned by node; 362 historical records restored and verified after restart.
- Guild `1400610531189985310`; inspiration channel `1481528900025847838`.
- Permissionless, mentionable opt-in role `1548936204186030111` (Inspiration Alerts).
- Bot has Manage Roles; explicit member overwrite still denies Mention Everyone. Announcement allowedMentions permits only the opt-in role.
- Pinned controls: https://discord.com/channels/1400610531189985310/1481528900025847838/1548937988485021717
- No creators enrolled automatically. Live subscribe/unsubscribe handler checks used the bot's own membership and restored it to unsubscribed.
- First enabled poll: 186 eligible videos, zero announcements; ten-minute interval and 100,000-view threshold retained.
- predict, bestcreators, bestvideos registered globally and confirmed via Discord API.
- Full 56-test suite/build passed; additional permission regression passed (57 tests total).

Deploy this directory using the existing service; do not create another worker. Secrets remain in Railway. The original XPS archive is retained but its VPS fallback must remain stopped.

Deployment was uploaded from the Windows staging copy at C:/Users/ark29/Dev/gotall-inspiration-railway. No GitHub automatic source is connected; deploy subsequent reviewed changes explicitly.

Operational note: Railway volume file browser upload to `/video-milestones.json` did not make the file visible at the worker mount. The actual restore used service SSH into `/app/data/video-milestones.json`, followed by node ownership and read/write verification. Validate the running container path after future restores.
