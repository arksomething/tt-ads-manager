# Owner daily executive report — proposed design

Status: planning only. No schedule, delivery destination, messages or production behavior changed.
Owner request: a daily 09:00 Asia/Shanghai report that identifies issues to clear up, actual creator status, missing plugs, breakouts, instruction compliance, and overall program performance. Commercial objective: content that brings paying customers and profit, not views alone.

## Delivery and reading experience

- Every day, including weekends, at 09:00 Asia/Shanghai (01:00 UTC). Use the IANA timezone, not the host timezone.
- Proposed destination: a private Discord DM to the verified owner, sent by the existing Management bot. Record a fixed owner ID; never resolve recipients from names or model text. Confirm the actual destination and DM reachability as part of implementation. Do not fall back to a creator/staff channel containing company finances.
- Aim for a two-minute, 250–450 word digest, split safely into numbered Discord messages when required. Include direct video and instruction/message links. Keep full evidence and a complete creator roster in a private linked report.
- Always deliver the daily report. A quiet day should say no new material issues and still include the scorecard; a data outage should produce a visibly incomplete report, not silence or invented zeroes.
- Replies should support: show the video, explain the finding, show the creator history, mark reviewed/resolved, defer until a date, and drill into a metric. Acknowledgment does not resolve an issue. Financial or external actions retain their normal authorization and evidence requirements.

## Content, in priority order

### 1. Decisions and unresolved blockers (maximum three headline items)

Each item: creator or affected group; concrete problem; age/deadline; impact; recommended next action; who must act; source link. Distinguish new, escalated, still waiting, and resolved since the last report.

Highest-priority examples:
- Published GoTall deliverable missing its required plug, particularly one gaining views or entering a payout calculation. State confirmed versus suspected and whether a durable exclusion/hold is already applied or still needs review.
- Creator awaiting account approval, draft review, script clarification, trial decision or payment clarification. Show the dependency so staff delays are not blamed on the creator.
- Conflicting or unclear instructions, unacknowledged deal changes, announced rates differing from calculator inputs, or an eligibility decision absent from payout records.
- Payment-ready handoff waiting on Michael. Separate owed/estimated, handed off, and externally confirmed paid. Never infer payment from a discussion or an invoice.
- Tracking/media-analysis coverage failures that prevent us from assessing a material part of the program.

Rank by material financial exposure, decision deadline and blocked work. Collapse common-cause incidents (e.g. ten creators affected by one broken guide) into one issue.

### 2. Content worth seeing: breakouts and actionable quality failures

Show at most three examples unless a critical exception requires more. For each: playable media or video link; creator; useful format label; newly gained views and measured interval; comparison with that creator's usual performance for similarly aged posts; plug status; applicable instruction compliance; recommended follow-up.

Separate:
- Reach opportunity: fast-growing video worth examining. This is not proof of conversion.
- Commercial evidence: same-window new-payment/trial evidence with an attribution status. Company-wide movement is not assigned to this video.
- Quality/compliance exception: missing plug, wrong app asset, wrong CTA, wrong insertion/duration where explicitly required, or a missed approved revision.

Proposed breakout defaults for calibration: at least100k new views in24h, or at least25k and3x a creator's comparable-post baseline. Mark insufficient baseline explicitly. Also flag newly crossed major lifetime milestones once, but never substitute lifetime totals for daily gains. Re-notify only on substantial new growth, changed evidence or a required decision.

Analyze newly discovered posts and newly submitted revisions, prioritizing rapidly growing posts. Use cached media and Flash-Lite observations; inspect full video including the ending, audio, and ordered slideshow images. Captions/transcripts alone cannot establish absence of a visual plug. Unavailable/private/unreadable media stays unknown. Reuse media hashes to avoid repeatedly classifying the same upload or cross-post.

### 3. Creator operations: who is producing, improving or stuck

