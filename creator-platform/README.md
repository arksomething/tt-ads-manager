# GoTall Creator Platform

This is the new creator-first application. It is intentionally separate from
the legacy application in `../web/`; the two apps have independent dependencies,
environment files, and Vercel projects.

## Current production slice

The first creator-account slice includes:

- confirmed email/password signup, sign-in, sign-out, and password recovery;
- a protected creator account and application-status flow;
- a live application that stores the creator's name, phone number, Discord
  username, and TikTok or Instagram handles in the dedicated creator database;
- a provider-neutral agreement gate that stays locked until verified completion
  evidence exists;
- a public creator-program landing page;
- a creator home preview with performance, activity, next action, and inbox;
- a six-step account-verification preview;
- an admin activity preview; and
- a no-store health endpoint at `/api/health`.

Email delivery uses the dedicated Supabase Auth project with Resend SMTP. All
fixture dashboard data is visibly marked as sample data. Discord linking,
canonical tracking, agreement-provider delivery, and payouts are not connected
yet.

The application asks only for the creator's name, phone number, Discord
username, and one or more TikTok or Instagram handles. Applicants never choose
or send deal terms. Approval assigns the current immutable, versioned program
default atomically and fails closed if no active default exists.

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
