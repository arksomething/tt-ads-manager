---
name: tiktok-ads
description: "Manage TikTok Business ads through the installed tt-ads CLI. Use when the user asks to inspect, search, preview, move, copy, pause, enable, rename, budget, diagnose, launch Spark ads, or report on TikTok campaigns, ad groups, ads, creatives, Smart+ ads, spend, or performance. Also use when text or screenshots mention known TikTok Ads entities such as cheap minor scaling, the gmi mining campaign, The Lab, testing bledar, scaling 18 audience, Bledar/bledar, Korean method, or TikTok-looking 18-19 digit ad/campaign/adgroup IDs. Prefer fuzzy search plus previews before writes; never use browser automation for TikTok ads."
metadata:
  openclaw:
    emoji: "📣"
---

# TikTok Ads Manager

MANDATORY ROUTING RULE: For TikTok ads work, use
`/data/.openclaw/bin/tt-ads` only. Do not use browser, browser profiles,
browser tabs, Playwright, Chromium, screenshots, or web UI automation. Do not
mention browser availability as a blocker for TikTok ads work.

Use this skill when the user asks you to inspect, diagnose, pause, enable,
rename, budget, move, copy, search, or otherwise manage TikTok ads for the
Billion Views / TikTok Ads Manager workspace.

If the user sends a screenshot or terse instruction containing known TikTok Ads
names such as `cheap minor scaling`, `the gmi mining campaign`, `The Lab`,
`testing bledar`, `scaling 18 audience`, `Bledar`, `korean method`, or
TikTok-looking 18-19 digit campaign/ad group/ad IDs, treat it as TikTok Ads
work. Do not ask which platform first; use `tt-ads search --preview` to
identify the exact source and destination.

## Command

Run the installed CLI:

```bash
/data/.openclaw/bin/tt-ads <command> --org <organization-slug>
```

The CLI reads credentials from:

```bash
/data/.openclaw/credentials/tiktok-ads.env
```

Do not print credential values, access tokens, refresh tokens, app secrets, or
Supabase keys. The CLI redacts these from JSON output, but you should still
avoid requesting raw credential rows unless needed.

## Standard Flow

1. Start with a read-only health check:

```bash
/data/.openclaw/bin/tt-ads doctor --org <organization-slug>
```

2. Search for the exact campaign, ad group, ad, or Smart+ ad before changing
   anything. Use names, IDs, and nearby context the user gave you:

```bash
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bledar"
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bleder" --preview
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bledar" --campaign "Scaling Campaign" --adgroup "Feet and inches" --preview
```

Search is typo-tolerant by default (`--match fuzzy`). Do not assume the first
name match is the right entity. Read the returned path, regular `adId`,
`smartPlusAdId`, TikTok item IDs, status, match reasons, and preview links.
Use `--match contains` or `--match exact` when the user gives a precise ID.

3. Inspect current delivery before changing anything:

```bash
/data/.openclaw/bin/tt-ads campaigns --org <organization-slug> --limit 50
/data/.openclaw/bin/tt-ads adgroups --org <organization-slug> --limit 50
/data/.openclaw/bin/tt-ads ads --org <organization-slug> --limit 50
```

4. Pull performance for the exact window the user asked about:

```bash
/data/.openclaw/bin/tt-ads report --org <organization-slug> --start YYYY-MM-DD --end YYYY-MM-DD --dimensions stat_time_day,campaign_id,adgroup_id,ad_id --metrics spend,impressions,clicks,conversion
```

5. For any write, run a dry run first and show the planned request:

```bash
/data/.openclaw/bin/tt-ads adgroup-status --org <organization-slug> --adgroup-id <id> --status DISABLE
```

6. Only add `--execute` after the user explicitly confirms the exact write:

```bash
/data/.openclaw/bin/tt-ads adgroup-status --org <organization-slug> --adgroup-id <id> --status DISABLE --execute
```

## Useful Commands

List saved advertiser accounts:

```bash
/data/.openclaw/bin/tt-ads accounts --org <organization-slug>
```

List TikTok-authorized advertisers for the stored token:

