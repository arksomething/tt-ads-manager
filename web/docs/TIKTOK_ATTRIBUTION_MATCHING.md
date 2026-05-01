# TikTok Attribution Matching

This app treats TikTok paid attribution as exact only when the paid-side TikTok post
ID matches the viral.app video ID.

## Primary Match

The preferred join is:

```txt
TikTok reporting item_id == viral.app sourceVideoId/platformVideoId
```

In the code this is surfaced as the `report_item_id` attribution source. The TikTok
ad ID is only the paid ad container; it is useful for diagnostics, but it is not the
viral.app video ID and should not be used as the primary post match key.

When TikTok reporting does not expose `item_id`, the app falls back to exact post IDs
from TikTok ad metadata and Singular, including Singular `tiktok_post_id`. Caption,
thumbnail, CDN URL, and frame-hash matching are diagnostic tools only unless we add
an explicit manual-review workflow.

## Known-Good Test Post

Use this xCynu post to test exact matching:

```txt
viral.app/TikTok post ID: 7630510353943727391
account: @xcynu_
caption: 5 signs your growth plates are not yet closed #heightincrease #SelfImprovement #puberty #fyp
published: 2026-04-19
```

TikTok Ads API metadata for the matching ad:

```txt
ad_id: 1863027734391857
adgroup_id: 1863028251381874
tiktok_item_id: 7630510353943727391
ad text/name: 5 signs your growth plates are not yet closed #heightincrease #selfimprovement #puberty #fyp
created: 2026-04-20 22:02:41
status: AD_STATUS_DELIVERY_OK
```

Expected behavior:

```txt
Date window 2026-04-19 to 2026-04-28:
  Should match by report_item_id.
  Observed TikTok reporting totals: $237.19 spend, 98,503 video_play_actions, 99,444 impressions.

Date window 2026-04-08 to 2026-04-15:
  Should not show paid delivery for this post.
  The post and ad were created after this window.
```

## Control Non-Match

Do not use this older xCynu post as the positive test case:

```txt
viral.app/TikTok post ID: 7625072718483836191
caption: Use @GoTall to maximize your growth #SelfImprovement #puberty #heightincrease #jordanbarrett
published: 2026-04-05
```

This post is from the same TikTok account, but the paid rows we inspected pointed to
other TikTok item IDs. CDN URL tokens and sampled-frame hashes did not match this
post, so it is a useful negative/control case.
