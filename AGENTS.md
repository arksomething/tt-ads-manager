# Agent Notes

This repo should be operated production-first. Do not bog users down with local
environment setup, local-only previews, or "works on my machine" instructions.
When a change is requested, make the repo change, verify it as much as practical,
and ship it to the production target.

## Web Production

The web app is deployed on Vercel. The linked Vercel project metadata is already
checked out locally in `.vercel/` and `web/.vercel/`, with `web` as the Vercel
root directory.

For production web changes:

1. Edit the app in this repo.
2. Run verification from `web/`:

```bash
npm run typecheck
npm run build
```

3. Deploy production from `web/` using the linked Vercel project:

```bash
npx vercel deploy --prod
```

If a prebuilt deploy is more appropriate:

```bash
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

Do not assume Vercel is unavailable just because a global `vercel` binary is not
on `PATH`. Use the local project configuration.
