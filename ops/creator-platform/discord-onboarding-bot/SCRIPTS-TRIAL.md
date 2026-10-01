# Test Server Scripts and Trial

Scope: Retconned test guild `1245112089647775877` only. Do not migrate or deploy
to the old GoTall Creators server yet. Existing deal terms are unchanged.

New applicants finish onboarding, warm-up, signing and initial draft approval
without receiving Scripts or New Deal. After publishing their first approved
video they click First video posted. The bot records the confirmation time automatically and starts the
168-hour trial and automatically grants both roles. No published links or post
validation are required. The first-publication time is creator-confirmed.

After that initial grant, Discord roles are authoritative. Manual role removals
are not overwritten by the bot. Scripts permits reading the scripts channel;
New Deal selects ongoing draft approval and trial reporting. Scripts alone
allows a legacy creator to receive scripts without new approval requirements.
The `/creator scripts` command updates the same Discord roles, not deal terms.

Only Managers, Founders and the server owner can publish scripts. A message
mentioning Scripts is recorded once. Eligible new-deal creators receive a
private status-card link, submit their draft, and receive an approval or revision
notification. Video reviews go to video-reviews; accounts, warm-up, signing,
time off and trial reports go to onboarding-reviews.

The preliminary report is sent 24 hours before the trial deadline, mentions Judy
and Manager, and shows available TikTok/Instagram
observations plus draft counts. Missing observations are not treated as zero.
Managers decide whether to continue, extend or end participation. Facebook and
YouTube remain publishing destinations, not tracked metrics providers.

Production agreement: https://form.jotform.com/262582983401057
The old-account forms 262551606074051 and 262506982690062 are retired and are
not valid onboarding destinations.
Historical signed receipts are preserved; existing agreements are not rewritten.

`legacy-scripts-review.json` is a migration-preparation history review only.
It is not imported by the runtime and does not assign any production roles.
Ambiguous cases require Manager review before a future migration.

## Agreed Cutover Rules

- Existing creator-channel owners at cutover are legacy, including owners in
  onboarding, inactive and at-risk creator categories. Server membership or an
  old creator role alone is not participation. People without a creator channel
  are excluded from the migration roster (not kicked from the server).
  Resolve channel ownership from verified member IDs, not channel-name guesses;
  ambiguous or departed owners require manual reconciliation. Capture that roster in
  legacy_participants before enabling production onboarding. It is independent
  of editable Discord roles and prevents new-deal enrollment or re-onboarding.
- New Deal remains after trial success. Re-onboarding is for new-cohort creators
  only; it must not convert legacy creators to the new rate.
- Creators partway through onboarding at cutover finish under the old terms,
  including those who have not signed or published yet.
- Inactive creators retain legacy status and their original deal on return.
  Do not automatically restore active access or assign Scripts. Judy decides
  when they return; cohort membership alone is not an activation decision.
- Each new script replaces unfinished work, including drafts under review.
  Script-message edits update existing cards without a fresh announcement ping.
- Only scripts is an announcement source; script-library no longer triggers.
- Trial timing uses the first-post confirmation click, runs for 168 hours, and
  is not paused by time off. The test agreement matches this behavior.
- Judy makes the final decision. The 24-hour-ahead report is preliminary and
  can contain incomplete observations; missing data is not treated as zero.

## Legacy Access and Hub Replacement

These are production migration requirements, not authorization to run cutover.

- Grant a dedicated Legacy role to the captured creator-channel owners. The
  role controls visibility; legacy_participants remains the immutable cohort
  guard even if someone removes the role. Do not grant New Deal to legacy users.
- Preserve individual creator channels and their owner/staff privacy. Never
  grant the whole Legacy role access to individual creator channels.
- Keep old-deal resources needed for existing day-to-day work in a Legacy-only
  section. New Deal onboarding, rates, trial guidance and review instructions
  must not appear in legacy navigation, cards or shared resource channels.
- Retain submit-your-video (1401971472163012741) and drop-your-tiktok
  (1423052483982397631) as working legacy channels, not archived channels.
  Permit Legacy and Manager access only, apart from required bot access and
  Discord's unavoidable administrator bypass. New Deal, Scripts and generic
  creator roles must not independently grant access. Audit member overrides
  and inherited permissions so non-legacy creators cannot view or submit there.
- Replace the current shared resource hub with a cohort-neutral Creator Hub:
  team contacts, app access, assets, inspiration, community and shared help.
  Keep deal-specific guidance separate. Scripts visibility remains Scripts-role
  based, independent of Legacy and New Deal.
- Archive superseded hub material without deleting channels, messages, threads
  or attachments. Hide the archive from ordinary members, Legacy, New Deal,
  Scripts and staff roles; retain only administrator and designated bot access
  for historical reference. Discord administrators inherently bypass channel
  restrictions, so the archive cannot be invisible to every administrator.
- Before moving or changing permissions, export channel/message history,
  attachment references and the exact channel/role/member overwrites to a
  protected backup. Preserve channel IDs and source links. Confirm attachment
  preservation separately; an expiring attachment URL alone is not a backup.
- Audit every archived child channel and thread, including unsynchronized
  member/role overrides. Moving channels into a hidden category alone is not
  sufficient. Verify effective visibility for each cohort and staff before
  declaring the archive hidden; ensure the designated bot can still read it.
- Review shared-resource contents before classifying them as retained legacy,
  replaced shared, or archived. Do not blanket-archive private creator channels
  or the still-used inspiration feed. Prepare a channel-by-channel preview and
  rollback manifest before production writes.

Read-only production inventory checked 2026-09-14: shared resources currently
live under Details (1450438764412272742), Server Info (1450439001080201226)
and Discusson (1450439523753529384), not a category literally named Creator Hub.
Details includes how-it-works, video-requirements, payout-info and FAQ; these
need content review before assigning legacy versus replacement/archive status.

## Posting frequency (September 14)

New-deal creators publish 2 distinct approved videos per day during trial and
ongoing participation. Cross-posts do not count as additional videos. Each draft
still needs approval. The test Jotform and test-server guidance carry this rule;
legacy schedules and the 30-qualifying-video/$500 payment threshold are unchanged.