```bash
/data/.openclaw/bin/tt-ads advertisers --org <organization-slug>
```

Search and identify ads:

```bash
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bledar"
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "ad name or item id" --campaign "Campaign name" --adgroup "Ad group name" --preview
/data/.openclaw/bin/tt-ads ad-preview --org <organization-slug> --ad-id <regular-ad-id>
```

When multiple plausible ads are returned, show the user 2-5 compact candidates:
campaign, ad group, ad name, `adId`, `smartPlusAdId`, TikTok item IDs, and
preview links. Ask them to confirm the source before making a move.

Preview output is a best-effort creative packet from API fields and
`tiktok_item_id` player links. It is not an official Ads Manager rendered
preview. For official Smart+ rendering, the user may need Ads Manager QR or
User ID preview.

Inspect Smart+ support and Smart+ source payload:

```bash
/data/.openclaw/bin/tt-ads smart-plus-capabilities --org <organization-slug>
/data/.openclaw/bin/tt-ads smart-plus-capabilities --org <organization-slug> --ad-id <regular-ad-id>
/data/.openclaw/bin/tt-ads smart-plus-ad-get --org <organization-slug> --ad-id <regular-ad-id>
/data/.openclaw/bin/tt-ads smart-plus-ad-get --org <organization-slug> --smart-plus-ad-id <smart-plus-ad-id>
```

Move or copy Smart+ ads. This is dry-run by default:

```bash
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org <organization-slug> --source-ad-id <regular-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id>
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org <organization-slug> --source-smart-plus-ad-id <smart-plus-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id> --confirm-parent-move
/data/.openclaw/bin/tt-ads smart-plus-material-status --org <organization-slug> --smart-plus-ad-id <smart-plus-ad-id> --ad-material-id <ad-material-id> --status DISABLE
```

Smart+ "move" means create an equivalent Smart+ ad in the destination Smart+
ad group, verify the new ad exists in that destination, then apply the source
action. When the source is `--source-ad-id`, the default source action disables
only that selected Smart+ creative material through
`/smart_plus/ad/material_status/update/` when the source is an upgraded Smart+
regular ad. This is the correct "disable this one ad/creative only" path. When
the source is only `--source-smart-plus-ad-id`, the default source action
disables that Smart+ parent through `/smart_plus/ad/status/update/`; this
parent/bundle path is refused unless `--confirm-parent-move` is passed. Use
`--source-action keep` only when the user asks to copy rather than move. Do not
delete the source as part of a move.

When `--source-ad-id` identifies one regular ad inside a Smart+ bundle, the
move command defaults to `--creative-scope source-ad`, meaning it only copies
that selected TikTok item, and a move disables only that selected source
creative by pausing its matching `ad_material_id`. Use `--creative-scope
enabled-bundle` only when the user explicitly wants the whole enabled Smart+
bundle moved. Avoid `--creative-scope full-bundle` unless the user asks for
disabled materials too.
If TikTok rejects a Smart+ move, inspect `creativeSelection` in the dry-run
output before retrying.
If the move command says the destination already contains the selected
creative, do not create another copy. Verify the destination and, if needed,
use `smart-plus-material-status` to disable only the source `ad_material_id`.
If the CLI refuses a parent move, search the named creative and retry with the
regular `--source-ad-id`; do not add `--confirm-parent-move` unless the user
explicitly wants the whole Smart+ bundle moved.

Pause or enable entities:

```bash
/data/.openclaw/bin/tt-ads campaign-status --org <organization-slug> --campaign-id <id> --status ENABLE
/data/.openclaw/bin/tt-ads adgroup-status --org <organization-slug> --adgroup-id <id> --status DISABLE
/data/.openclaw/bin/tt-ads ad-status --org <organization-slug> --ad-id <id> --status DISABLE
```

Update mutable fields:

```bash
/data/.openclaw/bin/tt-ads campaign-update --org <organization-slug> --campaign-id <id> --set '{"budget":50.5}'
/data/.openclaw/bin/tt-ads adgroup-update --org <organization-slug> --adgroup-id <id> --set '{"budget":100}'
/data/.openclaw/bin/tt-ads ad-update --org <organization-slug> --ad-id <id> --set '{"ad_name":"New name"}'
```

