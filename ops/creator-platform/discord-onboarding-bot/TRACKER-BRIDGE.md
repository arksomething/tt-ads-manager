# Discord tracker bridge

First-video approval makes campaign accounts eligible for enrollment. The
gotall-discord-tracker-bridge.timer checks every minute. It reads approved
accounts as gotall-discord, enrolls/reads health as creator-tracker-writer, then
queues creator notifications through the bot's durable delivery queue.

The tracker database is /var/lib/creator-tracker/state/gotall-viral.db. New
accounts use manual provenance and unresolved native identity, with a discovery
limit of 150. Existing rows are reused by exact platform and handle; identities,
limits, lifecycle and payout settings are never overwritten. This registers
public tracking, not proof of account ownership. Existing inactive accounts
are reported in the service output, not silently reactivated.

Only fresh completed account-discovery evidence for the current handle and
after approval may trigger a creator notification. Explicit private-profile
codes qualify. TikTok unavailable needs its typed NOT_FOUND result and explicit
status_deleted evidence; HTTP 404 alone never qualifies. Collector timeouts,
auth errors, WAF blocks and ambiguous failures remain internal. One alert per
issue episode; transient errors do not clear an issue. Successful collection
queues one recovery message. The bot restricts mentions to the creator.

Install tracker-bridge.py as root-owned 0555 under the existing bot runtime and
the accompanying unit/timer as root-owned 0644 under /etc/systemd/system, then
daemon-reload and enable --now gotall-discord-tracker-bridge.timer. The existing
collector schedules remain unchanged. Registration does not guarantee discovery
has completed, and never starts a trial or initiates payment.
