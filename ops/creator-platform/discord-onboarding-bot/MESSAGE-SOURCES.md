# Blazie onboarding copy — September 10, 2026

Sources read directly:
- https://app.notion.com/p/GoTall-Discord-Messages-3d310f234e6280f1841ad0ae60ad9bcd
- https://form.jotform.com/262506982690062

The owner supplied both links and confirmed the revised bonus table in this task.
The ten Notion messages are preserved in `messages.mjs`, with runtime substitutions
for names, the agreement URL, button instructions, optional best-video wording,
and the script-library typo. The owner requested placeholder URLs for the unfinished
account-creation, warm-up and winning-formats guides; these use clearly labeled
`https://example.com/gotall/...` URLs. Replace these in `messageCopy` when supplied.

## Behavior

Existing `warmup` records retain that database key for account setup. Account
approval now leads to actual warm-up, creator completion, and staff approval.
Staff then send the supplied Jotform agreement. A creator confirmation is not a
verified signature: staff must inspect the completed submission, check any required
guardian signature, and record a reference. No automatic Jotform webhook or
submission verification is claimed. Test signature simulation is separate.

Signing opens first-video preparation. Creators share a draft URL, staff request
revisions or approve, then explicitly open Creator Hub. Only successful channel
and role synchronization queues the Hub-unlocked message. The seven-day trial
starts at Hub opening. Existing trial/active records are not reset.

Creator Hub channels are provisioned in Retconned's test guild with gated access;
resource channels are read-only to active creators and community is writable.
The actual scripts, assets and guides still need to be supplied. Application and
private-channel controls are used instead of privileged message-content intents;
typing DONE, SENT, etc. does not silently bypass the recorded approval workflow.

## Compensation and review findings

The guide describes the supplied agreement's $500 monthly completion payment for
30 qualifying, approved, cross-posted videos with at least 500 views, normally
measured in the first seven days. The base is not automatically awarded.
The draft highest-tier estimator now uses 50K/$20, 100K/$50, 300K/$100,
500K/$250, 700K/$350, 1M/$500 and 2M/$1,000. Highest-tier rather than cumulative
stacking remains an explicit estimate, not a finalized settlement rule.

Unresolved in the supplied documents: whether qualifying views aggregate across
platforms or must be met per platform; whether bonuses stack; and how fair
compensation on company termination is calculated. The agreement allows several
approved content formats, while Blazie's follow-up emphasizes high-quality talking
content. This update does not rewrite the contract or change existing signed deals.
The contract form shows a prefilled company date of 2026-05-25; the owner should
confirm that is intentional before broad use.

Deployment stays confined to the existing test bot and test guild. No production
creator-server cutover, payments, contract submissions or membership removals.
