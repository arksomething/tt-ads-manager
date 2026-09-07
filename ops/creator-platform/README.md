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
- Creator account data: the dedicated Supabase project
  `gotall-creator-platform` (`qubkgekdpyntuanzqqeu`) in `us-east-1`. Its public
  URL/key and server-only key are installed only in the matching Vercel project.
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

Creator authentication is intentionally isolated from both the legacy CRM and
the consumer GoTall Supabase user pool. Email/password auth is live with email
confirmation, a 10-character minimum password, leaked-password protection, and
Resend custom SMTP from `accounts@gotall.app`. The Google OAuth UI, PKCE route,
and Supabase provider use a dedicated client in the isolated Google Cloud
project. Production verification reached Google's normal sign-in route with
the expected client and exact Supabase callback, and Google's token endpoint
accepted the client credentials; a real user callback remains to be observed.
Password changes require recent authentication and generate a change
notification. The account,
application, enrollment, immutable deal-version, verified platform-account,
and provider-neutral agreement tables all have row-level security enabled;
anonymous users have no table grants. Applicant-entered handles remain
provisional until provider-native ownership evidence is recorded.

The production confirmation and password-recovery templates use the SSR-safe
Supabase token-hash contract recorded under
`ops/creator-platform/auth-email-templates/`. They link back to the controlled
`.RedirectTo` callback with `.TokenHash`, then the application verifies the OTP
and writes the session cookies. Do not restore the default `.ConfirmationURL`:
that verifies the address before returning a browser-fragment/PKCE result that
the server callback cannot reliably consume across browsers. Resend requests
remain non-enumerating and the UI states the one-minute provider throttle
instead of promising that every request produced another message.

The production signup, confirmation, resend-confirmation, sign-in, sign-out,
application, and password-recovery paths have passed an end-to-end disposable
account test. Authenticated account and status pages show only the creator's
persisted application snapshot and never send a real creator into a public
sample dashboard. The application asks for name, phone number, Discord name,
and one or more TikTok or Instagram handles; email belongs to the authenticated
account. As of 2026-09-03, the explicitly selected, confirmed real account is
also the first active administrator; no legacy handle was used to infer access.

The additive creator-operations schema and web interfaces are live. They cover
staff application review, atomic enrollment preparation, manual platform-account
verification, scripts and private assets, creator content submission and post
attribution, immutable post observations, estimated earnings, settlement-state
ledgers, the admin daily view, creator directory and profiles, finance review,
and an admin-only deal-draft workspace with structured economics, snapshot hashes,
optimistic revisions, readiness evidence, and immutable sealing. Approval now
requires explicit confirmation of the exact active-default UUID/hash and rejects
an unready, stale, or changed deal under a database lock. Unknown metrics remain
unknown; the UI does not convert missing evidence
to zero. Production contains one real account with one active administrator,
but no seeded or active default deal, agreement, payout, or verification job.
The tracker ingestion stores do
contain the committed 45-page frozen provider capture; those staged evidence
rows do not create creator accounts, approve deals, or establish payout
finality.

`GoTall - Management` is the live, reboot-persistent Hermes Discord application
and is present in both `GoTall Creators` and `GoTall Community`. The legacy
`GoTall` application is not part of the new platform. Creator linking and staff
operations interfaces, the OAuth start/callback/disconnect routes, the durable
Supabase reminder schema, and the signed worker API are deployed in the isolated
creator platform. The registered `gethyperspeed.com` callback is served by the
narrow Cloudflare Worker version `84979fb5-bcd8-4fb8-99d7-58975f6e5a17`; it
does not move the apex or proxy another route. The deterministic creator worker
is enabled at boot, runs under the dedicated `gotall-discord` system account,
and has a healthy production heartbeat after a restart. Management has `Manage
Roles` without `Administrator`, and its role hierarchy is validated above all
four managed lifecycle roles and below Admin.

The client secret supplied through chat must still be rotated before broad
launch. After rotation, one explicitly consenting account must prove OAuth,
membership, a requested test DM and receipt, role reconciliation, opt-out, and
disconnect end to end. Production currently has no linked Discord creator and
no delivery or role job. Never put creator users or roles in the Hermes agent
allowlist. OAuth, deterministic role sync, and the LLM gateway are separate
code and configuration lanes, but because the deterministic worker and Hermes
currently share the Management bot credential, that separation is not a
cryptographic token boundary. The ScrapeCreators key remains collector-only and
is not loaded into Hermes.

