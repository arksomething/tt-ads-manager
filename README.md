# Billion Views

`Billion Views` currently deploys a minimal branded homepage.

The product direction lives in `PRD.md`. The actual application scaffold lives in `web/` so the repo can keep product docs and inspiration assets at the root.

## OpenClaw TikTok Ads Bot

This repo includes the CLI and skill files that give the OpenClaw bot access to
TikTok Business ads. The goal is to let the Telegram bot inspect campaigns,
diagnose performance, propose changes, and create/update ads through the TikTok
Business API without relying on browser automation.

The installed bot uses:

```text
VPS: ubuntu@187.77.26.142
Docker project: /docker/openclaw-rujh
Container: openclaw-rujh-openclaw-1
CLI: /data/.openclaw/bin/tt-ads
Default org: gotall
Advertiser: Grow Labs LLC1204
```

Connect to the VPS:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142
```

Check the OpenClaw container:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker ps --filter name=openclaw-rujh-openclaw-1'
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker logs --tail 120 openclaw-rujh-openclaw-1'
```

Restart OpenClaw:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo sh -lc "cd /docker/openclaw-rujh && docker compose restart openclaw"'
```

Verify TikTok API access inside OpenClaw:

```bash
ssh -o BatchMode=yes ubuntu@187.77.26.142 'sudo docker exec openclaw-rujh-openclaw-1 /data/.openclaw/bin/tt-ads doctor --org gotall'
```

Install or update the OpenClaw CLI/skill from this repo:

```bash
npm run openclaw:install-tiktok-ads -- \
  --host ubuntu@187.77.26.142 \
  --container openclaw-rujh-openclaw-1 \
  --default-org gotall
```

The TikTok ads flow is API-first. Do not use browser automation for TikTok ads
work. The OpenClaw system prompt and installed skill both route these requests
to `/data/.openclaw/bin/tt-ads`.

Supported bot-side actions include:

- read accounts, advertisers, campaigns, ad groups, ads, and reports
- pause, enable, delete, and update existing campaigns/ad groups/ads
- dry-run campaign creation, ad group creation, creative upload, and ad creation
- execute mutations only after the user confirms the exact dry-run payload

Secrets live in the OpenClaw container at
`/data/.openclaw/credentials/tiktok-ads.env`. Do not print, paste, or commit
credential values.

## Commands

Run these from the repository root:

```bash
npm run dev
npm run lint
npm run typecheck
npm run db:generate
npm run db:push
npm run tt:ads -- help
npm run openclaw:install-tiktok-ads -- --host ubuntu@187.77.26.142 --container openclaw-rujh-openclaw-1 --default-org gotall
```

## What Is Set Up

- Next.js App Router app in `web/`
- TypeScript, ESLint, and Tailwind
- Prisma schema for the MVP data model
- Supabase Auth plumbing for the primary sign-in flow
- Environment variable validation
- Core server modules for organizations, campaigns, creators, videos, notes, dashboard queries, and external data provider integration
- Root-level scripts so the workspace behaves like one project
- OpenClaw TikTok Ads CLI installer and bot skill

## Next Product Steps

- connect a real Postgres database
- finish Supabase Auth environment setup
- confirm the real provider endpoints and map them into sync jobs
- build onboarding, organization selection, and campaign workspace screens