Create new entities. These are also dry-run by default:

```bash
/data/.openclaw/bin/tt-ads campaign-create --org <organization-slug> --name "New Campaign" --objective TRAFFIC --budget-mode BUDGET_MODE_TOTAL --budget 50
/data/.openclaw/bin/tt-ads adgroup-create --org <organization-slug> --campaign-id <id> --name "New Ad Group" --body '{"promotion_type":"WEBSITE","placement_type":"PLACEMENT_TYPE_AUTOMATIC"}'
/data/.openclaw/bin/tt-ads creative-upload --org <organization-slug> --type video --file /path/to/creative.mp4
/data/.openclaw/bin/tt-ads ad-create --org <organization-slug> --adgroup-id <id> --name "New Ad" --body '{"creatives":[{"ad_text":"Try it today"}]}'
```

Creation usually needs account-specific fields such as objective, promotion
type, placement, location IDs, pixel, identity, landing page, video/image IDs,
and CTA. If any required TikTok field is unknown, query existing campaigns,
adgroups, and ads first, then build a dry-run payload from a working nearby
example. Do not execute creation until the user confirms the exact dry-run
payload.

Spark authorization launch workflow:

```bash
/data/.openclaw/bin/tt-ads identities --org <organization-slug> --identity-type BC_AUTH_TT --query "creator name or handle"
/data/.openclaw/bin/tt-ads identity-info --org <organization-slug> --identity-id <id> --identity-type BC_AUTH_TT --identity-authorized-bc-id <business-center-id>
/data/.openclaw/bin/tt-ads identity-videos-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads identity-video-info --org <organization-slug> --identity-id <id> --identity-type BC_AUTH_TT --identity-authorized-bc-id <business-center-id> --item-id <tiktok-item-id>
/data/.openclaw/bin/tt-ads spark-videos --org <organization-slug> --creator "creator name or handle" --active-only
/data/.openclaw/bin/tt-ads spark-api-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads spark-authorizations --org <organization-slug> --active-only
/data/.openclaw/bin/tt-ads spark-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads spark-launch-plan --org <organization-slug> --tiktok-item-id <tiktok-item-id> --source tiktok-api --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
/data/.openclaw/bin/tt-ads spark-launch --org <organization-slug> --tiktok-item-id <tiktok-item-id> --source tiktok-api --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
```

For Spark Ads, check TikTok's live authorization APIs before concluding that a
creator post is unavailable. `spark-authorizations` and `spark-unlaunched` read
the local database only; they can be empty even when TikTok has active Spark
authorizations. `spark-videos` reads `/tt_video/list/` and returns live
video-code Spark posts, including `AUTH_CODE` identity fields. Use
`spark-api-unlaunched` to find live TikTok Spark posts that are not present in
current TikTok ad metadata.

Also check creator identity videos for `BC_AUTH_TT` identities. A creator can
have `can_pull_video` access and many pullable Spark posts from
`/identity/video/get/` that are not returned by `/tt_video/list/`.
For questions like "what Bledar Spark videos are authorized?", "new creator
videos not yet in ads", or "authorized but not running", run both:

```bash
/data/.openclaw/bin/tt-ads spark-api-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads identity-videos-unlaunched --org <organization-slug> --creator "creator name or handle"
```

If `identity-videos-unlaunched` returns rows, those are valid pullable creator
identity videos that are not present in current ad metadata. Do not answer
"none" until both the video-code Spark list and the creator identity video list
have been checked.

When a user asks to put a creator Spark post into an existing campaign/ad
group, do not brute-force raw `/ad/create/` payloads. First identify the
destination ad group and a working nearby regular ad as the template. Then run
`spark-launch-plan --source tiktok-api --tiktok-item-id <id>` so the planner
uses TikTok's live Spark authorization fields from `/tt_video/list/`. If the
post came from `identity-videos-unlaunched`, use
`spark-launch-plan --source identity-api --creator <name> --tiktok-item-id <id>`
so the planner uses `BC_AUTH_TT` identity fields from `/identity/video/get/`. Use
`identities`, `identity-info`, and `identity-video-info` to inspect linked
Business Center identities and verify a creator post before planning. If the
dry-run payload needs account-specific creative details, pass `--creative JSON`
for first-creative fields or `--body JSON` for top-level ad create fields. Use
`spark-launch --execute` only after the user confirms the exact TikTok item,
template ad, destination ad group, and generated JSON payload.

