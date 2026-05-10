# Canonical Daily Reporting

Last updated: May 10, 2026

This document defines the target reporting architecture for Revenue, UGC Status,
profitability, and future operational reports.

The main rule is simple: reporting pages should not each recompute their own
answer for a date range. The system should first produce canonical facts for
each organization and each day. Date ranges are then sums of those daily facts.

## Goals

- Give every report one shared source of truth for proceeds, spend, views, and
  cost components.
- Make reports stable when upstream providers are slow, pending, or partially
  refreshed.
- Preserve enough history to answer why a number changed.
- Support backfills and pricing/config changes without overwriting prior
  answers.
- Make it easy to add new data sources and new cost formulas later.

## Canonical Daily Facts

A canonical daily fact is one finalized measurement for:

- one organization
- one UTC reporting day
- one metric key
- one source/bucket/dimension set
- one day version

Examples:

```text
proceeds.total
proceeds.new
proceeds.renewal
proceeds.paid
proceeds.tiktok
proceeds.apple_search_ads
proceeds.organic_ugc

spend.ugc.total
spend.ugc.fixed
spend.ugc.cpm_video_pay
spend.faceless.total
spend.faceless.base
spend.faceless.management_fee
spend.faceless.dashboard_fee

views.ugc
views.faceless
installs.apple_search_ads
```

Money facts should include currency. Count facts should include unit metadata
when useful, such as `views`, `installs`, or `videos`.

Derived metrics are not stored as canonical facts in v1. They are calculated
from canonical facts at read time:

- profit
- ROAS
- margin
- proceeds per 1k views
- spend per 1k views
- profit per 1k views
- source shares

This prevents a stored ratio from becoming inconsistent with recomputed
underlying dollars or counts.

## Range Aggregation

Every report range should be computed by summing daily canonical facts.

```text
May 4 - May 10 =
  May 4 facts
+ May 5 facts
+ May 6 facts
+ May 7 facts
+ May 8 facts
+ May 9 facts
+ May 10 facts
```

The Revenue page, UGC Status page, and profitability panels should all read
from the same canonical daily layer. They may present different cuts of the
same data, but they should not recalculate proceeds, spend, or views with page
specific formulas.

## Day Versions

Each organization/day can have multiple immutable versions.

A day version records:

- organization id
- reporting date
- monotonically increasing version number for that organization/date
- build status
- data source inputs used
- pricing/config version used
- generated facts
- warnings and errors
- created timestamp
- completed timestamp, when applicable

Only one successful version per organization/date is marked current. Older
versions remain queryable for audit and debugging.

Recomputing a day never mutates an old version. It creates a new version. If
the new version completes successfully, it becomes current. If the new version
is incomplete or fails, the prior current version remains current.

## Freshness States

Every day returned by the canonical layer must expose freshness.

```text
fresh
```

The current day version was built from complete required source data and the
latest known pricing/config for that day.

```text
stale
```

The current day version is usable, but something changed after it was built.
Examples:

- source data has a newer exported timestamp
- pricing rules changed
- source classification rules changed
- a backfill was requested
- a provider report was previously pending and is now ready

```text
incomplete
```

The system could not produce a complete canonical answer for the day. Examples:

- Singular source split is still preparing
- Adapty proceeds are unavailable
- ViewsBase rows are unavailable
- UGC Pay inputs are missing or partially loaded

Incomplete days should not fabricate missing facts. In particular, the system
must not infer organic/UGC proceeds by subtracting incomplete paid rows from a
period total.

```text
superseded
```

The version is no longer current because a later successful version replaced it.

## Source Data And Provenance

Each day version should record enough provenance to explain the facts it
published. At minimum, store:

- provider name
- provider report id or cache key when available
- source date range requested
- source generated/exported timestamp when available
- source status
- source warnings
- source row counts or aggregate checksums

Provider adapters should normalize external data into canonical facts. They
should not expose provider-specific quirks to page-level report code.

