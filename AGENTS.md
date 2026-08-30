# Agent Notes

This repo should be operated production-first. Do not bog users down with local
environment setup, local-only previews, or "works on my machine" instructions.
When a change is requested, make the repo change, verify it as much as practical,
and ship it to the production target.

This repo may have concurrent agents and a dirty working tree. Do not treat
uncommitted or unrelated local changes as a reason to pause, request extra
approval, or avoid production deployment. The owner accepts that production
deploys ship the current working tree. Preserve unrelated changes, verify the
requested work, and deploy.

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

## Creator Platform Production

The creator-first application is additive and lives in `creator-platform/`.
It is separate from the legacy application in `web/`: do not delete, move, or
replace legacy code, and do not share local environment files or Vercel links
between the two applications.

For creator-platform changes, run the repository-level verification command:

```bash
npm run creator:verify
```

The creator platform deploys only to the separate Vercel project
`gotall-creator-platform`, whose configured root directory is
`creator-platform`. Before deploying, confirm the project and organization IDs
against `ops/creator-platform/vercel-project.json`. Preserve the legacy links in
`.vercel/` and `web/.vercel/`. A root dry run is known to enumerate unrelated
legacy and worktree files before applying the remote Root Directory, so never
deploy that bundle. From the repository root, deploy an isolated staging root
that contains only the reviewed `creator-platform/` directory, excludes local
environment and generated dependency/build files, and passes an explicit
`--project gotall-creator-platform` dry-run scope check first.

Deploying the creator platform does not authorize an apex-domain cutover. Keep
the existing production aliases intact until the explicit cutover gate in
`ops/creator-platform/README.md` has passed.
