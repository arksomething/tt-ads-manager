# Shared deal publishing

The compact Discord card is an interface to the legacy calculator's authoritative PostgreSQL `CampaignCreatorDeal` rows. Each row now has a `dealVersionId` pointing to an immutable `CreatorDealVersion` containing its exact terms. Database triggers capture writes from either the dashboard or Discord. The calculator therefore continues reading its existing rows without a separate synchronization copy of financial terms.

## Editing

Managers choose Edit deal, edit a section, then review the differences and effective date. Forms only save private drafts in the bot database. Publish real deal creates a durable outbox request. A root-owned worker publishes as the existing application owner; database credentials never enter the bot. It checks the root-owned creator/campaign allowlist, expected source version, effective dates, overlap and monetary constraints. Source changes reject the draft. Repeated delivery of a request returns the original publication.

Only after PostgreSQL confirms success does the bot update its read cache, remove the draft and enqueue one channel-visible result. A transient failure retries the same request. A rejected publication retains the draft for correction. Pending publications block competing edits. User mentions are restricted to the initiating manager; a proxy preview does not send messages to the real creator.

Future publications close the old period and create a new period atomically. Before the start date, the summary retains the current deal and offers Scheduled deal, including Edit scheduled deal. Full terms and immutable history remain secondary views. The new agreement URL is a term field, not evidence of signing.

## Finalized payments

On APPROVED, SCHEDULED or PAID, `PayoutTermsSnapshot` freezes the recorded amount/recipient, applicable campaign deal rows and video overrides. Finalized amounts/recipients cannot be rewritten, their records cannot be deleted, and snapshots cannot be modified. Payment status may still progress. Corrections need separate adjustment records. Existing payouts numbered zero when installed; no historical provenance was fabricated. This does not create a monthly earnings statement, process a transfer, or freeze an unfinalized report's changing view metrics.

## Deployment and scope

`versioned-deals.sql` is the transactional database migration. Its initial baseline preserves existing terms and timestamps; 64 rows were verified unchanged on installation. The pre-migration financial terms backup is private on XPS. Public/browser roles cannot write the history tables or invoke publication; service-role application writes retain access.

`gotall-discord-deals.timer` delivers requests every ten seconds. The bot's existing minute scheduler sends the result receipt. `/etc/gotall-discord-deal-bindings.json` is root-owned and readable by the application owner; it contains IDs, not secrets. `creator_deal_bindings` controls presentation, while the worker independently enforces that allowlist. The currently authorized binding is retconned's @imogg3d preview. Adding a creator requires confirming its actual campaign/organization identity and adding both bindings. Handles alone never authorize a write.

`hub-payout-export.py` refreshes version history every five minutes. Direct publication refreshes the affected current deal rows immediately. Unbound creators continue using clearly labeled local sandbox versions; those local versions never override a bound shared deal.

## Verification

`test-versioned-deals.py versioned-deals.sql` runs a temporary PostgreSQL cluster with no TCP listener. It verifies baseline history, calculator projection equality, future activation, idempotency, stale-draft rejection, organization isolation and immutable finalized payment terms/amounts. The Discord suite verifies authorization, compact views, drafts, the outbox and one-time publication receipts. A live-schema publication/read was also verified inside a rolled-back transaction; no creator's rates were changed for testing.
