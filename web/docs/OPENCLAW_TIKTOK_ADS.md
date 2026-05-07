# OpenClaw TikTok Ads Access

This repo includes a standalone CLI for OpenClaw to inspect and manage TikTok
Business ads through the saved advertiser account in Supabase.

## Local CLI

Run from the repo root:

```bash
npm run tt:ads -- help
npm run tt:ads -- env-check
npm run tt:ads -- accounts --org <organization-slug>
npm run tt:ads -- doctor --org <organization-slug>
```

The CLI loads environment variables from `web/.env`, `web/.env.local`, and the
local Vercel env files. It expects:

- `TIKTOK_BUSINESS_BASE_URL`
- `TIKTOK_APP_ID`
- `TIKTOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SK`

It reads the saved `OrganizationTikTokAccount` row to get the advertiser ID and
TikTok access token. Tokens are redacted in command output.

## Install Into OpenClaw

```bash
npm run openclaw:install-tiktok-ads -- \
  --host ubuntu@187.77.26.142 \
  --container openclaw-rujh-openclaw-1 \
  --default-org <organization-slug>
```

This installs:

- `/data/.openclaw/bin/tt-ads`
- `/data/.openclaw/skills/tiktok-ads/SKILL.md`
- `/data/.openclaw/credentials/tiktok-ads.env`

The credential file is installed with `chmod 600`. By default write commands are
enabled at the environment gate, but every mutation still dry-runs unless the
caller adds `--execute`. Pass `--read-only` to the installer to prevent writes
even when `--execute` is used.

## Common Bot Commands

Read-only:

```bash
/data/.openclaw/bin/tt-ads doctor --org <organization-slug>
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bledar"
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bleder" --preview
/data/.openclaw/bin/tt-ads search --org <organization-slug> --query "bledar" --campaign "Scaling Campaign" --adgroup "Feet and inches" --preview
/data/.openclaw/bin/tt-ads ad-preview --org <organization-slug> --ad-id <regular-ad-id>
/data/.openclaw/bin/tt-ads smart-plus-capabilities --org <organization-slug>
/data/.openclaw/bin/tt-ads smart-plus-ad-get --org <organization-slug> --ad-id <regular-ad-id>
/data/.openclaw/bin/tt-ads identities --org <organization-slug> --identity-type BC_AUTH_TT --query "creator name or handle"
/data/.openclaw/bin/tt-ads identity-video-info --org <organization-slug> --identity-id <id> --identity-type BC_AUTH_TT --identity-authorized-bc-id <business-center-id> --item-id <tiktok-item-id>
/data/.openclaw/bin/tt-ads identity-videos-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads spark-videos --org <organization-slug> --creator "creator name or handle" --active-only
/data/.openclaw/bin/tt-ads spark-api-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads spark-authorizations --org <organization-slug> --active-only
/data/.openclaw/bin/tt-ads spark-unlaunched --org <organization-slug> --creator "creator name or handle"
/data/.openclaw/bin/tt-ads campaigns --org <organization-slug> --limit 50
/data/.openclaw/bin/tt-ads adgroups --org <organization-slug> --limit 50
/data/.openclaw/bin/tt-ads ads --org <organization-slug> --limit 50
/data/.openclaw/bin/tt-ads report --org <organization-slug> --start YYYY-MM-DD --end YYYY-MM-DD --dimensions stat_time_day,campaign_id,adgroup_id,ad_id --metrics spend,impressions,clicks,conversion
```

Dry-run write:

```bash
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org <organization-slug> --source-ad-id <regular-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id>
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org <organization-slug> --source-smart-plus-ad-id <smart-plus-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id> --confirm-parent-move
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org <organization-slug> --source-ad-id <regular-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id> --creative-scope enabled-bundle
/data/.openclaw/bin/tt-ads smart-plus-material-status --org <organization-slug> --smart-plus-ad-id <smart-plus-ad-id> --ad-material-id <ad-material-id> --status DISABLE
/data/.openclaw/bin/tt-ads adgroup-status --org <organization-slug> --adgroup-id <id> --status DISABLE
/data/.openclaw/bin/tt-ads campaign-create --org <organization-slug> --name "New Campaign" --objective TRAFFIC --budget-mode BUDGET_MODE_TOTAL --budget 50
/data/.openclaw/bin/tt-ads adgroup-create --org <organization-slug> --campaign-id <id> --name "New Ad Group" --body '{"promotion_type":"WEBSITE","placement_type":"PLACEMENT_TYPE_AUTOMATIC"}'
/data/.openclaw/bin/tt-ads creative-upload --org <organization-slug> --type video --file /path/to/creative.mp4
/data/.openclaw/bin/tt-ads ad-create --org <organization-slug> --adgroup-id <id> --name "New Ad" --body '{"creatives":[{"ad_text":"Try it today"}]}'
/data/.openclaw/bin/tt-ads spark-launch-plan --org <organization-slug> --tiktok-item-id <tiktok-item-id> --source tiktok-api --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
/data/.openclaw/bin/tt-ads spark-launch-plan --org <organization-slug> --tiktok-item-id <tiktok-item-id> --source identity-api --creator "creator name or handle" --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
/data/.openclaw/bin/tt-ads spark-launch-plan --org <organization-slug> --authorization-id <spark-authorization-id> --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
```

