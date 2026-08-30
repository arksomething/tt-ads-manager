# Creator platform infrastructure baseline

This directory is the non-secret control index for the creator-first rebuild.
It records where credentials are authoritative, which integrations are ready,
and which credentials are genuinely missing. It never stores credential values.

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

- Production web values: encrypted Vercel project environment.
- Local developer web values: ignored owner-only files under `web/`.
- Social collectors: owner-only provider credentials on the laptop.
- Collector scheduling: non-secret `~/.config/creator-tracker/env` plus narrowly
  scoped service credentials.
- Cloudflare and Vercel CLI sessions: their owner-only native credential stores.
- Existing Discord and Resend credentials: retained only as migration sources.
  Discord was live-validated; Resend authenticated successfully and `gotall.app`
  is already a verified sending domain.

The existing `GoTall` Discord bot and its client ID were live-validated against
Discord. It is already in the `GoTall Creators` guild, and the guild's lifecycle
roles can be mapped without requesting new IDs. Creator account linking still
needs the application's client secret and the new OAuth callback registered in
the Discord developer portal. The bot's managed role also needs to sit above
every lifecycle role it will assign.

Provider-native credentials should not be copied merely to make the catalog
look centralized. The catalog is the central map; each secret stays with the
smallest runtime that needs it.

## Readiness summary

| Area | Existing credential candidate | Remaining input |
| --- | --- | --- |
| Database, Supabase, and web auth | Present locally and in Vercel | Create a dedicated integration-encryption key during implementation |
| Domain and hosting | Cloudflare DNS, Vercel, and VPS access validated | None for the additive domain preparation |
| Source control | Local repositories and commits are intact | Reauthenticate GitHub CLI/HTTPS for `arksomething` before pushing or connecting the new Vercel project |
| Viral migration safety net | Current web credential exists | Revalidate before any migration-critical run |
| TikTok | Business app and Ads credentials exist; public collector is separate | Official creator OAuth credentials only if that future path is chosen |
| Instagram collection | Adapter exists | `SCRAPECREATORS_API_KEY` |
| Discord | Existing bot token/client ID, guild, channels, and roles validated | Client secret and registered OAuth callback |
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
separate Vercel project `gotall-creator-platform` is reserved for the rebuild
with `web` as its Next.js root and Node.js 24. It deliberately has no deployment,
production secrets, or public domain yet. The apex remains on the current studio
until the creator platform has working
authentication, callbacks, monitoring, and rollback. The laptop collector gets
no public dashboard subdomain. It will eventually deliver signed, idempotent
batches to a narrow HTTPS ingestion route on the new platform.

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
