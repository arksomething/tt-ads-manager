# Discord OAuth callback route

Discord currently registers the creator integration callback on
`gethyperspeed.com`. This narrowly routed Worker proxies only the exact callback
path to the isolated creator-platform Vercel project. Every other method or path
returns 404, cookies are not forwarded, and callback responses are never cached.

Workers Logs are disabled for this route so the OAuth `code` and single-use
`state` query parameters are not persisted in invocation URLs.

This route does not move the apex, change the Hyperspeed studio, or proxy any
other API path. The OAuth flow uses a single-use database state because the
registered callback and the authenticated application have different origins.

Deploy from this directory with the pinned current Wrangler major:

```bash
npx --yes wrangler@4.127.1 deploy --dry-run
npx --yes wrangler@4.127.1 deploy
```
