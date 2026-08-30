# Creator Platform Agent Notes

This directory is the new creator-first product. The sibling `../web/` app is
legacy production code: do not delete, move, or import runtime code from it.

Before deploying changes from this directory, run:

```bash
npm run verify
```

The Vercel project is `gotall-creator-platform`, with this directory as its
Root Directory. Never deploy this app through the repository root's existing
`.vercel` link because that link targets the legacy `tt-ads-manager` project.

Frontend rules:

- Use the selected references in `../inspo/creator-platform/`.
- Keep the shell neutral and mostly white, black, and gray.
- Treat GoTall as a workspace or campaign, not the platform design system.
- Never render unknown, stale, unsupported, or incomplete tracking as zero.
- Distinguish estimated, pending, approved, paid, and reconciled earnings.
- Keep sample fixtures visibly labeled until canonical data is connected.
