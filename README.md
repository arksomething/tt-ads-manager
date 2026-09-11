# tt-ads-manager

Monorepo for GoTall's creator marketing operations. It holds two deployable
web apps, the host-side operations scripts that run around them, and one-off
analysis tooling. Nothing here is a single product; read the map below before
touching anything.

## What is in here

| Path | What it is | Status |
| --- | --- | --- |
| `web/` | Legacy Next.js app: TikTok Business reporting, ad profitability, UGC Pay and payout engine. Vercel project `tt-ads-manager` with root directory `web`. | Live, actively maintained |
| `creator-platform/` | Creator-first Next.js app that is planned to supersede `web/`. Own Vercel project `gotall-creator-platform`, own Supabase migrations under `creator-platform/supabase/`. | Live, actively built, not yet cut over |
| `ops/creator-platform/` | Discord worker, Discord onboarding bot, Cloudflare callback proxy, auth email templates, systemd units and credential catalog for the creator platform. | Live |
| `ops/creator-tracker/` | Release, install, activation and verification scripts plus systemd units for the creator video tracker collector. The collector's source is deployed to the host, not kept in this repo. | Live |
| `ops/creator-tracker-autopilot/` | Self-healing loop that watches the tracker and repairs it. | Live |
| `ops/creator-tracker-monitor/` | Off-host deadman monitor and alert reporter for the tracker. | Live |
| `tools/payout-audit/` | Local payout audit engine and dated one-off report scripts. Run per payment cycle. | Used monthly |
| `tools/discord-mcp/` | MCP server exposing the GoTall Discord to agents. Wired in `.mcp.json`. | Live |
| `tools/talking-classifier/` | Talking/non-talking video classifier experiments. | Dormant |
| `inspo/creator-platform/` | Design references the creator platform follows. | Reference |

Historical documents kept for context, not current direction:

- `PRD.md` is the original March 2026 product spec and is superseded by
  `CREATOR_FIRST_PLATFORM_VIDEO_TRACKING_PLAN.md`.
- `deal-restructure-2026-07-20.md` records the July 2026 creator deal terms.

Untracked working directories that live next to the code but are ignored by
git: `payouts/`, `output/`, `tmp/`, `reports/`, and the March screenshots in
`inspo/`.

## Commands

Root scripts forward to the two apps. Each app has its own `package.json`,
lockfile, and `node_modules`; install dependencies inside `web/` and
`creator-platform/` separately.

```bash
# legacy app (web/)
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
npm run db:generate-shim        # regenerate web/src/lib/db-schema.generated.ts from web/prisma/schema.prisma

# creator platform (creator-platform/)
npm run creator:dev
npm run creator:test
npm run creator:verify          # lint + typecheck + test + build

# tracker ops
npm run tracker:autopilot:verify
```

Host-dependent verification scripts live under `ops/*/tests/verify.sh` and
assert against installed systemd units, so they only pass on the deployment
host.

## Deploying

Read `AGENTS.md` first. In short: deploy `web/` from the repository root with
`npx vercel deploy --prod`, never from inside `web/`. Deploy the creator
platform only to its own Vercel project from an isolated staging root, and do
not change apex domain aliases without passing the cutover gate in
`ops/creator-platform/README.md`.

There is no CI. Run the verification commands above before deploying.

## Data model

`web/` does not use Prisma at runtime. `web/prisma/schema.prisma` is the model
source that `web/scripts/generate-prisma-shim.mjs` turns into the committed
`web/src/lib/db-schema.generated.ts`. SQL migrations for `web/` are in
`web/sql/`. The creator platform's migrations are in
`creator-platform/supabase/migrations/`.
