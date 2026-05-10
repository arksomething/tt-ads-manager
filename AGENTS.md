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
2. Add or update automated tests for the behavior changed, especially for
   calculation logic, server mutations, and user-visible feature workflows. Keep
   tests close to the code path they protect and make assertions that would fail
   if the intended feature edit did not affect the expected output.
3. Run verification from `web/`:

```bash
npm test
npm run typecheck
npm run build
```

4. Deploy production from the repo root using the linked Vercel project:

```bash
npx vercel deploy --prod
```

Do not run `npx vercel deploy --prod` from `web/`. The Vercel project root is
already configured as `web`, so running the command inside `web/` makes Vercel
look for `web/web` and fail with a missing path error.

If a prebuilt deploy is more appropriate:

```bash
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

Do not assume Vercel is unavailable just because a global `vercel` binary is not
on `PATH`. Use the local project configuration.
