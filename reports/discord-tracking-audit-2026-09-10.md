# Discord creator tracking audit — September 10, 2026

Production server: GoTall Creators (`1400610531189985310`).
Reviewed 33 creator channels, all 104 current guild members and their roles,
the complete 633-message account-submission channel, and the latest 100
video-submission messages (extending back to March 14). Private creator-channel
reads included the latest 100 messages or full history where fewer existed.
Older personal/reference account links were not automatically enrolled as
current campaign accounts. No Discord messages were sent or roles changed.

## Added to production tracking

| TikTok account | Tracker ID | Native account ID | Creator's own submitted link |
|---|---:|---|---|
| zachgotall | 104 | 7483319119661630510 | [Discord submission](https://discord.com/channels/1400610531189985310/1423052483982397631/1543759701513211954) |
| verticle0 | 105 | 7680116343786357773 | [Discord submission](https://discord.com/channels/1400610531189985310/1423052483982397631/1543907108804624404) |

Both public TikTok profiles returned matching handles and IDs, public visibility,
and zero posted videos during this audit. They were registered active with manual
provenance, a 30-video discovery limit, handle history, and initial discovery due
immediately. Registration does not establish contract approval, trial activation,
payout eligibility, or completed collection. verticle0's contract discussion
remains pending; no onboarding state was changed.

Production readback confirmed both rows and scheduled discovery, with no native-ID
duplicates. Maintenance run: `80b2ec8f-8d93-4215-a202-7e963fd55940`.
The worker and scheduler timer were active; the temporary enrollment unit was removed.
The other 31 creator channels already corresponded to existing tracked accounts,
including b3ngotall, aligotall, height.decoded, and xcynu_.

## Unidentified members

Three members with the older New Creators role have no private creator channel or
account link in the reviewed submission histories: `oliviaa6218`, `tay2famous`,
and `ehzen._08787`. They were not assigned guessed social accounts.

Read-only audit material is retained under
`/var/tmp/discord-tracking-audit-2026-09-10/` with directory mode 0700.
