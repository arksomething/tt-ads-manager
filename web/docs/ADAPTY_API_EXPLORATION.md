# Adapty API Exploration

Last verified: May 9, 2026

This note separates the documented Adapty Analytics Export API from the
dashboard-only Adapty Ads Manager API observed in the public browser bundle.

## Documented Analytics Export API

Adapty documents the analytics endpoint:

```text
POST https://api-admin.adapty.io/api/v1/client-api/metrics/analytics/
Authorization: Api-Key <ADAPTY_SECRET_API_KEY>
```

This is already wired in the app through `ADAPTY_API_KEY`.

Useful chart IDs confirmed by docs include:

- `revenue`
- `installs`
- `trials_new`
- `subscriptions_new`
- `refund_money`
- `non_subscriptions`

Useful segmentations include:

- `period`
- `attribution_source`
- `attribution_channel`
- `attribution_campaign`
- `attribution_adgroup`
- `attribution_adset`
- `attribution_creative`

Live probe for May 3, 2026 to May 9, 2026, re-run on May 9, 2026:

- `revenue` by `period`: `200`, about `780ms`
- `revenue` by `attribution_source`: `200`, about `567ms`
- `revenue` by `attribution_channel`: `200`, about `540ms`
- `spend` by `period`: `404`, not a valid Analytics Export chart

Returned revenue containers included `revenue`, `proceeds`, and `net_revenue`.
The local app intentionally uses `proceeds` when available.

## Dashboard Ads Manager API

The Adapty dashboard bundle currently exposes a separate Ads Manager API root:

```text
https://api-asa-admin.adapty.io/api/v1
```

Anonymous probe:

```text
POST /asa-metadata/campaigns/
-> 403 {"errors":[{"message":"Not authenticated", ...}]}
```

This means the normal `ADAPTY_API_KEY` is not enough for Ads Manager tables.
The dashboard client uses browser auth instead:

- bearer token from `adapty_auth_token` cookie or `localStorage["adapty/token"]`
- app id from `localStorage["adapty_current_app_id"]`
- company id from `localStorage["adapty/companyId"]`
- request headers:
  - `Authorization: Bearer <dashboard token>`
  - `ADAPTY_DASHBOARD_APP_ID: <app id>`
  - `ADAPTY_DASHBOARD_COMPANY_ID: <company id>`

Important path detail: the dashboard API is slash-sensitive. The public bundle
usually appends a trailing slash to requests. For example,
`/asa-metadata/campaigns` can return `404`, while `/asa-metadata/campaigns/`
reaches the auth gate and returns `403` if the bearer token is missing.

Auth behavior tested against Ads Manager endpoints:

```text
No Authorization header -> 403 Not authenticated
Authorization: Api-Key <ADAPTY_API_KEY> -> 403 Invalid authentication credentials
Authorization: Bearer null -> 401 Authorization token is invalid
Authorization: Bearer <dashboard token> + app/company headers -> 200 for campaign list
```

## Observed Ads Manager Endpoints

Endpoint strings observed in the public dashboard bundle:

```text
POST /asa-metadata/campaign-groups/
POST /asa-metadata/campaigns/
POST /asa-metadata/ad-groups/
POST /asa-metadata/ads/
POST /asa-metadata/targeting-keywords/
POST /asa-metadata/negative-keywords/
POST /asa-metadata/search-terms/v3/
POST /asa-metadata/campaigns/metrics/
POST /asa-metadata/ad-groups/metrics/
POST /asa-metadata/targeting-keywords/metrics/
POST /asa-metadata/v3/campaign/metrics/total
POST /asa-metadata/v3/ad-group/metrics/total
POST /asa-metadata/v3/keyword/metrics/total
POST /asa-metadata/v4/ad/metrics/total
POST /asa-metadata/resolve-entities
POST /asa-metadata/apps-info
```

The campaign/ad group/keyword list APIs appear to back the dashboard tables.
The `metrics` APIs appear to back spend, installs, CPI, trials, paid, revenue,
and ROAS-style columns.

### Tested List Endpoints

These auth-gate probes were tested with the known app id and company id, but
without a valid dashboard bearer token:

```text
POST /asa-metadata/campaign-groups/ -> 403 Not authenticated
POST /asa-metadata/campaigns/ -> 403 Not authenticated
POST /asa-metadata/ad-groups/ -> 403 Not authenticated
POST /asa-metadata/ads/ -> 403 Not authenticated
POST /asa-metadata/search-terms/v3/ -> 403 Not authenticated
```

The list request shape used by the dashboard appears to be a JSON POST with a
`filters` object. Minimal probe body:

```json
{
  "filters": {
    "date": ["2026-05-03", "2026-05-09"]
  }
}
```

The table UI likely sends additional pagination, sorting, and column metadata.
Capture the browser network request before finalizing the exact production
payload.

With a valid dashboard bearer token plus `ADAPTY_DASHBOARD_APP_ID` and
`ADAPTY_DASHBOARD_COMPANY_ID`, the same campaign list endpoint returned:

```text
POST /asa-metadata/campaigns/ -> 200
root fields: meta, data
rows for May 3, 2026 to May 9, 2026: 5
row fields: internal_id, internal_campaign_group, internal_app, campaign, metrics
metric fields include: impressions, taps, ttr, avg_cpt, avg_cpm, local_spend,
total_installs, total_new_downloads, total_redownloads, view_installs,
tap_installs
```

### Tested Metrics Endpoint

The campaign metrics endpoint reached the auth gate:

```text
POST /asa-metadata/campaigns/metrics/ -> 403 Not authenticated
```

Observed dashboard bundle shape for ad-group metrics:

```js
{
  filters: {
    date: {
      startDate: "YYYY-MM-DD",
      endDate: "YYYY-MM-DD"
    },
    ids: ["<entity id>"],
    metrics: ["spend", "revenue", "roas", "installs", "trials", "paid"]
  }
}
```

Live authenticated probes showed the metrics APIs are stricter than the rough
bundle-derived shape:

```text
POST /asa-metadata/campaigns/metrics/
filters.metrics: ["spend", "revenue", "roas", "installs", "trials", "paid"]
-> 422, because these are not the accepted enum values

POST /asa-metadata/campaigns/metrics/
filters.metrics: ["revenue", "revenue_proceeds", "revenue_net"]
-> 500, with an empty response body
```

The campaign total endpoint is slash-sensitive and expects `date_from` /
`date_to` rather than the list endpoint's date tuple:

```text
POST /asa-metadata/v3/campaign/metrics/total -> 404 Not Found

POST /asa-metadata/v3/campaign/metrics/total/
{
  "filters": {
    "date_from": "2026-05-03",
    "date_to": "2026-05-09",
    "ids": ["<campaign internal_id>"],
    "metrics": ["revenue", "revenue_proceeds", "revenue_net"]
  }
}
-> 200
```

The total response returned `data` fields including `revenue`,
`adapty_installs`, `spend`, `roas`, `roi`, `subscriptions_started`,
`trials_started`, `trials_converted`, `non_subscriptions`,
`cost_per_adapty_install`, and `cost_per_trial`.

### Endpoint Purpose Map

```text
/asa-metadata/campaign-groups/         Campaign group dropdown/list
/asa-metadata/campaigns/               Campaign table rows
/asa-metadata/ad-groups/               Ad group table rows
/asa-metadata/ads/                     Ad table rows
/asa-metadata/targeting-keywords/      Keyword table rows
/asa-metadata/negative-keywords/       Negative keyword table rows
/asa-metadata/search-terms/v3/         Search terms table rows
/asa-metadata/*/metrics/               Time-series or row metrics
/asa-metadata/v*/.../metrics/total     Summary cards and total columns
/asa-metadata/resolve-entities/        Resolve ids to display entities
/asa-metadata/apps-info/               App metadata used by Ads Manager
```

## Recommended Integration Path

Use the documented Analytics Export API for revenue, proceeds, installs, trials,
and attribution breakdowns wherever possible. It is stable and key-based.

Use the dashboard Ads Manager API only as an authenticated browser-surface
integration, similar to ViewsBase:

1. Store the dashboard bearer token, company id, and app id in server env.
2. Keep raw dashboard responses server-side; do not expose full payloads to the
   client.
3. Cache responses by date window, entity type, filters, and selected columns.
4. Treat dashboard endpoints as brittle because Adapty can change them without
   API-version notice.

Suggested env names if implemented:

```text
ADAPTY_DASHBOARD_BASE_URL="https://api-asa-admin.adapty.io/api/v1"
ADAPTY_DASHBOARD_TOKEN=""
ADAPTY_DASHBOARD_COMPANY_ID=""
ADAPTY_DASHBOARD_APP_ID=""
```

## Browser Extraction

From a logged-in Adapty dashboard tab, the needed values can be inspected in the
browser console:

```js
({
  token: localStorage.getItem("adapty/token"),
  appId: localStorage.getItem("adapty_current_app_id"),
  companyId: localStorage.getItem("adapty/companyId"),
})
```

If `token` is empty, inspect the `adapty_auth_token` cookie for `app.adapty.io`.
