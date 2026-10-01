# tt-ads-manager

[![Repository CI](https://github.com/arksomething/tt-ads-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/arksomething/tt-ads-manager/actions/workflows/ci.yml)

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
| `ops/discord-support/` | AI Discord support and operator runtime, policy, sandboxing, replay fixtures and regression tests. | Maintained service |
| `ops/discord-inspiration-bot/` | Discord creative generation and inspiration routing, with its own Node dependencies. | Maintained service |
| `ops/creator-platform/tracking-api/` | Tracking API worker, provisioning and database/live verification tools. | Operations |
| `tools/payout-audit/` | Local payout audit engine and dated one-off report scripts. Run per payment cycle. | Used monthly |
| `tools/discord-mcp/` | MCP server exposing the GoTall Discord to agents. Wired in `.mcp.json`. | Live |
| `tools/talking-classifier/` | Audited talking/non-talking payout classifier and evaluation tooling. Separate from general video analysis. | Payout audit tool |
| `tools/video-analysis/` | TikTok link → download → Gemini 3.5 Flash-Lite watch report / Q&A, frames on disk. CLI for agents; imported by the support bot. | Live |
| `tools/viral-archive/` | Resumable Viral.app preservation, indexing and offline archive generation. Private archives live outside this repo. | Archival tool |
| `scripts/`, `.github/workflows/` | Portable verification, Git hygiene checks and GitHub Actions. | Repository maintenance |
| `inspo/creator-platform/` | Design references the creator platform follows. | Reference |

Historical documents kept for context, not current direction:

- `PRD.md` is the original March 2026 product spec and is superseded by
  `CREATOR_FIRST_PLATFORM_VIDEO_TRACKING_PLAN.md`.
- `deal-restructure-2026-07-20.md` records the July 2026 creator deal terms.

Untracked working directories that live next to the code but are ignored by
git: `payouts/`, `output/`, `tmp/`, `reports/`, and the March screenshots in
`inspo/`.

Private Discord administration captures, evaluation reports and the legacy
creator-history review used by cutover also stay on disk and are ignored. They
are operational evidence, not synthetic test fixtures. This GitHub repo is
public: commit source, lockfiles, migrations, curated runtime guidance and
anonymized tests; keep credentials, creator records and raw captures out of Git.

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

# checks that also run on a fresh GitHub runner
npm run repo:check
npm run verify:portable
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

## GitHub Actions

`Repository CI` runs on pushes to `main` and `codex/**`, pull requests and manual
dispatch. Its five checks cover:

- repository hygiene and portable Node/Python service and tool tests;
- legacy web tests, lint, type checking and production build;
- creator-platform tests, lint, type checking and production build;
- inspiration bot tests and build; and
- Discord support regressions and Bubblewrap filesystem isolation.

Each Node application installs from its own lockfile with `npm ci`. Support
dependencies use `ops/discord-support/requirements.lock`. The workflow has
an additional `scripts/requirements.lock` for portable Python tooling. It has
read-only repository permissions and uses no production credentials. Builds
are verification only; deployment continues through the documented target-specific
procedures. No workflow performs production migrations or Discord mutations.

Installed-systemd checks, PostgreSQL integration scripts and live provider/model
evaluations remain separate gates: a green CI run does not establish live tracker
coverage, delivery, payment or agreement readiness. Five existing React-effect
lint findings in four legacy components remain visible warnings; new components
retain the default error severity.

Before committing, stage the intended files and check the exact staged bytes with
`python3 scripts/check-repository.py --index`. Review `git diff --cached --stat`
and `git diff --cached --check`, then commit and push. Keep each deployed source
change in Git so another checkout can reproduce it. The hygiene scanner catches
private paths and several recognizable credential formats; it is not a complete
secret detector.

## Data model

`web/` does not use Prisma at runtime. `web/prisma/schema.prisma` is the model
source that `web/scripts/generate-prisma-shim.mjs` turns into the committed
`web/src/lib/db-schema.generated.ts`. SQL migrations for `web/` are in
`web/sql/`. The creator platform's migrations are in
`creator-platform/supabase/migrations/`.
