# Billion Views

`Billion Views` currently deploys a minimal branded homepage.

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
- Supabase Auth plumbing for the primary sign-in flow
- Environment variable validation
- Core server modules for organizations, campaigns, creators, videos, notes, dashboard queries, and external data provider integration
- Root-level scripts so the workspace behaves like one project

## Next Product Steps

- connect a real Postgres database
- finish Supabase Auth environment setup
- confirm the real provider endpoints and map them into sync jobs
- build onboarding, organization selection, and campaign workspace screens
