---
name: creator-conversion
description: Investigate whether GoTall creator content converted using same-day view growth and new-customer activity. Use for conversion follow-ups to rankings, specific videos, and creator performance questions; not for calculating payouts.
---

# Creator Conversion

Answer the business question, not just whether direct attribution exists. Missing
purchase-to-video identifiers prevents direct attribution; it does not by itself
prevent a useful statistical investigation. Do not stop after looking up account
profiles and company-wide totals.

## Gather Comparable Evidence

- Resolve "they" or "those videos" from the conversation. Retain its creators and
  period. If the period is unspecified, choose and disclose a reasonable complete
  period. Exclude today's partial data from full-day comparisons.
- Use Viral.app for video/account performance. The owned tracker is a labeled beta
  alternative when coverage is missing, not an automatic replacement. Never use
  the legacy database's Video counters or All Tracked Creators grouping.
- Resolve handles to stable account IDs. Retrieve daily view gains for the target
  accounts/videos and a preceding baseline, not lifetime views or posting counts.
  Older videos can acquire new views today. Do not treat the publication date as
  the date all views occurred.
- With operator access, service_query supports Viral analytics. Consult
  code/web/src/server/videos/queries.ts for routes/parameters. Known routes are
  /analytics/top-accounts and /analytics/top-videos with platforms=tiktok,
  viewMode=internal, publicationMode=allEligible, onlyPublished=false,
  dateRange[from], dateRange[to], metric=viewCountInPeriod; accounts filters by
  provider account ID. Query single-day windows when daily gains are needed.
  Account listing uses /accounts/tracked with page, perPage and platforms, not
  limit/platform. Check pageCount and truncation; narrow/project/paginate rather
  than interpreting an incomplete result as absence or a complete total.
- For a specific TikTok video, video_metrics(video_url, source='viral', day,
  end_day) retrieves a full baseline-plus-target window. source='beta_tracker'
  exposes observations when appropriate. Preserve raw data; derive differences
  only across known timestamps, labeling gaps and never turning missing data into
  zero. Creators use the tools available to their identity; this skill grants no
  access to staff APIs, other creators' private data or write tools.
- Call business_activity(start_date, end_date) once for the same combined window.
  It returns Superwall daily purchase and trial indices. Both are normalized to
  that request's period mean. Do not compare index levels from separately
  normalized requests. Check metric definitions before interpreting purchases as
  new customers; separate renewals and attribute later trial conversions to the
  trial-start cohort, not content posted on the billing day.
- Check other organic view spikes and available paid activity for those dates.
  Operators use service_query for Singular/TikTok reporting with its shared quota
  controls. Respect cooldowns and cached reports. If access or coverage is missing,
  state that confounding remains unresolved; do not infer that paid spend was zero.

## Analyze What Changed

GoTall expects short conversion timing: same-day purchases or trial starts are the
primary signal. Do not introduce a default 24-48-hour attribution window. Flag
timezone/reporting uncertainty when material instead of shifting dates to find a
favorable association.

Identify substantial daily view growth and compare same-day business activity with
a suitable baseline, ordinarily the preceding seven complete days. Prefer matched
weekdays/longer history when available and relevant. Explain baseline limitations.
For a relative index, observed change is 100 * (target / baseline_mean - 1), provided
the baseline is nonzero and both values share the same normalization. This is
observed business change, NOT automatically the creator's conversion lift.

Assess whether the target's view growth is distinct from other creators and paid
activity. Overlapping spikes may support an aggregate signal but cannot assign
the same business increase independently to every creator. Views alone are not
conversions. A dip in aggregate purchases does not prove a video converted nobody.

When enough independent history and variation exist, use a suitable time-series
or regression comparison controlling for trend, weekday, other content and paid
activity. Check collinearity, autocorrelation, outliers and sensitivity to baseline
choice. Report uncertainty only when actually calculated using a defensible method.
Fourteen daily observations with several correlated creators may be insufficient
for individual attribution. Do not invent confidence intervals, precision or a
causal claim. Never describe a simple before/after percentage as attributable lift.

If evidence is insufficient, name the actual missing series, failed request or
overlap that prevented estimation, and what was checked. "No direct attribution"
alone is not a completed investigation.

## Respond Simply

Give each requested creator/video a plain-language conclusion: evidence suggests
conversion, no detectable lift in the available data, or inconclusive. Include the
strongest relevant observation, dates/source and the material caveat. These are
conclusions from the analysis, not mandatory labels or promises of certainty.

Use clickable video links rather than raw IDs. Share relative business changes,
not exact company revenue, profit, revenue-per-view or combinations that reveal
restricted financial totals. Follow the existing verified identity and audience
policy, including restrictions for managers/admins and creator-private records.
Do not expose other creators' earnings. This analysis is not a payout calculation.