Compact daily counts plus named changes/exceptions:
- Approved creators expected to post; creators meeting their own current obligation; below obligation; legitimately paused; not yet eligible; unverifiable due to tracking gaps.
- Unique creative deliveries versus platform posts. Report cross-posting fulfillment separately; a TikTok and Instagram copy are not two creative deliverables.
- New starts, first approved/published video, completed trials, upcoming trial decisions, resumed creators and departures.
- Repeated instruction failures, repeated missing plugs, unanswered creator questions, stalled drafts or repeated resubmissions.
- Creators improving both compliance and useful reach; potential examples to share or coaching to repeat.

Evaluate posting days in each creator's agreed local timezone, with saved exceptions/time off and current deal expectations. Never impose a universal two/five-post quota from an observed maximum. A missing provider result does not establish that the creator did not post. Off-program personal uploads do not count as GoTall deliverables or automatic pay claims.

Maintain a complete owner-only roster behind the digest: creator, lifecycle status, obligation, last qualifying post, recent delivery count, review/plug coverage, open blocker, next owner, last contact, next decision date. Daily main report is changes and exceptions, not a wall of unchanged rows.

### 4. Program scorecard: results, quality, customer activity and cost

Use the same defined windows, with the previous comparable day and trailing7/28-day context. Mark small samples and incomplete series. Proposed primary rows:

| Measure | Required interpretation |
|---|---|
| Active creators / expected creators; new unique deliverables | Execution and capacity; define denominator and pauses |
| Plug-compliant deliverables / assessed deliverables | Separate missing, weak/wrong, and unknown; state assessed coverage |
| Newly gained views on GoTall content | Separate known advertised content, confirmed no-plug posts and unresolved paid status |
| New paid subscriptions and trial starts | Separate outcomes; exclude ordinary renewals; do not call transaction counts unique customers without validated identity deduplication |
| Matured trial-to-paid conversion | Attribute to original trial-start cohort; consistent follow-up, not payment-day content |
| Earned creator cost / committed fixed cost / forecast liability | Label estimate versus finalized; separate actual transfers |
| New proceeds and paid acquisition spend | Consistent GoTall app scope, currency, purchase/cohort basis and freshness; program attribution only where supported |

Do not show residual company organic proceeds as measured UGC profit. Show the available financial inputs and the unresolved attribution gap. Coverage gaps must not silently shrink the creator roster, content count or cost denominator.

### 5. Format learning and today's recommended experiment

One useful finding or test recommendation per day; say no new reliable learning when appropriate. Keep a rolling learning register so yesterday's hypotheses do not become today's facts.

The desired scorecard is format -> reach per post -> new paid acquisition per100k eligible views -> acquisition cost / contribution per post -> scale, revise, test or insufficient evidence. Unsupported conversion rates stay unavailable.

Keep format and plug separate: e.g. current-height-to-adult-height text prediction, parent-height prediction, talking height prediction, growth-sign list, and height-by-age benchmark chart; then record plug promise, placement, duration, app visual and integration. Retain reference videos and versioned label assignments so labels can split/evolve.

Primary timing is same-day exposure versus initial payments and trial starts. Later paid trial conversions are assigned back to their trial-start cohort; ordinary renewals are a separate retention outcome. Compare repeated spikes across creators and time, account for other format exposure and paid activity, and retain timing uncertainty. Paid creative results are a separate evidence source and not assumed to transfer unchanged to organic posts.

Prefer a concrete experiment with one changed factor: same creators and similar posting conditions, different hook/format with the same plug; or the same format with two plug integrations. Recommend the script/reference, assignment and success measure. This report does not itself send assignments or buy ads.

## Time windows and freshness