Provider-native credentials should not be copied merely to make the catalog
look centralized. The catalog is the central map; each secret stays with the
smallest runtime that needs it.

## Readiness summary

| Area | Existing credential candidate | Remaining input |
| --- | --- | --- |
| Database, Supabase, and web auth | Dedicated creator Supabase project plus an isolated, billed `gotall-creator-platform` Google Cloud/Firebase project with Identity Platform initialized, confirmed email/password auth, deployed Google OAuth UI/PKCE route, dedicated Google web client, registered callback, application/admin/content/earnings/settlement/deal-control schemas, 24 new RLS-protected tables, protected account pages, one explicitly selected active administrator, participant-only creator counts/profiles, and Vercel runtime values are live | Complete one real-account Google callback test, add CAPTCHA before broad public launch, and create an integration-encryption key only when an integration needs stored tokens |
| Domain and hosting | Cloudflare DNS, Vercel, and VPS access validated | None for the additive domain preparation |
| Source control | Local repositories and commits are intact | Reauthenticate GitHub CLI/HTTPS for `arksomething` before pushing or connecting the new Vercel project |
| Viral migration safety net | Current web credential exists | Revalidate before any migration-critical run |
| TikTok | Business app and Ads credentials exist; public collector is separate | Official creator OAuth credentials only if that future path is chosen |
| Instagram collection | Credential, bounded identity proof, 29 direct observations, and a protected 100-credit floor validated | The durable guard is blocked because current provider credit telemetry is missing; keep both timers disabled until the sealed one-request rearm proves at least 1,250 credits of launch capacity |
| Discord | GoTall - Management bot/client, creator and staff interfaces, OAuth routes and callback proxy, durable reminder/role schema, signed worker API, validated hierarchy, healthy reboot-persistent worker, and Manage Roles permission are live | Rotate the chat-exposed client secret, then complete an explicitly consenting OAuth, requested test-DM, role, opt-out, and disconnect E2E proof |
| Transactional email | Resend custom SMTP is live for creator auth from `accounts@gotall.app` | Monitor delivery and abuse before increasing the 30-email/hour project limit |
| Analytics | PostHog, Singular, Superwall, and Adapty candidates exist | PostHog personal key only for server-side management queries |
| Object storage | Two private Supabase Storage buckets are live for program assets and completed agreements; referenced assets cannot be directly deleted | Add retention/backup monitoring before large-volume use |
| Payments | Estimated/pending/approved/paid/reconciled earning and settlement ledgers are live; no creator payout rail is connected | Choose a payout provider, then add its scoped server and webhook credentials |
| Agreements | The SignWell draft-before-send adapter, verified webhook path, private completed-PDF archive, evidence hash, and provider-neutral event ledger are live but sending is disabled. Its exactly-one verified per-deal database binding is authoritative, including for retained retired assignments; process-wide template ID/hash variables are obsolete and ignored | Rotate the chat-exposed key, approve the legal template and guardian rules, record and verify the production template binding against the exact combined snapshot, add the verified webhook secret, and explicitly approve live mode |
| Default creator deal | Prospective `$0.50/$100` baseline and `$1/$300` talking tiers are documented; the admin blank-draft, structured-economics, exact-preview, immutable-seal, approval-snapshot, and fail-closed assignment controls are live. The first admin is active; production still has no seeded or active default | Approve the full term sheet and counsel-reviewed agreement; then record exact business/legal approvals, bind a matching verified production template, and separately approve activation |
| Collector delivery | The production signed dual-store endpoint, current HMAC key, exact idempotency contract, signed post-commit receipt, pre-account staging, completed 45-page cutover, and reboot-persistent canonical delivery timer are live | Monitor delivery, raw-attestation, and normalized-store health; this is tracking evidence, not payment finality or complete direct-source coverage |

Existing TikTok Business credentials are not proof of TikTok Login Kit or
Display API approval. Existing Stripe-style subscription credentials in other
projects are not creator payout credentials. Those distinctions are retained in
the catalog so a convenient key is never silently reused for the wrong trust
boundary.

## Agreement provider direction

