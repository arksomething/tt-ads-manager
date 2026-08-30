# Creator platform infrastructure baseline

This directory is the non-secret control index for the creator-first rebuild.
It records where credentials are authoritative, which integrations are ready,
and which credentials are genuinely missing. It never stores credential values.

The new application lives in `creator-platform/` and targets the independent
Vercel project `gotall-creator-platform`. The existing application in `web/`
remains the legacy system and retains its own environment and deployment links.
Neither application should load the other application's local environment file.

Run the local, value-redacting audit with:

```bash
node ops/creator-platform/bin/audit-credentials.mjs
node ops/creator-platform/bin/inventory-project-envs.mjs
ops/creator-platform/tests/verify.sh
```

The first command checks the curated creator-platform sources. The second walks
the projects tree and inventories every runtime `.env*` file by path, mode, and
variable name while reducing every value to `present` or `empty`.

The machine-readable contract is
[`credentials.catalog.json`](./credentials.catalog.json). Blank future inputs are
listed in [`credentials.env.example`](./credentials.env.example). Do not turn the
example into one giant runtime environment file: the web app, collector,
Discord worker, payment worker, and infrastructure tools must receive only the
credentials they need.

## Credential authorities

- Creator-platform production values: encrypted environment variables in the
  `gotall-creator-platform` Vercel project.
- Creator-platform local values: ignored owner-only
  `creator-platform/.env.local`.
- Legacy production values: the existing `tt-ads-manager` Vercel environment.
- Legacy local values: ignored owner-only files under `web/`; they are not a
  credential source for the creator platform.
- Social collectors: owner-only provider credentials on the laptop.
- Collector scheduling: non-secret `~/.config/creator-tracker/env` plus narrowly
  scoped service credentials.
- Cloudflare and Vercel CLI sessions: their owner-only native credential stores.
- Hermes Discord and Resend credentials: retained in their narrow owner-only
  runtimes. Discord was live-validated; Resend authenticated successfully and
  `gotall.app` is already a verified sending domain.

`GoTall - Management` is the live, reboot-persistent Hermes Discord application
and is present in both `GoTall Creators` and `GoTall Community`. Its OAuth
redirect is registered. The legacy `GoTall` application is not part of the new
platform. The Management OAuth client ID, client secret, redirect, guild, and
role identifiers are installed in the reserved `gotall-creator-platform` Vercel
production environment. The secret supplied through chat must be rotated before
launch, and creator account linking still needs a deployed callback handler.
Management has `Manage Roles` without `Administrator`, but before deterministic
lifecycle-role automation its role must be placed above the four lifecycle
roles and below Admin. Never put creator users or roles in the Hermes agent
allowlist; OAuth, deterministic role sync, and the LLM gateway are separate
trust lanes even when they share one Discord application. The ScrapeCreators
key remains collector-only and is not loaded into Hermes.

Provider-native credentials should not be copied merely to make the catalog
look centralized. The catalog is the central map; each secret stays with the
smallest runtime that needs it.

## Readiness summary

| Area | Existing credential candidate | Remaining input |
| --- | --- | --- |
| Database, Supabase, and web auth | Candidates exist in legacy/private sources | Install dedicated creator-platform values and create an integration-encryption key during implementation |
| Domain and hosting | Cloudflare DNS, Vercel, and VPS access validated | None for the additive domain preparation |
| Source control | Local repositories and commits are intact | Reauthenticate GitHub CLI/HTTPS for `arksomething` before pushing or connecting the new Vercel project |
| Viral migration safety net | Current web credential exists | Revalidate before any migration-critical run |
| TikTok | Business app and Ads credentials exist; public collector is separate | Official creator OAuth credentials only if that future path is chosen |
| Instagram collection | Credential, bounded identity proof, 29 direct observations, and a protected 100-credit floor validated | Raise the provider balance to at least 1,250 before enabling timers; last observed balance is 95 and the guard is blocked |
| Discord | GoTall - Management bot/client, OAuth credentials, two guilds, callback, channels, roles, and Manage Roles permission validated | Rotate the chat-exposed client secret, build the callback handler, and correct the bot-role hierarchy |
| Transactional email | Resend key validated; `gotall.app` sending verified | Select the exact From addresses |
| Analytics | PostHog, Singular, Superwall, and Adapty candidates exist | PostHog personal key only for server-side management queries |
| Object storage | Supabase server access can support Storage | Choose Supabase Storage or deliberately adopt R2 |
| Payments | Subscription/revenue integrations exist, but no creator payout rail | Choose a payout provider, then add its scoped server and webhook credentials |
| Agreements | No e-sign provider selected | Choose clickwrap or an e-sign provider |
| Collector delivery | No cloud-ingestion key exists | Generate an ingestion-only key when the endpoint and outbox are implemented |

