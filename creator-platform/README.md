# GoTall Creator Platform

This is the new creator-first application. It is intentionally separate from
the legacy application in `../web/`; the two apps have independent dependencies,
environment files, and Vercel projects.

## Current production slice

The creator-account and operations slice includes:

- confirmed email/password signup, sign-in, sign-out, and password recovery;
- a deployed Google OAuth UI and server-side PKCE callback route whose
  production authorization request reaches Google with the dedicated client
  and exact Supabase callback;
- a protected creator account and application-status flow;
- a live application that stores the creator's name, phone number, Discord
  username, and TikTok or Instagram handles in the dedicated creator database;
- staff application review whose approval is locked to an explicitly reviewed,
  ready default-deal UUID and immutable snapshot hash;
- an admin deal workspace for blank-term draft creation, optimistic revisions,
  exact legal/economic preview, readiness evidence, and immutable sealing;
- creator and staff platform-account verification interfaces;
- creator content submission, canonical post attribution, immutable metric
  observations, and separate earning/settlement states;
- private scripts and asset assignment/download interfaces;
- admin home, daily view, application queue, creator directory and profiles,
  content review, verification review, and finance ledger;
- a provider-neutral SignWell agreement gate that stays locked until the
  exactly-one verified production database binding matches the assigned
  combined deal snapshot and the completed PDF plus verified webhook evidence
  are archived; retired assigned versions retain their own binding through
  default rollover, and process-wide template ID/hash variables are ignored;
- an `assigned` agreement state that is distinct from an actively leased
  provider-preparation job, with safe recovery of expired preparation leases;
- a signed, idempotent tracker ingestion endpoint with durable pre-account
  staging and signed commit receipts;
- a public creator-program landing page;
- a creator home preview with performance, activity, next action, and inbox;
- a six-step account-verification preview;
- an admin activity preview; and
- a no-store health endpoint at `/api/health`.

Email delivery uses the dedicated Supabase Auth project with Resend SMTP. All
fixture dashboard data is visibly marked as sample data. Discord linking and
its reboot-persistent reminder worker are deployed. The signed tracker ingestion
route and canonical delivery timer are live; Instagram's direct collectors remain
disabled behind their independent provider-credit gate. SignWell sending and archival remain disabled until legal,
template, webhook, and key-rotation gates pass. The settlement ledger is live,
but no payout provider is connected. Automated TikTok/Instagram ownership
verification has a worker protocol but no enabled provider worker.

The application asks only for the creator's name, phone number, Discord
username, and one or more TikTok or Instagram handles. Applicants never choose
or send deal terms. Approval assigns the current immutable, versioned program
default atomically and fails closed if no active, effective, fully approved,
production-template-bound snapshot exists. No deal version is seeded by code,
and the public sample agreement cannot be imported or sealed as a live deal.

The visual direction comes from `../inspo/creator-platform/`: neutral,
brand-flexible, compact, and task-first. Unknown, stale, restricted, and
unsupported tracking states must remain distinct from a real zero. Earnings
must likewise keep estimate, finalization, review, approval, payment, and
reconciliation states separate.

## Verification

From the repository root:

```bash
npm run creator:verify
```

Or from this directory:

```bash
npm run verify
```

The verification gate runs tests, lint, type checking, and the production
Next.js build.

## Deployment boundary

The Vercel project is `gotall-creator-platform` and its Root Directory is
`creator-platform`. Deploy it explicitly from the repository root. Never use
the root or `web/.vercel` legacy links for this application, and never treat a
creator-platform deployment as authorization to move `gethyperspeed.com`.

The domain cutover checklist and non-secret environment catalog live under
`../ops/creator-platform/`.
