# ViewsBase API Exploration

Last verified: May 9, 2026

This note documents the private ViewsBase dashboard API observed from a logged-in browser session.

## Auth

- The API is authenticated.
- Anonymous requests to private endpoints return `403 {"error":"Unauthorized"}`.
- Auth is cookie-based, not a public bearer-token API.
- The logged-in dashboard stores a Supabase session cookie on `www.viewsbase.com`:
  - `sb-euxaarvxbpiaipzmlesu-auth-token`
- Replay test result:
  - session cookie only -> `200`
  - session cookie + `x-org-slug: gotall` -> `200`
  - `x-org-slug: gotall` only -> `403`

Implication: if we want to script against the existing private API, the simplest path is to run from an authenticated browser context or reuse the session cookie from a logged-in browser session.

## Per-Video Views

The main endpoint for views per video is:

```text
GET /api/dashboard/videos?page=1&limit=100&campaign_id=<CAMPAIGN_ID>
```

Observed live example:

```text
GET https://www.viewsbase.com/api/dashboard/videos?page=1&limit=100&campaign_id=2b159597-fe50-4ce3-b4c2-77192c0e9518
```

Useful fields in each `videos[]` row:

- `id`
- `url`
- `posted_at`
- `current_views`
- `likes`
- `comments`
- `shares`
- `status`
- `finalized_views`
- `finalized_amount`
- `paid_at`
- `payment_reference`
- `updated_at`
- `platform_post_id`
- `influencer.name`
- `influencer.handle`
- `campaign.name`
- `campaign.slug`

This is the endpoint to use for a daily "views per video" report.

## Other Confirmed Endpoints

- `GET /api/stats?campaign_id=<CAMPAIGN_ID>`
  - Top-line totals like `totalVideos`, `totalPending`, `totalPaid`
- `GET /api/analytics/campaign?campaign_id=<CAMPAIGN_ID>&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`
  - Overview analytics, daily time series, per-creator daily series, top creators, top videos
- `GET /api/payment-summary?campaign_id=<CAMPAIGN_ID>`
  - Per-creator payout summary
- `GET /api/admin/influencers?campaign_id=<CAMPAIGN_ID>`
  - Creator roster and deal config
  - Contains sensitive data like `access_code`; do not expose this raw
- `GET /api/tiktok-thumbnail?videoId=<PLATFORM_POST_ID>`
  - Returns a signed image URL for thumbnails

## Known Caveats

- The endpoints are not fully aligned in real time.
- On April 22, 2026:
  - `/api/stats` returned `81` total videos
  - `/api/analytics/campaign` returned `78` total videos
  - `/api/analytics/campaign.meta.last_updated` was `2026-04-21T18:04:46.259+00:00`
- `/api/stats.totalPending` and the sum of `/api/payment-summary.summary[].total_pending` did not match in the live trace.

Implication: for operational reporting, trust:

- `/api/dashboard/videos` for raw per-video rows
- `/api/payment-summary` for payout summaries
- `/api/analytics/campaign` for charts/trends only, with freshness checks

## Example Extraction

If you already have a valid session cookie, this shape extracts a simple per-video view report:

```bash
curl 'https://www.viewsbase.com/api/dashboard/videos?page=1&limit=100&campaign_id=<CAMPAIGN_ID>' \
  -H "Cookie: sb-euxaarvxbpiaipzmlesu-auth-token=<SESSION_COOKIE>" \
  | jq -r '.videos[] | [.influencer.handle, .platform_post_id, .current_views, .status, .updated_at, .url] | @csv'
```

## Recommended Use

- Pull `/api/dashboard/videos` on a schedule
- Store a daily snapshot locally or in a database
- Compute deltas from snapshots instead of trusting the dashboard analytics cache
- Join with `/api/payment-summary` when you need payout rollups

## Repo Integration Notes

The local app now includes a ViewsBase sync path in the Videos workspace.

- Configure `VIEWSBASE_SESSION_COOKIE_VALUE` in the server env
- Optional:
  - `VIEWSBASE_BASE_URL`
  - `VIEWSBASE_SESSION_COOKIE_NAME`
  - `VIEWSBASE_DEFAULT_ORG_SLUG`
- Use the `ViewsBase Sync` form on `/org/<organizationSlug>/videos`
- Synced rows are tagged as `ViewsBase` in the local video list
- Payout pricing treats ViewsBase rows as a separate source:
  - `0.5` CPM
  - `$100` per-video cap
  - no fixed fee

The app also includes a live faceless report:

- Page: `/org/<organizationSlug>/faceless`
- JSON: `/api/org/<organizationSlug>/viewsbase/faceless?orgSlug=gotall&campaignSlug=all&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- Defaults:
  - `orgSlug`: `VIEWSBASE_DEFAULT_ORG_SLUG` or `gotall`
  - `campaignSlug`: `all`
- The page parses the authenticated ViewsBase campaign list and supports a campaign dropdown with `All campaigns` plus each individual campaign.
- The page uses:
  - `/api/stats` for headline payment totals
  - `/api/analytics/campaign` for daily views and creator daily series
  - `/api/dashboard/videos` for all raw video rows and effective CPM values
  - `/api/payment-summary` for payout rollups
- Daily spend is projected from ViewsBase creator daily views plus the effective CPM values exposed on raw video rows. Use raw video rows and stored snapshots for audited final deltas.
