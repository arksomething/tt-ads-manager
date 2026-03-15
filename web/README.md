# Web App

This directory contains the actual Billion Views product app.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- Prisma + PostgreSQL
- Auth.js with Google OAuth
- Zod for validation

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `DATABASE_URL`
- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATA_PROVIDER_BASE_URL`
- `DATA_PROVIDER_API_KEY`
- `CRON_SECRET`

## Useful Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run db:generate
npm run db:push
npm run db:migrate
npm run db:studio
```

## Structure

- `src/app/`: App Router entrypoints and API routes
- `src/lib/`: shared runtime utilities
- `src/server/`: server-side domain modules and integrations
- `src/types/`: shared type augmentation
- `prisma/`: database schema

## Notes

- The app now includes a styled landing page aligned to the product direction.
- Auth, onboarding, and core workspace screens still need to be built next.
- The external data provider client is intentionally generic until the real endpoint contract is confirmed.
