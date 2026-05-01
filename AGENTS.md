# Agent Notes

- Vercel is configured locally for this repo. The linked project metadata lives in `.vercel/` and `web/.vercel/`, with `web` as the Vercel root directory.
- For production deploys, use the local Vercel project configuration instead of assuming Vercel is unavailable just because a global `vercel` binary is not on `PATH`.
- Before deploying, run verification from `web/`, especially `npm run typecheck` and `npm run build`.
