# Payment evidence and useful reports

Reviewed 2026-09-14. Durable principles distilled from payout investigations and
owner decisions; this file deliberately contains no individual earnings or bank data.

## Policy and calculator conflicts

The applicable signed agreement and current verified stated policy define the deal;
calculator code implements it, but does not override it. If implementation and policy
disagree, generally follow the applicable policy and flag the implementation for
correction. A creator's unverified claim or an obsolete guide is not a policy update.
Do not silently change rates, promise a corrected amount, or treat buggy output as
a new obligation. Where evidence conflicts or applicability is unclear, get staff review.

Tell the creator the practical impact briefly: "The calculation may not match your
agreed terms. This needs review before the amount is confirmed." Be transparent about
uncertainty without exposing stack traces, code paths, exploit details, private data,
or lengthy internal debugging. Put technical findings in the authorized staff context.
Do not claim a fix, report correction or staff notification happened without evidence.

Calculator source is available through read_terminal under code/web/src/server/ugc-pay
and related source folders. The operator generate_report tool invokes the existing
getOrganizationUgcPayData calculator through report-runner.mjs. Read access is not
permission for a creator to edit code or execute staff-only report operations.

For "how much did I earn in the last three days", use my_earnings with an explicit
UTC start/end date. State which dates were used; default to the last three completed
UTC days unless the creator asks to include today. This runs the real calculator,
not a lifetime-views shortcut. It returns saved applicable deal periods and an
estimated date-range amount, not an unpaid balance or transfer confirmation.
Read their delivered payout_report for settlement questions or conflicts, but an
old monthly report is not required to calculate a new date-range estimate.
The identity binding must match requester, guild and creator channel. If not linked,
ask staff to connect the account; do not infer identity from names or handles.
If test_fixture is true, explicitly label the result test-linked sample data, never
the requester's own real earnings. Do not assume every creator has a complete mapping.

## Current payment timing

Owner confirmed September 30, 2026: payments happen at the start of the new month,
usually on the 2nd, for the previous month's settlement. This is the usual schedule,
not a guaranteed arrival date for an individual transfer. Creator-specific confirmed
exceptions can differ.

Questions about whether a particular payment was sent, an overdue/missing payment,
or an exact amount require the relevant individual evidence. The usual schedule
does not establish that money was sent or received. The seven-day video measurement
window and a creator's trial do not set the monthly payment date.

## Historical monthly payment flow

Owner reconfirmed 2026-09-14: the established program pays after the month, using
the seven-day approach. This is monthly settlement in arrears, not payment after
each upload and not the new creator's seven-day trial.

The historical per-video earning window is the first seven days after publication.
Reports reconcile eligible gained views in the payment period against that window,
the creator's agreed terms, applicable content rules and paid-ad deductions.
Late-month videos can have eligible views in the following month while their original
seven-day window is still open. That carryover must not pay the same views twice.
Views gained after the window are not automatically payable just because lifetime
views increased. Use the existing period/window calculation, not improvised calendar
arithmetic, to resolve an exact boundary or timestamp question.

Flow: close the month, collect/reconcile eligible activity and carryover, calculate
under the applicable deal, prepare a clearly preliminary report, obtain required
staff review/release, let the creator review and confirm, resolve discrepancies,
then send the payment-ready handoff to Michael for his decision and transfer.
The usual timing above is not a guaranteed universal transfer day or a seven-day wait after
month-end: the seven-day metric window and actual payment date are different things.
Individual signed terms and confirmed exceptions can differ. A current all-time
dashboard total is not the settled monthly figure. Missing historical snapshots
cannot be reconstructed exactly from today's totals; disclose any approved fallback.

Use the existing calculator and the agreed source for the requested period. A newer
tracker is not automatically the payment authority. Match stable platform/account
IDs before handles or display names. Repeated aliases for one provider account are
one match; collisions between different accounts need resolution. Only include a
creator in a period's payout calculation if their applicable deal covers that period.

Separate total observed views, the relevant earned-view window and paid advertising
deductions. Historical reports used first-seven-day views and monthly carryover;
never apply those rules to every current agreement without evidence. Provider top-N
limits, missing pages, unavailable accounts and historical tracker loss can make
results incomplete. Missing observations and HTTP errors are not measured zeroes.
Partial payment claims require prior-transfer evidence and reconciliation, not a
second payment for the full reported amount. Agreed amount and completed transfer
are separate facts. A staff acknowledgement is not bank/provider settlement proof.

Preliminary reports may still be useful with incomplete data. Explain coverage,
period, assumptions and what could change; do not fabricate precision or let the
beta disclaimer obscure known limitations. Label drafts for creator review.
For an operator request, distinguish calculation-verified, transfer-confirmed,
disputed and unresolved records. For creators disclose only their own information.

Report presentation preferences from prior rounds: show actual deal structure,
video thumbnail and newest-first posting order. Prefer clear labels such as total
views and seven-day views minus paid ads when those are the actual calculation.
Avoid wording like downgraded, irrelevant paid-zero rows and internal classifier
names. Historical #yap classifications and dated eligibility rules must remain tied
to their period. Talking classification alone is not proof of promotion eligibility.

Creator review comes before payment handoff. Match report identity, period/version,
explicit owner release/confirmation request, same-creator confirmation, amount,
currency and receiving details. Do not interpret silence, negotiations, conditional
replies or an unrelated OK as acceptance. A newer report can supersede an old one.
Only confirmed payment-ready cases go to Michael, with the minimum useful details.
Sending him a handoff does not mean money was sent. Bugs stay with the support team.

A request to send a report is not authorization to transfer money. Verify the
destination private creator channel before delivery and read back the posted result.
Do not resend blindly after an unknown delivery outcome. Exclusions and special
arrangements can differ between payout batches; confirm them before bulk delivery.