When the user asks to move or copy a specific existing Spark creative/ad, use
that source ad as `--template-ad-id` whenever possible so the planner preserves
the source creative text, CTA, app fields, and format. Use a separate nearby
destination ad only as a fallback when the source ad cannot be read or TikTok
requires a destination-compatible template, and show that change in a fresh
dry-run payload before executing.

If the user says "show me the plan", "plan first", "dry run", "preview the
launch", or asks what would be created, run `spark-launch-plan` and show its
generated request payload. Do not stop after showing the command you would run.
`spark-launch-plan` is a no-write dry run and is the expected planning step;
only `spark-launch --execute` requires a separate confirmation.

If any `spark-launch --execute` call fails, stop live writes immediately. Do
not retry additional `--execute` variants with guessed `--creative`, `--body`,
`ad_format`, CTA, or template changes. Use read-only commands such as
`ad-preview`, `spark-launch-plan`, or `raw` GET to diagnose, then report the
exact TikTok error and show a new dry-run plan. A changed payload, changed
template, changed CTA, or changed destination requires fresh user confirmation
before another `--execute`.

The command refuses to launch a Spark item that already appears in existing ad
metadata unless `--allow-duplicate` is explicitly passed. If a
`spark-launch-plan` dry run fails only because duplicate ads already exist, and
the user explicitly asked to place that same TikTok item into another named
campaign or ad group, rerun the dry-run plan with `--allow-duplicate` and show
the generated payload. Do not use `--allow-duplicate` for
`spark-launch --execute` unless the user confirms they intentionally want
another ad for the same TikTok item, plus the exact destination, template ad,
and payload.

Use raw endpoint access only when the canned commands do not cover the task.
For Smart+ moves, use `smart-plus-ad-move`; never hand-build
`/smart_plus/ad/create/` with `raw`. The CLI blocks raw Smart+ create by
default because it bypasses source-action verification and rollback.

```bash
/data/.openclaw/bin/tt-ads raw --org <organization-slug> --method GET --path /open_api/v1.3/campaign/get/ --query '{"fields":["campaign_id","campaign_name"]}'
```

## Guardrails

- Query first, then propose the smallest change.
- For ambiguous user text such as a name, campaign, or ad group, run typo-
  tolerant `search --preview` and identify the exact IDs before acting.
- If search returns multiple plausible ads, send compact preview candidates to
  the user and wait for confirmation.
- For Smart+ moves, run `smart-plus-capabilities` or `smart-plus-ad-get` first,
  then `smart-plus-ad-move` as a dry run.
- Mutations are dry-run by default.
- Never use `--execute` unless the user confirms the exact campaign/adgroup/ad
  IDs and the requested operation.
- A Smart+ move applies the source action only after the destination is
  verified. With `--source-ad-id`, that means disabling the selected Smart+
  material only. If the user wants a duplicate, use `--source-action keep`.
- For creates, never use `--execute` unless the user confirms the full dry-run
  JSON payload, including budget, schedule, targeting, creative IDs, URL, pixel
  or event settings, identity, and CTA where applicable.
- For Spark launches, never use `spark-launch --execute` until
  `spark-launch-plan` has been reviewed and the user confirms the exact Spark
  authorization, template ad, destination ad group, and ad create payload.
- If a Spark launch execute fails, do not brute-force more execute attempts.
  Diagnose with read-only commands and return the TikTok error plus the next
  dry-run payload to confirm.
- Prefer pausing (`DISABLE`) over deleting unless the user explicitly asks for
  deletion.
- Keep output focused on entity IDs, names, status, spend, impressions, clicks,
  conversions, and the reason for any recommendation.
