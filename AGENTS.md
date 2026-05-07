# Agent Notes

This repo should be operated production-first. Do not bog users down with local
environment setup, local-only previews, or "works on my machine" instructions.
When a change is requested, make the repo change, verify it as much as practical,
and ship it to the production target.

## Web Production

The web app is deployed on Vercel. The linked Vercel project metadata is already
checked out locally in `.vercel/` and `web/.vercel/`, with `web` as the Vercel
root directory.

For production web changes:

1. Edit the app in this repo.
2. Run verification from `web/`:

```bash
npm run typecheck
npm run build
```

3. Deploy production from `web/` using the linked Vercel project:

```bash
npx vercel deploy --prod
```

If a prebuilt deploy is more appropriate:

```bash
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

Do not assume Vercel is unavailable just because a global `vercel` binary is not
on `PATH`. Use the local project configuration.

## OpenClaw TikTok Ads Bot

This repo also owns the TikTok Ads CLI installed into the production OpenClaw
VPS bot. The point of that integration is to let the OpenClaw/Telegram assistant
inspect and manage TikTok Business ads through the API, without using the TikTok
web UI or browser automation.

Use the production CLI for TikTok ads work:

```bash
/data/.openclaw/bin/tt-ads <command> --org gotall
```

Do not use browser, browser profiles, Playwright, Chromium, screenshots, or web
UI automation for TikTok ads. Keep repo changes aligned with this API-first
rule.

### Production VPS

OpenClaw is running on the Hostinger VPS:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142
```

Docker project on the VPS:

```bash
/docker/openclaw-rujh
```

OpenClaw container:

```bash
openclaw-rujh-openclaw-1
```

Common production maintenance commands:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker ps --filter name=openclaw-rujh-openclaw-1'
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker logs --tail 120 openclaw-rujh-openclaw-1'
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo sh -lc "cd /docker/openclaw-rujh && docker compose restart openclaw"'
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker exec openclaw-rujh-openclaw-1 /data/.openclaw/bin/tt-ads doctor --org gotall'
```

Installed OpenClaw paths:

```text
/data/.openclaw/bin/tt-ads
/data/.openclaw/credentials/tiktok-ads.env
/data/.openclaw/skills/tiktok-ads/SKILL.md
/data/.openclaw/workspace/AGENTS.md
```

Never print or commit secrets from `/data/.openclaw/credentials/tiktok-ads.env`
or OpenClaw config files.

### Installing Production Updates

After changing the local CLI or skill, install it into the production OpenClaw
container from the repo root:

```bash
npm run openclaw:install-tiktok-ads -- \
  --host ubuntu@187.77.26.142 \
  --container openclaw-rujh-openclaw-1 \
  --default-org gotall
```

Then verify inside the production container:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker exec openclaw-rujh-openclaw-1 /data/.openclaw/bin/tt-ads doctor --org gotall'
```

Mutation commands are dry-run by default. They require both
`TT_ADS_ALLOW_WRITES=1` in the installed credential env and an explicit
`--execute` flag at command time.