Execute after explicit confirmation:

```bash
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org <organization-slug> --source-ad-id <regular-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id> --execute
/data/.openclaw/bin/tt-ads adgroup-status --org <organization-slug> --adgroup-id <id> --status DISABLE --execute
/data/.openclaw/bin/tt-ads spark-launch --org <organization-slug> --tiktok-item-id <tiktok-item-id> --source tiktok-api --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id> --execute
/data/.openclaw/bin/tt-ads spark-launch --org <organization-slug> --authorization-id <spark-authorization-id> --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id> --execute
```

## Spark Authorization Launch Workflow

Use this flow when the user wants to find creator posts that are already Spark
authorized but not yet running as ads.

1. List live TikTok Spark authorizations first. This reads TikTok's
`/tt_video/list/` endpoint and can return active Spark posts even when the
local `SparkAuthorization` table is empty:

```bash
/data/.openclaw/bin/tt-ads spark-videos --org gotall --creator "bledar" --active-only
/data/.openclaw/bin/tt-ads spark-api-unlaunched --org gotall --creator "bledar"
```

Use the local database commands only as a secondary source:

```bash
/data/.openclaw/bin/tt-ads spark-authorizations --org gotall --active-only
/data/.openclaw/bin/tt-ads spark-unlaunched --org gotall --creator "bledar"
```

2. Also check pullable creator identity videos. These come from
`/identity/video/get/` for `BC_AUTH_TT` identities and can include creator
videos that are Spark-usable but not returned by `/tt_video/list/`:

```bash
/data/.openclaw/bin/tt-ads identity-videos-unlaunched --org gotall --creator "bledar"
```

Do not answer "none" for a creator until both `spark-api-unlaunched` and
`identity-videos-unlaunched` have been checked.

3. If needed, inspect identities and a specific creator post:

```bash
/data/.openclaw/bin/tt-ads identities --org gotall --identity-type BC_AUTH_TT --query "bledar"
/data/.openclaw/bin/tt-ads identity-video-info --org gotall --identity-id <identity-id> --identity-type BC_AUTH_TT --identity-authorized-bc-id <business-center-id> --item-id <tiktok-item-id>
```

4. Pick a known working regular ad as the template. The launch command copies
safe creative fields from that template, then swaps in Spark identity fields.
For a move/copy of one existing Spark creative, prefer the source ad as the
template so the payload preserves the source creative text, CTA, app fields,
and format.

5. Dry-run the launch. Prefer `--source tiktok-api` when the Spark post came
from `spark-videos`, and `--source identity-api` when it came from
`identity-videos-unlaunched`:

```bash
/data/.openclaw/bin/tt-ads spark-launch-plan --org gotall --tiktok-item-id <tiktok-item-id> --source tiktok-api --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
/data/.openclaw/bin/tt-ads spark-launch-plan --org gotall --tiktok-item-id <tiktok-item-id> --source identity-api --creator "bledar" --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
/data/.openclaw/bin/tt-ads spark-launch-plan --org gotall --authorization-id <spark-authorization-id> --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id>
```

Use `--creative JSON` for first-creative overrides such as `ad_text`,
`call_to_action`, or `landing_page_url`. Use `--body JSON` for top-level ad
create fields. The command refuses to create a duplicate when the same
`tiktok_item_id` already appears in TikTok ad metadata unless
`--allow-duplicate` is explicitly passed.

For bot behavior, "show me the plan", "plan first", "dry run", and similar
phrases mean the agent should run `spark-launch-plan` and show the generated
payload. It should not stop at the command string. `spark-launch-plan` is the
non-mutating plan; only `spark-launch --execute` needs separate confirmation.

If `spark-launch --execute` fails, stop additional live write attempts. Do not
retry guessed variants with different `--creative`, `--body`, `ad_format`,
CTA, template, or destination values. Diagnose with read-only commands and show
a new dry-run payload for confirmation before another execute.

If a dry-run plan fails only because the Spark item already exists in another
ad, and the user explicitly asked to place that same item into another named
campaign or ad group, rerun `spark-launch-plan` with `--allow-duplicate` and
show the generated payload. Reserve duplicate execution for an explicit
confirmation of duplicate intent, destination, template ad, and payload.

6. Execute only after the user confirms the exact authorization or TikTok item,
destination, template, and full generated `/ad/create/` payload:

```bash
/data/.openclaw/bin/tt-ads spark-launch --org gotall --tiktok-item-id <tiktok-item-id> --source tiktok-api --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id> --execute
/data/.openclaw/bin/tt-ads spark-launch --org gotall --authorization-id <spark-authorization-id> --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id> --execute
```

For batch review, use dry-run only:

```bash
/data/.openclaw/bin/tt-ads spark-bulk-launch-plan --org gotall --template-ad-id <working-ad-id> --dest-adgroup-id <destination-adgroup-id> --limit 10
```

## Smart+ Move Workflow

Use this flow when a user says they want to move an ad, such as moving a
creative from "The Lab" into "Scaling Campaign" / "Feet and inches".

When the user names one ad or creative inside a Smart+ bundle, search for the
matching regular ad and use `--source-ad-id`. Do not use
`--source-smart-plus-ad-id` for that request: parent Smart+ moves are refused
unless `--confirm-parent-move` is passed, because that path disables the whole
Smart+ parent/bundle.

1. Search for the creative and the destination context. Search is typo-
   tolerant by default (`--match fuzzy`):

```bash
/data/.openclaw/bin/tt-ads search --org gotall --query "bleder" --preview
/data/.openclaw/bin/tt-ads search --org gotall --query "feet and inchs" --preview
```

2. If there are multiple plausible candidates, send the user a compact list
   with campaign, ad group, ad name, `adId`, `smartPlusAdId`, TikTok item IDs,
   and preview links. Then inspect the selected source:

```bash
/data/.openclaw/bin/tt-ads smart-plus-ad-get --org gotall --ad-id <regular-ad-id>
/data/.openclaw/bin/tt-ads ad-preview --org gotall --ad-id <regular-ad-id>
```

3. Dry-run the move:

```bash
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org gotall --source-ad-id <regular-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id>
```

4. Execute only after the user confirms the exact source ad, destination ad
   group, and source action:

```bash
/data/.openclaw/bin/tt-ads smart-plus-ad-move --org gotall --source-ad-id <regular-ad-id> --dest-adgroup-id <destination-smart-plus-adgroup-id> --execute
```

Smart+ does not use an in-place move endpoint here. The CLI creates an
equivalent Smart+ ad in the destination Smart+ ad group, verifies that new ad,
then applies the source action. When the source is `--source-ad-id`, the default
move source action disables only the selected Smart+ creative material through
`/smart_plus/ad/material_status/update/` when the source is an upgraded Smart+
regular ad. When the source is only `--source-smart-plus-ad-id`, the default
source action disables that Smart+ parent through
`/smart_plus/ad/status/update/`. Use `--source-action keep` only when the user
wants a copy/duplicate instead of a move. The move flow does not delete the
source.

When a user names one ad inside a Smart+ bundle, pass `--source-ad-id`; the CLI
defaults to `--creative-scope source-ad` and copies only that selected
`tiktok_item_id`. A move then disables only that selected source creative by its
matching `ad_material_id`. Use `--creative-scope enabled-bundle` only when the
user wants the whole enabled Smart+ bundle. `--creative-scope full-bundle`
includes disabled materials and should be rare.

The move command refuses to create a duplicate if the destination already has
the selected TikTok item. In that case, verify the destination and use
`smart-plus-material-status` only if the source material still needs to be
paused.

## Search And Preview

`search` defaults to `--match fuzzy`, which handles small typos by comparing
tokens with edit-distance scoring. Use `--match contains` for the old substring
behavior, or `--match exact` when the user gave a precise ID.

`--preview` adds a best-effort creative preview packet to each search result:
TikTok item player links, video IDs, image IDs, and the relevant ad path. These
links are not official Ads Manager rendered previews. TikTok Help Center notes
that Smart+ shareable URL preview is not available; use Ads Manager QR or User
ID preview for official Smart+ rendering when necessary.

## Safety Rules

- Always query current delivery before changing status or budget.
- For ambiguous names like "Bledar", run `search --preview` and confirm the
  returned campaign, ad group, regular `adId`, `smartPlusAdId`, TikTok item
  IDs, and preview links.
- Use `smart-plus-ad-move` for Smart+ moves instead of hand-building raw
  `/smart_plus/ad/create/` calls.
- For creation, build from a dry-run payload and a nearby working campaign,
  adgroup, and ad when possible.
- Prefer disabling over deleting.
- Use dry-run output as the change plan.
- Only add `--execute` after the user confirms exact IDs and operation.
- For new ads, only add `--execute` after the user confirms the full payload:
  budget, schedule, targeting, creative IDs, URL, pixel or event settings,
  identity, and CTA where applicable.
- Never paste access tokens, refresh tokens, app secrets, Supabase keys, or raw
  credential rows into chat.
