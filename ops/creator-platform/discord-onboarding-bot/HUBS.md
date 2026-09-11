# Creator posts and payments

`/posts [month:YYYY-MM]` and `/payments [month:YYYY-MM]` open private responses in the caller's creator channel. Outside it, the commands link the caller to their own channel. The pinned directory has matching buttons.

Posts are grouped by submission, four videos per page, using the creator's timezone for the recorded month. New paired submissions share a submission ID. Existing rows without that ID appear individually. Tracking snapshots come from `creator_post_meta`; missing metrics remain unavailable, never zero. Manual submissions retain their own metadata. The live provider views described below use a separate cache and publication month; they never pretend independent cross-platform posts are a matched pair.

Payments read `creator_statements`, scoped by creator and month. Integer-cent line items determine totals and outstanding amounts. Draft statements show estimates, not confirmed amounts owed. No statement means not calculated. This is a statement viewer, not a settlement calculator or payment-provider integration. Updating a receiving method does not rewrite previous statement currency or send money.

Both hubs offer Report a problem. One open issue per creator, hub and month is stored in `creator_hub_issues`. The persistent delivery queue mentions only the Manager role. Managers resolve reports from their review card; a private modal collects the explanation, and a creator-channel notification mentions only that creator. Resolving a report does not itself alter post links or transfer money: the manager must first correct the relevant underlying records.

## Test fixture

`seed-hub-demo.mjs` only accepts test guild `1245112089647775877`, retconned `571179674323910667`, and the expected creator channel. Run it as `gotall-discord` against the installed test runtime. It is repeatable and refuses to replace a non-sample statement.

It adds two AliGoTall public TikTok URLs from September 8–9, an explicit example.com Instagram placeholder, simulated tracking values, and three simulated statements (September draft, August processing, July paid). No real creator's payment details or earnings are copied. Existing campaign accounts and receiving-method details are preserved. The fixture does not write to the real guild, tracker database, or payment providers.

Validation: workspace tests cover grouping, pagination, month boundaries, ownership, estimates versus confirmed amounts, report deduplication, authorized resolution, creator notifications, and private slash replies. Live verification checks command registration and Discord's acceptance of the rendered cards.


## Live sources

Both commands accept `source:viral`, `source:tracker`, or `source:submitted`. The on-card selectors remember the creator's preference. No automatic fallback blends sources. Source observation time and cache refresh time are shown separately; observations older than 48 hours are marked.

`gotall-discord-hub-metrics.timer` refreshes the bot cache every five minutes. It reads the tracker DB as `creator-tracker-writer` in SQLite read-only mode. The viral adapter selects only `viral_app_provider`/`viral_app_seed` observations with provider confidence; the new tracker adapter uses its named direct adapters with direct confidence. It makes no additional viral.app API calls. The existing provider reconciler runs on its own schedule. Up to the latest 500 observed videos per source/account within 180 days are projected. These are observed inventories, not a guarantee of complete coverage.

Approved creators automatically receive account mappings from their saved campaign profiles. Retconned has an explicit test-only preview mapping to `@imogg3d`; it does not change his campaign accounts, tracker enrollment, or receiving method. Simulated monetary statements are hidden while the live connection is enabled.

`hub-payout-export.py` reads the legacy dashboard Payout table with a read-only PostgreSQL connection as the existing application owner. Credentials stay in the existing protected app environment; none enter the Discord bot. Account matching requires a unique creator match. Recorded transfers appear separately from monthly earnings because the legacy Payout model has no earnings-period field. Switching metric sources never changes transfer records. A failed refresh retains previous records and their last successful check time. On September 10 the connected Payout table contained zero rows, so no real payment history was available to show.

`/payments` now calculates earned compensation rather than presenting recorded transfers. It invokes the existing GoTall UGC pay engine with the linked creator/campaign identity, selected month, published deal windows, per-video fees, CPM, caps and video overrides. The current engine uses the existing viral.app/provider and paid-view lookup paths. The posts tracker selector does not substitute a different payout engine.

A private on-demand request is stored in `creator_earnings`. The root earnings worker runs the calculator as the application owner; credentials never enter the bot. Refreshes are deduplicated while pending and for 60 seconds after success. Results are snapshots; no background edits are sent to previously displayed messages. Errors retain the previous successful calculation with an explicit stale-result note. A zero result accompanied by missing source data is treated as an error, not zero earnings.

The main card shows estimated payout, fixed/per-video/view earnings, the covered dates and material uncertainty (such as unresolved paid traffic). Calculation details contains source warnings. It does not require a recorded transfer or a finalized statement. If a finalized earnings statement exists, its approved total takes precedence. This does not initiate transfers.

`export-calculated-earnings.mjs` calls the existing server calculation module directly. Its loader only resolves TypeScript aliases and disables the Next request cache for the headless read-only worker. The trusted `applyDealViewWindows` scope option applies each video’s published deal window through the existing window calculator; ordinary web caller behavior is preserved. Monetary formulas are not reimplemented in the Discord renderer.


## Deals

`/deal` and `/creator deal creator:@member` show a compact summary with Full terms, History and a manager-only Edit deal menu. Editors use private drafts with before/after previews and an explicit effective date. See SHARED-DEALS.md for persistence and publication.

The user authorized real deal updates from retconned's server on September 11. The current @imogg3d preview is explicitly bound to its real campaign creator record. Its card identifies that creator and says Live deal; Publish real deal updates the calculator's authoritative terms. Unbound creators retain the sandbox flow. Do not silently map a different creator or campaign.

Published shared versions are imported for history. Future updates show separately until their effective date. The calculator reads the same CampaignCreatorDeal rows, each pointing to an immutable CreatorDealVersion. Changes to shared bindings do not alter tracker source preferences or transfer records.