DocuSign is not part of this system. Its embedded/API packaging is aimed at
enterprise and ISV integrations and is disproportionate for the expected early
creator volume. SignWell is now the selected provider: it supports templates,
ordered creator/guardian/company recipients, embedded signing, webhooks, and an
audit page without a monthly API minimum. Its API key is stored as a sensitive
production variable in the isolated creator-platform Vercel project and has
passed a read-only account request. The application adapter and webhook route
are deployed, but every live-send/archive flag remains disabled. Because the
supplied credential was pasted into chat, rotate it before enabling live signing
and replace the Vercel variable in place.
Published overage pricing starts at roughly $0.85 per document after the current
included allowance. PandaDoc Free can cover up to 60 sends per year but
its two-recipient ceiling makes it unsuitable when a guardian is required.

The database deliberately remains provider-neutral. The deployed adapter writes
verified, idempotent provider events and will archive the completed artifact and
its hash before activating an enrollment. A browser return URL can never mark an
agreement complete. Production has `AGREEMENT_SEND_ENABLED=false`,
`AGREEMENT_ARCHIVE_ENABLED=false`, and `AGREEMENT_LIVE_MODE_APPROVED=false`, so
the provisional key cannot send a live agreement. SignWell's
`document_in_progress` event remains a resumable `viewed` state;
`creator_accepted` is reserved for `document_signed`, and only a completed event
with an archived artifact can activate the creator.
First-party clickwrap remains appropriate for policies and acknowledgements,
but it must not replace the bilateral creator agreement without legal approval.
The researched comparison, thresholds, and adapter requirements are recorded in
[`agreement-provider-decision.md`](./agreement-provider-decision.md).

The observed economic candidate, legacy contradictions, Viral.app limit seed,
and decisions blocking activation are recorded in
[`default-deal-readiness.md`](./default-deal-readiness.md). No legal or payout
terms were inferred into production from the inconsistent legacy fallback.

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
separate Vercel project `gotall-creator-platform` serves the creator app at
`gotall-creator-platform.vercel.app`, with `creator-platform` as its Next.js
root and Node.js 24. Deployment `dpl_CT6MNLWkgAbFFRQKy9dwMcbVsnwn` is live on
that stable alias. It includes the four-step creator onboarding flow, exact
assigned-term agreement review, and the nonbinding standard-agreement sample.
Its production environment contains the isolated Supabase
account configuration, scoped Discord OAuth variables, the current collector
ingestion key, normalized-store URL and pinned CA, and fail-closed agreement
flags. Public sample dashboard routes remain explicitly labeled. Discord
infrastructure and the creator-operations web/schema surfaces are deployed. The
signed tracker ingestion route and reboot-persistent canonical delivery timer
are live after the sealed 45-page cutover. A receipt is signed only after both
the Supabase projection and normalized `creator_tracker_v2` PostgreSQL store
commit; a partial prior commit is retried idempotently. Automated TikTok and
Instagram account verification, complete direct-source coverage, live agreement
sending, and payout execution remain gated. The apex remains on the current
studio until the creator platform has real-account launch proof, monitoring,
and rollback. The laptop collector gets no public dashboard subdomain and
delivers only to the narrow signed HTTPS ingestion route.

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
across reboot only when the corresponding timer is enabled. The approved worker,
TikTok roster/scheduler, provider reconciliation, canonical delivery, raw
verification, and dashboard-health units are enabled and reboot-persistent. The
laptop delivery path and central idempotent ingestion API share the signed
batch/receipt contract, and the endpoint can durably stage evidence before a
creator account exists. A collected batch is recorded locally before network
delivery, retried from database state, and acknowledged only after both central
stores commit. The sealed capture/delivery/raw-archive/attestation gate passed
for the frozen 45-page capture. Instagram's two direct timers remain disabled
behind their independent credit-telemetry rearm gate.

Collection failures, provider retries, and cloud delivery retries are different
ledgers. A provider failure must not be mistaken for a delivered zero, and a
successful local scrape must not be considered centrally stored until an ACK is
recorded.

## Before moving the apex

1. Create a separate Vercel project for the new platform; keep legacy isolated.
2. Add and verify all Supabase, Google, TikTok, Meta, Discord, email, and payment
   callback URLs on the new origin.
3. Keep the release-bound sealed collector cutover marker valid and the signed
   ingestion/outbox delivery path monitored.
4. Verify password reset, creator login, admin login, uploads, webhooks, and
   background workers on the production domain.
5. Preserve the old Vercel aliases and confirm `studio` and `legacy` rollback.
6. Move the apex and `www` only after the above checks pass.