- Delivery:09:00 Shanghai. Main activity window: the24h ending08:00 Shanghai (00:00 UTC), expressed explicitly in the report rather than ambiguously called yesterday. Posting compliance still uses each creator's local obligation days.
- Urgent/blocker status can refresh through08:45 Shanghai; timestamps distinguish it from the closed activity window.
- The recently closed business day is provisional until source completeness is established. Show the latest complete business window separately if a source is late. Do not compare today's views with older purchases under a single heading.
- Apple daily data may lag and should not block delivery. Purchases/trials are the primary customer signals; downloads are diagnostic.
- Add one compact footer: post/media review coverage, purchase freshness, paid-data freshness, unknown/missing coverage. Put only material data failures into the action list.
- Persist revisions and include material corrections in the next daily report. Report completion/arrival times are not conversion timestamps.

## Durable state and implementation

Use a background pipeline rather than a9am chat prompt that performs all research from scratch:
1. Incremental collector: Discord instructions and creator lifecycle, provider daily video gains, media/cache, business events, current deal/exclusions, paid reports and support/payment-handoff evidence. Preserve stable creator/account/video IDs and timestamps. Resolve identities before joining data.
2. Instruction register: who issued it, target creators/posts, source message, validity/effective time, required versus suggested, revisions/waivers and applicability confidence. Match the instruction in force when the video was made; do not apply later guidance retroactively.
3. Review records: media hash, model/prompt version, timestamped observations, applicable instruction, finding, confidence, human verification and payout-action status. Model-only guesses do not become confirmed financial exclusions.
4. Open-issue register: stable issue ID, affected entity, first/last seen, severity, owner, evidence, due date, decision needed, state, disposition and resolution evidence. Repeated unresolved issues are compactly carried forward and escalated when impact/age changes; no identical notification spam.
5. Snapshot/report run: compute typed metrics and evidence-backed candidates first. Model writes the brief and prioritizes actions; it does not invent totals or infer unsupported attribution. Preserve full inputs, arithmetic, report text and generator version.
6. Delivery outbox: unique owner/report-local-date identity; persist prepared/sent/readback status and Discord message IDs. Read back ambiguous sends before retry, avoid duplicate digests after restarts, report failed delivery privately through a configured fallback rather than exposing financial data to staff.

The existing support bot has video tools, provider budgets, support cases and an outbox, but current inbound routing ignores DMs and there is no daily executive-report scheduler in the reviewed path. Implementation needs an owner-only report/delivery path and scoped reply handling. Do not change creator support access or expose owner financial tools to other roles. A separate worker/timer should keep report preparation from occupying the interactive bot's single foreground queue.

Use an incremental cache and the user's chosen Flash-Lite model for first-pass media review. Reuse prior analyses; queue only new/changed media, unresolved cases and important newly surging posts. Budget video calls against the existing shared300/day cap, reserve support capacity, and state actual review coverage when limits prevent completion. Escalate only ambiguous/high-impact cases for more expensive analysis. Record external API/model spend per run; no repeating full Discord/archive/video scans every morning.

## First release and acceptance checks

First release should deliver sections1–4 plus honest format evidence/status, not wait for a perfect attribution model. Add validated format conversion estimates only after coverage and model/experiment checks support them.

Before activation:
- Produce a concrete owner-only sample from real data, with evidence drilldowns and no placeholder metrics presented as real.
- Verify known examples: confirmed no-plug exclusions; visual plug without spoken brand; inaccessible media; paused/missed creator; due draft awaiting staff; same creative cross-posted; renamed account; conflicting instruction dates; breakout with a weak plug.
- Verify exact09:00 Asia/Shanghai scheduling, UTC and creator-local boundaries, future/incomplete events, matured trials, stale ad reports and provider failures.
- Verify recipient isolation and DM reply access, delivery retries/restarts without duplicates, and honest degraded reports.
- Verify each headline action links to evidence and every metric is reproducible from the saved snapshot. A quiet day still produces the scheduled scorecard.

This document is the proposed content and implementation plan. It does not activate daily delivery or authorize new creator messages, ad spend, transfers, or automatic deal changes.
