# Creator Discord worker

This deterministic worker is the only creator-reminder process allowed to use
the GoTall Management bot token. It does not invoke Hermes or an LLM. The web
application decides which reviewed notification is due; the worker leases it,
renders an allowlisted template, delivers it, and records the Discord receipt.

Central delivery state lives in Supabase. A local SQLite WAL journal closes the
crash window between Discord accepting a message and the Vercel API recording
the receipt. Every message uses a stable provider nonce, `enforce_nonce`, and
disabled mentions. After a message POST timeout, recovery accepts only a message
found by its stored nonce; no evidence or a non-systemic failed lookup becomes
terminal for manual review. A bot-wide lookup failure remains recovery-only
until the circuit can probe successfully. An uncertain message POST is never
sent again.
Supabase marks every lease derived from `delivery_unknown` as recovery-only. If
the matching local journal evidence is missing after disk loss, reinstall, or
corruption, the worker dead-letters it for manual review without contacting
Discord. That recovery marker and the original Discord user/channel remain
pinned across quiet-hours, retries, and account relinks, so evidence for creator
A can never be retargeted or written onto creator B. Known-safe prepared work,
by contrast, rebinds its journal identity exactly to each current lease and
clears any stale cached channel before a relinked send.

Bot-wide authorization or guild-permission failures open a local circuit and
mark the worker heartbeat degraded. Before the circuit closes, the worker
revalidates the bot identity, guild membership, Manage Roles permission,
configured role IDs, and role hierarchy. It does not lease more work while that
preflight is failing. If such a failure interrupts evidence lookup for an
uncertain POST, Supabase retains `delivery_unknown` rather than converting it to
an ordinary retry; recovery therefore stays fail-closed even if SQLite is lost.

The installed system service is `gotall-creator-discord-worker.service`. It
runs as the dedicated no-login `gotall-discord` system user with home-directory
access disabled. The installer copies the pinned Node 24 runtime and reviewed
worker into the root-owned `/usr/local/lib/gotall-creator-discord-worker/`;
later repo edits cannot change the running executable. The system manager
decrypts its two host-encrypted credentials only when the service starts:

- `discord-bot-token`: copied from the existing Management bot authority;
- `discord-worker-secret`: a dedicated HMAC key shared only with the narrow
  Vercel worker API.

Creators are never added to the Hermes operator allowlist. OAuth tokens are not
written to this worker or its journal.

Install only after the web migration and HMAC secret are live. The installer
never prints either secret:

```bash
DISCORD_REMINDER_WORKER_SECRET=... node ops/creator-platform/discord-worker/install.mjs --start
```
