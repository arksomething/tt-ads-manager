# Billion Views

`Billion Views` is a campaign-first SaaS for creator analytics and UGC operations.

The product direction lives in `PRD.md`. The actual application scaffold lives in `web/` so the repo can keep product docs and inspiration assets at the root.

## Commands

Run these from the repository root:

```bash
npm run dev
npm run lint
npm run typecheck
npm run db:generate
npm run db:push
```

## What Is Set Up

- Next.js App Router app in `web/`
- TypeScript, ESLint, and Tailwind
- Prisma schema for the MVP data model
- Google auth plumbing with Auth.js
- Environment variable validation
- Core server modules for organizations, campaigns, creators, videos, notes, dashboard queries, and external data provider integration
- Root-level scripts so the workspace behaves like one project

## Next Product Steps

- connect a real Postgres database
- add Google OAuth credentials
- confirm the real provider endpoints and map them into sync jobs
- build onboarding, organization selection, and campaign workspace screens
