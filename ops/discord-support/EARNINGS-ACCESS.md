# Creator earnings access

## Owned tracker earnings (September 29, 2026)

Discord Payments and support `my_earnings` now supply a fresh owned-tracker
snapshot to the existing deal calculator. The fixed, root-owned
`owned-earnings-source.py` reader opens the tracker SQLite database read-only,
matches verified native TikTok account IDs, and returns every post in scope,
direct observations, and cutoff finalizations. Neither path calls Viral.app's
top-videos endpoint or uses the legacy `Video` table as its inventory fallback.
Failure to obtain or scope this snapshot fails the refresh; it does not fall
back to a capped provider estimate. Install the reader and loader with the
normal bot installer. The gateway's user service manager runs the reader using
the same host-owner authorization pattern as the existing binding reader.

The shared web calculator accepts this data only as a trusted server argument;
the legacy browser UGC Pay route is a separate provider-based report and is not
silently described as migrated. The canonical PostgreSQL tracker mirror currently
does not contain the SQLite tracker's direct cutoff finalizations, so it is not
used as a substitute for this evidence.

Seven-day windows use publication time plus 168 hours and existing verified
cutoff finalizations. Open windows and review exceptions remain provisional.
Month-boundary splits use the closest direct observation within three hours,
explicitly flagging approximation; missing baselines retain fixed fees but leave
view earnings unpriced. The report saves observation IDs, cutoff status, warnings,
the source hash, and engine fingerprints. Paid traffic is independently queried
from TikTok using the saved deal's metric, clipped to the video's window by UTC
day; intraday paid attribution remains flagged for settlement review. Applicable
GoTall hashtag/content rules, publication-specific deals, overrides and caps
remain in force. Monetary half-cents use consistent decimal rounding.

Opening or refreshing Payments recalculates; an old ephemeral payment card is
still a snapshot. Approved statements and recorded transfers are separate and
are never overwritten or inferred from an earnings refresh.

## On-demand account lookup

An earnings request reads current staff-approved account ownership and current
tracker native IDs, then looks up GoTall CreatorPlatformAccount and CampaignCreator
records. Results are used for that request only. There is no generated mapping
file, background mapping service, database notification trigger or retry schedule.
Missing IDs, missing records and competing ownership prevent a complete estimate;
no identities or compensation terms are guessed. Multiple accounts resolving to
the same payout creator are deduplicated. Legacy verified payout-delivery evidence
remains the authoritative identity source for existing production participants.

The onboarding tracker timer runs every minute in the production runtime following
the September 14 cutover. The status card has Add accounts;
submitted additions require staff approval, preserve stage/deal/existing accounts,
and feed the same tracker pipeline. Multiple profiles on the same platform have
independent tracking state. YouTube/Facebook profiles are accepted but not tracked.

The Add accounts status-card flow is unchanged. Account lookup tests cover current
records, ownership collisions, incomplete accounts, channel scope and deduplication.

## Access boundaries

The my_earnings tool takes only start_date and end_date. Requester identity, guild,
and channel come from the Discord adapter, never from model-supplied creator IDs.
It rechecks channel access, resolves an approved binding, then runs the existing
UGC calculator scoped to that campaign creator and organization. Saved deal periods,
fixed-fee recognition dates, eligible gained views and paid deductions are retained.
It returns an estimate, not settled payment status or an unpaid balance.

Production binding file: /etc/gotall-discord-creator-bindings.json. Shape:

```json
{
  "GUILD_ID": {
    "DISCORD_USER_ID": {
      "channel_id": "PRIVATE_CREATOR_CHANNEL_ID",
      "campaign_creator_id": "VERIFIED_CAMPAIGN_CREATOR_ID",
      "organization_id": "VERIFIED_ORGANIZATION_ID"
    }
  }
}
```

Populate only after verifying stable account ownership and the channel. The runtime
also reads verified-creator-bindings.json from its private state directory. The
import-payout-bindings.py reconciliation uses the existing August settlement and
delivery receipts, resolves database IDs in the same campaign/organization, verifies
the delivered bot attachment, and requires exactly one current nonstaff recipient
with explicit channel access. It does not infer by similar handles. Unlinked
creators receive not_linked, not a guessed identity or zero amount. No production
bindings are inferred by similar names. Existing test-guild bindings are
accepted only in the user's matching onboarding channel and marked test_fixture;
these sample accounts are not the requester's real personal earnings.

Verified Discord Administrator permission (or explicitly configured admin_roles)
grants the existing operator tool set. Founder coloring alone does not. Designated
staff operators and the owner retain existing access. Recheck roles on privileged
calls. Non-owner terminal jobs retain their existing isolation. Analytics connectors
are read-only. Admins can now use creator_deal/publish_creator_deal for typed database
deal reads and versioned publication, not arbitrary SQL or payment execution.
Exact company financial restrictions still apply to admins.

Verified September 14: 15 production recipients linked from the August delivery
batch, with 17 underlying calculator account links. Tallvex and gotallfinalboss
have multiple nonstaff recipients; GoTall Dan's channel/delivery is unavailable.
Other recipients outside this delivery batch are not automatically covered.
A real September 11-13 calculation succeeded using a production creator's verified
Discord permission and database mapping (test_fixture=false). Coverage warnings
were present and must remain visible as limitations, not be called exact earnings.
No creator amounts were posted. A live deal publication was exercised inside a
rolled-back transaction and original terms were verified unchanged. The existing
isolated database suite passed stale-version/idempotency/history/organization tests.
79 Python tests passed,
including identity forwarding, unreadable-channel denial, no calculator execution
without a mapping, date validation, and Admin role granting/revocation.