Existing TikTok Business credentials are not proof of TikTok Login Kit or
Display API approval. Existing Stripe-style subscription credentials in other
projects are not creator payout credentials. Those distinctions are retained in
the catalog so a convenient key is never silently reused for the wrong trust
boundary.

## Domain transition

The intended stable map is:

| Address | Workload |
| --- | --- |
| `gethyperspeed.com` | New creator platform after the new deployment passes its cutover gate |
| `studio.gethyperspeed.com` | Existing Hyperspeed video studio on the VPS |
| `legacy.gethyperspeed.com` | Existing `tt-ads-manager` Vercel application |
| `tt-ads-manager.vercel.app` | Permanent compatibility address for historical reports and links |

`studio.gethyperspeed.com` is already routed to the existing VPS workload and
`legacy.gethyperspeed.com` is already attached to the existing Vercel project.
Both were verified over HTTPS without removing their original addresses. The
separate Vercel project `gotall-creator-platform` now serves the clearly labeled
frontend preview at `gotall-creator-platform.vercel.app`, with
`creator-platform` as its Next.js root and Node.js 24. The deployment contains
sample UI only: applications, authentication, Discord linking, canonical
tracking, and payouts are not connected. Its production environment currently
holds only the scoped Discord OAuth variables documented above; the remaining
app credentials have not been installed. The apex remains on the current studio
until the creator platform has working authentication, callbacks, monitoring,
and rollback. The laptop collector gets no public dashboard subdomain. It will
eventually deliver signed, idempotent batches to a narrow HTTPS ingestion route
on the new platform.

### Deployment isolation

A root-level Vercel dry run was proven to enumerate unrelated legacy and
worktree files before applying the remote Root Directory. Never deploy that
bundle. Create an isolated staging root containing only the reviewed
`creator-platform/` directory, exclude `.env*`, `.next`, `node_modules`, and
`.vercel`, then run `vercel deploy --dry --project gotall-creator-platform` on
that staging root. Proceed only when every enumerated path is inside
`creator-platform/`; deploy with the same explicit project. This preserves both
legacy `.vercel` links and prevents unrelated source or credentials from being
uploaded.

## Persistent collection and delivery

Existing systemd timers and SQLite due-state preserve local collection work
across reboot only when the corresponding timer is enabled. The future bridge
to the web app also needs a durable SQLite delivery outbox. A collected batch
must be recorded locally before network delivery, retried from database state,
and acknowledged by an idempotent central ingestion API before deletion.

Collection failures, provider retries, and cloud delivery retries are different
ledgers. A provider failure must not be mistaken for a delivered zero, and a
successful local scrape must not be considered centrally stored until an ACK is
recorded.

## Before moving the apex

1. Create a separate Vercel project for the new platform; keep legacy isolated.
2. Add and verify all Supabase, Google, TikTok, Meta, Discord, email, and payment
   callback URLs on the new origin.
3. Implement the signed ingestion endpoint and durable laptop outbox.
4. Verify password reset, creator login, admin login, uploads, webhooks, and
   background workers on the production domain.
5. Preserve the old Vercel aliases and confirm `studio` and `legacy` rollback.
6. Move the apex and `www` only after the above checks pass.
