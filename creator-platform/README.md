# GoTall Creator Platform

This is the new creator-first application. It is intentionally separate from
the legacy application in `../web/`; the two apps have independent dependencies,
environment files, and Vercel projects.

## Current frontend

The first production-safe frontend slice includes:

- a public creator-program landing page and application preview;
- a creator home preview with performance, activity, next action, and inbox;
- a six-step account-verification preview;
- an admin activity preview; and
- a no-store health endpoint at `/api/health`.

All fixture data is visibly marked as sample data. Applications, authentication,
Discord linking, canonical tracking, and payouts are not connected yet.

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
