# Retconned server onboarding bot

This is the isolated test-server runtime for the GoTall Management application.
It uses Discord guild commands and stores test application data in a private
SQLite database owned by the existing `gotall-discord` system account.

The runtime creates these category divisions while keeping every creator in an
individual private text channel:

- `New / Onboarding`
- `Active Creators`
- `Inactive / At Risk`
- `Not Active Creators`

Run `/apply` in `start-here` to exercise the five-question modal and channel
creation. Staff can then test `/progress`, `/agreement`, `/test-reminder`,
`/video-check`, `/simulate-inactive`, `/posted`, and `/exception`. `/invite`
creates a one-use server invitation. `/reset-creator` clears a test record.

`DISCORD_TEST_MODE=true` prevents the four-day inactivity path from kicking a
member. It moves the channel into the not-active category and reports the exact
production action that would have occurred.

Install or update the pinned system service from the repository root:

```bash
node ops/creator-platform/discord-onboarding-bot/install.mjs
```

The installer reuses the existing encrypted Management bot credential. It does
not print, copy into the repository, or create another plaintext token.
