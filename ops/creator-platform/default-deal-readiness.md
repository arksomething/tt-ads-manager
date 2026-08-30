# Default creator deal readiness

Status: prospective economics identified; no binding default activated.

The production creator database intentionally contains no active default deal.
Application approval fails closed until an owner-approved term sheet and a
counsel-approved agreement are inserted as one immutable version.

## Strongest observed business candidate

| Term | Prospective default |
| --- | --- |
| Currency | USD |
| Baseline/non-talking content | $0.50 CPM with a $100 per-video CPM cap |
| Qualifying talking content | $1.00 CPM with a $300 per-video CPM cap |
| View window | First seven days after publication |
| Paid traffic | Deduct verified paid impressions |
| Fixed fee | None by default |
| Total creator cap | None by default |

This candidate is documented in
[`deal-restructure-2026-07-20.md`](../../deal-restructure-2026-07-20.md).
It is not yet a complete or internally consistent contract. In particular,
whether `#yap` is merely required or is sufficient for the talking premium,
the exact seven-day cutoff, and Instagram paid-view treatment remain open.

## Why the legacy data cannot be copied as the legal default

The live audit on 2026-08-30 found 105 campaign creators, but only 38 active
explicit deal rows. Twenty-five match the prospective standard tiers and 13 are
special or legacy combinations. The other 67 fall through to the obsolete
`$1 CPM / $100` code default. All 105 still have `dealStatus = LEAD`, every
`agreedRate` is null, and the payout table contains no rows.

The legacy calculator also does not consistently enforce its stored terms:

- the fallback is still `$1/$100` in
  [`queries.ts`](../../web/src/server/ugc-pay/queries.ts);
- the primary calculator uses a request-level view-window setting instead of
  each stored `viewWindowDays` value;
- the paid-traffic metric is stored but the lookup defaults to impressions; and
- creator-facing access currently forces all-view mode instead of the first
  seven days.

Viral.app cannot resolve the monetary terms. Its live account objects contain
tracking identities and posting limits, not CPMs, caps, agreements, or payment
terms. The observed `maxVideos` distribution is 40 accounts at 0, 3 at 10, 36
at 30, 7 at 60, 6 at 100, 1 at 200, and 5 at 300. These limits are a migration
seed for account/campaign configuration, not a creator agreement.

## Decisions required before activation

- contracting entity;
- minors and guardian-signature rules;
- content/platform eligibility and whether cross-posts earn separately;
- talking-content definition, adjudicator, and appeal process;
- seven calendar dates versus an exact 168-hour window;
- TikTok and Instagram organic/paid evidence rules;
- posting quota and any minimum-view threshold;
- payment period, invoice/tax requirements, rail, due date, and minimum payout;
- statement/dispute deadline and treatment of silence;
- treatment of unknown, stale, missing, or disputed tracking;
- content license, Spark/whitelisting rights, compliance, takedown, termination,
  confidentiality, liability, and governing law.

Before payout logic consumes a deal version, the schema also needs immutable,
validated economic rules in addition to the current legal Markdown and hash.
Do not parse rates or caps back out of prose.
