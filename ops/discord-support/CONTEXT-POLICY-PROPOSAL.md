# Proposed GoTall support context policy

Status: historical proposal, September 12, 2026. The owner subsequently authorized
broad operator tools for Blazie, with action discretion governed by a skill file.
See OPERATIONS-SKILL.md, ARCHITECTURE.md and DEPLOYMENT.md for the implemented
operator model. This original proposal is not loaded by the running bot.

## Recommendation

Give the creator-facing Nanobot approved program knowledge, the requesting
creator's structured records, and narrowly selected conversation evidence.
Use code-derived explanations for calculation semantics. Reserve sanitized source
inspection for staff diagnostics. Keep payments, contract changes, account access
grants and production engineering outside creator-triggered actions.

## Evidence inspected

Fresh Discord API retrieval covered 55 text channels across GoTall Creators and
selected Retconned test-server resource channels: 3,614 messages, including 981
dated September 1 onward. Each channel retrieval was capped at 100 messages;
this is a bounded sample, not a complete history. Source messages and dates were
inspected, along with the installed support configuration and relevant repository
code. Your actual “waht can you do” test was also present in the bot's completed
turns, confirming a human-origin request traversed the live responder.

Important findings:

- The live guide allowlist contains how-it-works, video-requirements, payout-info
  and FAQ. It omits announcements and get-app-for-free, where newer instructions
  actually appear. The test-server guide list is empty.