Initial adapters:

- Adapty Analytics Export for total, new, renewal, and attributed proceeds.
- Singular source report for paid/source proceeds split.
- Adapty Ads Manager for Apple Search Ads spend, installs, and proceeds where
  available.
- UGC Pay for creator pay and UGC payable views.
- ViewsBase for faceless views, base spend, and fee components.
- Local pricing/config rules for management fees and dashboard fees.

## Pricing And Config Versioning

Cost logic is a versioned input to the daily build.

Examples:

- Larsie: 500 USD fixed monthly fee plus 10 percent CPM management fee.
- Mads: 20 percent CPM management fee.
- Dashboard subscription: 250 USD fixed monthly fee.
- ViewsBase campaign CPM/base rules.
- UGC creator fixed and CPM/video pay rules.

When pricing or source classification changes, affected current days should be
marked stale. A recompute should create a new day version with the new
pricing/config version. The prior version remains available for audit.

## Pending Source Behavior

The canonical layer must be snapshot-first.

If a provider is pending or temporarily unavailable:

- do not publish guessed replacement facts
- do not overwrite a current successful version with zeros
- record the attempted rebuild as pending, incomplete, or failed
- keep the last successful current version visible, marked stale if relevant
- expose warnings so the UI can say which source is blocking freshness

This is especially important for Singular source proceeds. If Singular is still
preparing a source split, organic/UGC proceeds should be unavailable or stale,
not fabricated from partial rows.

## Proposed Persistence Model

Implementation can choose exact table names, but the database needs these
concepts.

### Reporting day version

One row per organization/date/version.

Suggested fields:

- `id`
- `organizationId`
- `reportDate`
- `version`
- `status`: `running`, `succeeded`, `incomplete`, `failed`, `superseded`
- `freshness`: `fresh`, `stale`, `incomplete`, `superseded`
- `isCurrent`
- `pricingConfigVersion`
- `sourceConfigVersion`
- `sourceState`
- `warnings`
- `error`
- `createdAt`
- `completedAt`

### Reporting daily fact

One row per metric/dimension inside a day version.

Suggested fields:

- `id`
- `dayVersionId`
- `organizationId`
- `reportDate`
- `metricKey`
- `value`
- `unit`
- `currency`
- `source`
- `bucket`
- `dimensions`
- `provenance`
- `createdAt`

Facts belong to a day version. Current reporting queries read facts from the
current successful day versions for the requested range.

## Proposed API Shape

Read endpoints:

```text
GET /api/org/[organizationSlug]/reporting/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
GET /api/org/[organizationSlug]/reporting/daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
GET /api/org/[organizationSlug]/reporting/source-breakdown?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

Refresh endpoint:

```text
POST /api/org/[organizationSlug]/reporting/refresh
```

Read responses should include:

- requested date range
- included day versions
- missing days
- incomplete days
- stale days
- warnings
- source statuses
- generated totals

The refresh endpoint should trigger or resume canonical day builds. It should
return the build status and should not block indefinitely on slow external
providers.

## Page Migration

The first consumers should be:

- Revenue
- UGC Status
- revenue profitability panels

Those pages should stop directly combining Adapty, Singular, UGC Pay, and
ViewsBase in page-specific loaders. They should call canonical reporting reads
and display the freshness/warning state returned by the canonical layer.

Existing provider-specific pages can continue to use direct adapters where they
are explicitly diagnostic, such as raw TikTok or raw ViewsBase views.

## Acceptance Criteria

- A selected date range reconciles to the sum of its current daily versions.
- Revenue and UGC Status show the same UGC/organic proceeds for the same date
  range.
- A pending Singular export cannot cause organic/UGC proceeds to be fabricated.
- Recomputing a day creates a new version and preserves the old version.
- A pricing change can mark affected days stale before recompute.
- The UI can tell the user whether each displayed range is fresh, stale,
  incomplete, or partially missing.
- The system can explain which source and config version produced a displayed
  number.
