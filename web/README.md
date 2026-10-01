# Web App

This directory contains the existing GoTall operations dashboard, historically
called Billion Views. The newer creator-facing application lives separately in
`../creator-platform/`; both apps remain maintained with independent deployments.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- Supabase REST + server-side data client
- Supabase Auth with email/password sessions
- Zod for validation

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, or `SUPABASE_PK`
- `SUPABASE_SK` or `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`
- `AUTH_URL`
- `DATA_PROVIDER_BASE_URL`
- `DATA_PROVIDER_API_KEY`
- `VIEWSBASE_SESSION_COOKIE_VALUE` if you want to sync ViewsBase campaign videos
- `CRON_SECRET`

## Useful Scripts

```bash
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
npm run db:generate-shim
```

## Structure

- `src/app/`: App Router entrypoints and API routes
- `src/lib/`: shared runtime utilities
- `src/server/`: server-side domain modules and integrations
- `src/types/`: shared type augmentation
- `prisma/`: model source used to generate the local shim and relation metadata

## Notes

- The app now includes a styled landing page aligned to the product direction.
- Supabase Auth now handles the primary sign-in flow for workspace access.
- `DISABLE_AUTH=true` is the switch for public access mode; the old `DISABLE_GOOGLE_AUTH` flag only applies to legacy Google auth.
- Server integrations include Viral.app, TikTok Business, Singular, Superwall,
  Adapty and ViewsBase. Their availability depends on each runtime's configured
  credentials; a build does not prove provider access.