- [March program guide](https://discord.com/channels/1400610531189985310/1481512246155808778/1481523974998589511)
  asks creators to prepare invoices;
  [July 2 announcement](https://discord.com/channels/1400610531189985310/1406879411642564670/1522213991743623230)
  says the system calculates earnings and manual invoices are no longer required.
- [Video requirements](https://discord.com/channels/1400610531189985310/1481512610326253588/1481516338546606246)
  specify at least three seconds per screenshot;
  [FAQ](https://discord.com/channels/1400610531189985310/1481519190262288384/1481520239312375818)
  says 1.5 seconds. A canonical current instruction needs staff resolution.
- [June 2](https://discord.com/channels/1400610531189985310/1406879411642564670/1511264589965164594),
  [July 5](https://discord.com/channels/1400610531189985310/1406879411642564670/1523451490533117982)
  and [August 3](https://discord.com/channels/1400610531189985310/1406879411642564670/1533689256889946273)
  announcements describe tracking windows, carryover and #yap. These must remain
  dated and scoped to applicable terms, rather than treated as timeless defaults.
- [Adam's rate question](https://discord.com/channels/1400610531189985310/1485409531239334080/1546479864620519474)
  and [Bledar's base-pay negotiation](https://discord.com/channels/1400610531189985310/1444092726399340626/1546081148768096340)
  require individual terms and effective dates. A request or negotiation is not
  an approved deal change.
- [Kae's missing payment](https://discord.com/channels/1400610531189985310/1501163920948465734/1546135045444472903)
  needs transfer evidence, not the calculator. Payment identifiers and PayPal
  emails also occur in channel history; raw history needs minimization.
- [Ali's app-access problem](https://discord.com/channels/1400610531189985310/1544481444401905664/1547429599531638894),
  [Audrius's failed asset download](https://discord.com/channels/1400610531189985310/1515490752388534292/1548264265646088274)
  and [Koble's oversized upload](https://discord.com/channels/1400610531189985310/1547893975497711656/1548059650476351519)
  need current platform-specific instructions and approved resource links.
- The test server's script-library, winning-formats and assets channels are empty.
  Their existence does not supply content for the bot.

## Access matrix

| Context | Creator-facing access | Retrieval rule |
| --- | --- | --- |
| Approved program rules and announcements | Allow | Retrieve by topic and effective date; include source and approval/version metadata. |
| Own agreement/deal | Allow selected fields | Published terms, applicable dates, platform/account, rates, caps, bonuses and signature status. Omit legal identity/payment details unless essential. |
| Own payout breakdown | Allow | Structured line items from the existing engine or matching immutable report; expose draft/final status, window, exclusions, source coverage and revision lineage. |
| Own payment status | Allow selected fields | Amount, currency, status, verified-at time and creator-shareable transfer reference. Distinguish internal recorded status from provider-confirmed transfer. |
| Own tracked videos | Allow | Stable account/video IDs, metrics, observation timestamps, completeness, exclusions and applicable classification rule. |
| Own onboarding/workflow | Allow | Current stage, blocking requirement, pending reviewer, submitted evidence and next action. |
| Own channel history | Allow targeted retrieval | Current channel plus explicitly mapped historical channels for the same creator. Recheck access; return a few relevant messages, not the whole transcript. |
| Own support cases | Allow creator-visible fields | Read open case/status/resolution so repeat questions can be answered without opening another case. Staff-private notes stay private. |
| Approved scripts/assets/app guides | Allow | Published resource registry with current links, platform, audience and last check. Public reference video URLs may be reused after curation. |
| Other creators' private channels/deals/reports | Deny | No shared financial memory, example retrieval or comparison across creators. |
| General chat | Evidence only | Public FAQs can be answered publicly; personal questions move to the mapped private channel. Staff general-chat statements become policy only through publication. |
| Staff review channel | Staff only | Creator sees their own case's approved status/resolution, not the staff conversation or other cases. |
| Repository source | Staff diagnostic subset | Sanitized, versioned read-only snapshot; creator-facing agent receives reviewed explanations. |
| Environment files, credentials, database dumps, full payment sheets | Deny | Never available through model tools or loaded into context. |

## Source authority and conflicts

Authority depends on the question; there is no universal “newest message wins.”

1. For agreed compensation, use the creator's applicable published deal/approved
   amendment and effective dates. If it disagrees with the agreement, escalate.
   Neither an inferred chat promise nor a source-code constant settles the dispute.
2. For a finalized period's amount, use the approved statement and explicit
   adjustments. A recalculated estimate does not overwrite a finalized statement.
3. For why a report produced an amount, use that report's frozen inputs, rules,
   line items and engine version. Compare later corrections explicitly.
4. For whether money moved, use payment-provider evidence or clearly label the
   result as an internal record/unverified. Missing rows do not establish nonpayment.
5. For general instructions, use the maintained policy registry and approved,
   dated announcements. Conflicting current sources become a staff case.
6. Creator posts are claims; authorized staff posts are evidence of a decision,
   but need the correct subject/date and must not silently amend canonical records.
7. Test-server fixtures, draft workflows and unpublished code changes never
   establish production policy.

Each fact/result should carry source ID/link, creator/campaign scope when relevant,
effective interval, observed/generated time, status, approval identity, and any
superseded version. Distinguish publication date from effective date.

## Repository access

The inspected `web/src/server/ugc-pay/calculations.ts` contains the cap and
paid-view arithmetic, but also named creator payout examples in comments.
Even a read-only grant to that file can leak another creator's information.

`web/src/server/ugc-pay/queries.ts` selects first-days versus all-view mode based
on `creatorAccess.applyDealViewWindows`. This helps explain why two views of the
same account can disagree; only the corresponding run's inputs establish which
mode actually produced a given report.

Recommended published knowledge derived from:

- `web/src/server/ugc-pay/calculations.ts`: reviewed cap/fee/paid-view semantics.
- `web/tests/ugc-pay-calculations.test.mjs`: anonymized examples of expected output.
- Selected window-selection logic in `web/src/server/ugc-pay/queries.ts`.
- `ops/creator-platform/discord-onboarding-bot/EARNINGS-AUDITS.md`: snapshot semantics.
- Selected content from `HUBS.md`, `SHARED-DEALS.md` and `TRACKER-BRIDGE.md` after
  removing infrastructure details, personal examples and test-only assumptions.

Use a small published support-knowledge directory, searched by topic. Record the
source revision and actual deployed engine hash; the current dirty working tree
is not automatically the deployed version. Documentation explains behavior and
does not authorize code execution or policy changes.

If staff need source inspection, expose `explain_calculation_rule` or a bounded
search/read tool over a sanitized snapshot. Resolve paths inside the snapshot,
reject traversal/symlink escapes, cap output, and register these tools only after
server-side staff authorization. Do not attach a root repository mount, git
history, general shell, arbitrary SQL or a generic “run this script” tool.

Before adding filesystem/execution tools, isolate the runtime under a dedicated
service identity/container and mount only its allowed data. The current service
runs as the owner; ProtectSystem makes filesystem writes restrictive but does not
hide readable home-directory secrets. Keep provider/Discord credentials in the
adapter or credential broker, outside the tool-visible filesystem.

## Data access must bind identity in code

Resolve `(guild_id, channel_id, discord_user_id)` to a verified creator, campaign
and stable platform account IDs. Do not infer ownership from a handle, channel
name or an ID supplied by the model. Revalidate permissions for each sensitive
lookup and before delivery; invalidate cached mappings on revocation/rename/link
changes. Public output must never inherit private context.

The new tracking API code authenticates and filters at organization scope. Giving
the bot an organization-wide `tracking:read` credential alone does not enforce
creator isolation. A broker must constrain subscriptions, accounts and videos to
the resolved creator on every request. No raw API key goes into model context.

Useful tools, with scope supplied by the server:

- `get_my_deal(as_of, platform)`
- `get_my_payout(period, video_id?)`
- `get_my_payment_status(period)`
- `get_my_workflow_status()`
- `get_my_case_status(case_id?)`
- `lookup_program_policy(topic, as_of)`
- `find_approved_resource(topic, platform)`

Register only the small relevant subset for each request. These are proposed
interfaces; the current bot still has only its four existing tools.

## Allowed task completion

Allow direct answers, report retrieval, submission instructions, approved links,
case creation/update and current status lookup. A future refresh action may request
one deduplicated, cooldown-limited refresh of the creator's own video/account.
The tracker read credential must not be upgraded to broad tracking writes for this.

Require existing authorized staff workflows for rate/cap changes, disputed
classification overrides, approving compensation, granting app entitlements,
signing agreements, bank-detail changes, transfers, role changes and deployment.
Attach evidence and the proposed correction to the case; never call it solved
until the underlying operation is confirmed. Notify the creator of the actual
decision/next action through the existing durable delivery queue.

Staff diagnostics may produce a private bug report for the owner. Creator messages
must not automatically launch an unrestricted coding agent or expensive research.

## Context size, memory and freshness

- Keep the base policy around 1,000 tokens plus a small server-supplied identity/
  current-case summary. Retrieve one relevant policy and one record breakdown.
- Preserve the present four-call, deadline and request-rate limits initially.
  Set a 4–8k input-token target for normal support; measure actual usage. A full
  codebase or full PDF should not be the default payload.
- Maintain policy/resource metadata with incremental API reads and hashes, without
  background LLM calls. Use SQLite full-text search before considering a vector DB.
- Store approved structured facts and case IDs. Do not promote model summaries,
  creator claims or successful-looking answers into shared policy automatically.
- Keep creator memory scoped to creator/campaign; keep test and production stores
  logically separate. Cross-creator lessons require anonymization and publication.
- Mask payment emails, account numbers, addresses and unnecessary identity details
  before model ingestion. Prefer structured signature/receiving-method status.
- Cache current deal/status lookups briefly (initial target: five minutes) and show
  last-checked time. Always refresh when making a “current status” claim beyond
  that TTL. Expired provider access returns unknown, not the old result as current.
- Immutable historical reports remain usable for their matching period; age alone
  does not invalidate them. Surface revisions and source-completeness warnings.
- Proposed retention: recent conversation context 24 hours; raw support turns
  30 days; case audit records according to the business's adopted retention policy.
  This retention proposal has not been applied to existing SQLite records.

## Rollout priority

1. Publish a small canonical policy/resource registry, adding announcements and
   get-app-for-free and resolving the identified conflicting instructions.
2. Add verified creator/campaign identity bindings and structured deal, payout,
   workflow and own-case read tools. Preserve source completeness and revision data.
3. Add verified payment-status integration with minimal fields; until then keep
   payment claims unverified and route them to staff.
4. Add sanitized code-derived explanations and, only if needed, isolated staff
   source diagnostics. This is lower priority than the missing business records.

Acceptance cases: the invoice guide conflict, screenshot-duration conflict,
personal negotiated CPM, old versus corrected report, missing payment with no
ledger row, stale metrics, cross-creator ID substitution, private/public leakage,
bank details in history, revoked membership, and test data mistaken for production.

## External design references

[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
supports targeted retrieval and compact, useful tool results.
[OWASP AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
supports least-privilege tools, identity boundaries and separating untrusted
retrieved material from instructions. The specific access matrix above is a
proposal based on the inspected GoTall server and code, not a vendor policy.
