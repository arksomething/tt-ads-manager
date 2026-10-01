# GoTall Nanobot support and operations

The existing Management bot (`1534630446959427686`) runs Nanobot 0.3.0 using the
owner's current Codex login. The static onboarding runtime remains separate.

## Use

Mention **@GoTall - Management** in a private creator channel or the private
support-review channel. Replies to this service's answers continue the conversation.
Public channels, DMs, other guilds and bot messages are ignored.

Verified operators can simply ask: “Make the welcome message friendlier”, “Fix this button”,
or “Give this creator access”. The bot finds the implementation, checks it and
updates the existing target. They do not need filenames, commands or deployment
instructions. Replies describe the result in plain language. For a longer step,
they can reply “check it” to its completion message; the bot retrieves the internal
job reference automatically without asking them for IDs.

Creators have public web search, current-channel history, delivered payout PDFs,
historical guides, support cases, read-only terminal diagnostics, payout forwarding
to Michael and `video_analysis`, which watches a public TikTok (full link) with
Gemini 3.5 Flash-Lite and returns transcript, on-screen text, scenes, brands and whether
the creator speaks, and `video_transcript`, a fast words-only transcript that also
works on photo slideshows. Operators also get `ask_video` for one free-form, timestamped
question per call. Failures carry the engine's code, a PERMANENT / retry-later verdict and
advice; permanent failures (private, removed, login-gated) are remembered per video and
answered without another download. Both share a persistent `openrouter` budget (2s spacing, 60/hour,
300/day) and a 24h result cache; downloads and frames live under the state
directory's `video-cache/`. The key is read from `~/.config/gotall-nanobot/video.env`
(mode 600, redacted from tool output). Engine: `tools/video-analysis/`. Older guides are explicitly historical, including their superseded
manual-invoice instructions.

The owner, verified administrators and explicitly designated current staff operators
get operational tools. Membership and authority are rechecked on privileged calls.
Judy / Blazie left the team September 16, 2026 and is no longer a designated operator.
Evan is the interim creator coach. Do not infer authority from old staff messages.

Operator actions are governed by [OPERATIONS-SKILL.md](OPERATIONS-SKILL.md), loaded
fresh on each operator request. It authorizes routine operational changes, static
bot edits, account corrections, roles, source inspection, tests and deployment.
The owner retains host terminal access. Delegated operators edit source in an isolated project
view without personal home files, credentials, network or host sudo. AI gateway
files remain read-only there. The static deployment tool uses a fixed trusted
installer; source cannot substitute an arbitrary host deployment command. Action
judgment is in the skill, with identity and private-data boundaries in code.

Read the on-demand [architecture map](ARCHITECTURE.md) and
[deployment/rollback guide](DEPLOYMENT.md). These identify the separate web,
onboarding, tracker and support targets. A shell can use configured integrations;
it does not prove that payment-provider access exists or that a transfer happened.

## Durable execution

Terminal commands run as transient user systemd services, independently of gateway
restarts, for up to 15 minutes. Request, actor, source message and result are kept
under `~/.local/state/gotall-nanobot/jobs/`. Duplicate exact commands from the same
request reuse the job. Results include a bounded, redacted output tail. Never
print secrets; redaction is defense in depth, not a completeness guarantee.
Commands have 3 GB memory / 150% CPU / 16 MB output-file limits.

Long jobs consume no background model tokens. The gateway posts a completion
receipt after the initiating turn finishes; terminal output is not auto-posted.
A plain reply to the completion message may be needed for verification or the next action. Self-
deployment waits for the initiating reply to be delivered before restarting.

Discord mutations are audited and deduplicated per source request and payload.
Unknown outcomes require readback before retry; API success still needs verification.
Support cases and replies use the existing persistent outbox and delivery readback.
Staff can resolve a case in the review channel with:

```
!support-resolve CASE_ID explanation of the correction and next step
```

## Runtime and cost

- Model: `openai-codex/gpt-6-luna`, medium reasoning. No API-key fallback.
- Creators: 20 working iterations / 600 seconds / 240,000 serialized context chars.
- Operators: 40 working iterations / 1,200 seconds / 400,000 serialized context chars.
- One foreground request with up to 24 waiting requests; 12 requests per user/hour
  and 120 total/rolling day. Queued requests are recorded before waiting. A restart
  fails unfinished requests visibly rather than replaying potentially completed actions.
- Public web search uses DuckDuckGo without a new credential, returns at most five
  results, caches matching queries for ten minutes, and allows at most six fresh
  searches per user/hour and 60 total/rolling day. Private-data-shaped queries are
  rejected before network access; arbitrary page fetching is not exposed.
- Up to 24 successful exchanges over 30 days, isolated by guild/channel/user.
- Recent channel and replied-to evidence is supplied to creators and operators.
  Rich embeds/components are readable; missing guides yield partial results.
- Automatic routing reads a short recent conversation and makes one tool-free model
  decision. It waits two seconds for message bursts and stays silent on status
  updates and chat. Bare mentions investigate preceding context.
- No heartbeat AI, automatic subagents or repository-wide indexing.
- The configured output token setting is advisory with this provider. Call/time/
  context limits are enforced; actual returned usage is recorded.
- Gateway service memory 512 MB and CPU quota 75%; command jobs have separate limits.

Discord routing/operator config is `~/.local/state/gotall-nanobot/config.json`.
The service reads the existing bot credential from `~/.hermes/.env` and the current
Codex token from `~/.codex/auth.json`, without copying or refreshing the shared
session. Normal owner Codex login renewal keeps it current. Expired/unavailable
access fails visibly. Other Hermes integrations remain intact; Discord stays disabled.

## Verify and deploy

From the repo root:

```
~/.local/share/gotall-nanobot/venv/bin/python ops/discord-support/deploy.py
```

This runs all support/operations tests, installs the unit, restarts and checks
fresh Discord gateway readiness. From the bot use `--after-message SOURCE_ID`.
Do not run `setup.py` for routine releases: it provisions Discord routing/resources.
See DEPLOYMENT.md for separate static onboarding and Vercel release procedures.

The original CONTEXT-POLICY-PROPOSAL.md is historical; the owner subsequently
approved the broader operator model documented here.

## Creator diagnostics and Michael payout handoffs

`read_terminal` runs shell commands against a read-only code snapshot and live
service-liveness summary. It has no host home, credentials, customer databases,
Slack history or network. Source/report evidence may identify a suspected bug;
bugs go to the existing Discord support queue, NEVER to Michael.

`forward_to_michael` sends a concise payout decision card through the existing
Hermes BOT connection. Michael Que is the configured fixed recipient. It includes
creator, accepted amount/currency, period, receiving method/details and confirmation.
It checks the staff offer and the same creator's explicit affirmative response.
No payment is executed or marked paid; Michael has final say on sending money.

Saved receiving details are fetched directly from the matched creator/channel
record in the test onboarding database and passed to Slack without exposing the
bank details to the model. In the production Discord guild, or when no saved
profile exists, use the creator's own payment-details message. Missing/ambiguous
information requires a concise clarification, not guessed routing or bank details.

Slack has no search/history/DM-reading tool, no arbitrary recipient and no personal
OAuth connection. Delegated terminals cannot reach the owner's Hermes/Slack credential
stores. Messages are deduplicated; unknown delivery outcomes are not blindly resent.
The original proposal/verification receipts document earlier states; this section
and current code supersede their older descriptions of host access or tool counts.

## Payment-ready handoff trigger

A report being posted or a price being discussed is not enough. The owner must
explicitly ask the creator to confirm that particular payout report, and the
creator must then confirm it. The bot detects ordinary replies after that request
without requiring a bot mention. It verifies the report, amount, period and receiving
details before forwarding. Unrelated acknowledgements, disputed amounts and reports
superseded by newer ones do not qualify. Michael receives the concise payment-ready
handoff only after these gates and retains the final decision to send money.

### Automatic conversation routing

In allowlisted private creator channels, human messages pass through a small,
tool-free model decision using the latest message and up to twelve recent messages.
There is no topic-keyword requirement. The decision is `ignore`, `answer` or
`investigate`; only the latter two start the existing support agent. The classifier
has no tools, cannot grant authority, and does not show typing or send acknowledgements.
Its policy is [triage-policy.md](triage-policy.md). Staff, commands, public channels,
DMs, replies to human messages and mentions of other creators retain their routing exclusions.
Routine support questions can address or tag Evan/staff; personal requests, approvals,
negotiations and payment-execution requests remain for the named human. Human replies
arriving before or during an automatic answer suppress the bot response.
Explicit bot mentions and replies to delivered AI answers bypass classification.

Two seconds of debounce allow message bursts to settle. A newer human message
supersedes pending automatic work; superseded answers are not posted. At most two
classifiers run concurrently, with 24 waiting candidates, 60 decisions/user/hour
and 600/day across the bot. Reservations and decisions persist in `triage_decisions`;
failures/malformed output stay silent and are recorded. These limits are separate
from the existing 12/user/hour and 120/day full-agent limits. Explicit requests still
work when classification is capped. Automatic overload skips quietly.

The full agent investigates real questions with existing permissions. It can also
return a silent outcome before using tools when context shows no task. First replies
identify the AI; payment qualifications belong only in relevant payment answers.

### Replaying past conversations

[replay.py](replay.py) exercises the production dispatcher, classifier, prompts and
tool schemas against a simulated Discord API and a temporary support database.
Every external tool callback is replaced with a fixture, including newly added tools.
Discord writes, terminal commands, provider reads and payout forwards cannot reach
live systems. Would-be replies and support cases appear in the output, never Discord.
Only model inference uses the real configured model connection.

Run the checked-in synthetic regression conversations:

```bash
~/.local/share/gotall-nanobot/venv/bin/python ops/discord-support/replay.py \
  --fixtures ops/discord-support/fixtures/conversations.json \
  --mode full --output /tmp/discord-replay.json
```

Use `--mode route` for classification only, or `--case pay_question` to select a case.
Each output has a companion Markdown review. Checks cover expected response/silence,
required/forbidden tools, evidence links and selected output facts; review the actual
answers too. These are regression checks, not proof of real-world resolution.

Replay a message from the private audit snapshot (or another snapshot in the same
`guild`, `channels: [{channel, messages}]` format):

```bash
~/.local/share/gotall-nanobot/venv/bin/python ops/discord-support/replay.py \
  --snapshot ~/.local/state/gotall-nanobot/audits/2026-09-29/live-history.json \
  --message-id 1552926789708284006 \
  --config ~/.local/state/gotall-nanobot/config.json \
  --mode full --output /tmp/discord-historical-replay.json
```

Messages newer than the selected ID are invisible, including direct message fetches.
The agent receives the historical date. Historical role membership, attachments and
provider/report results are not reconstructed automatically: supply explicit
`member_roles`, `roles`, `tool_results` and accessible `channels` in a fixture when
needed. Missing tool evidence is labelled unavailable, never replaced with today's
data. Synthetic fixtures are in the repo; private snapshots/results stay outside it.

## Reliability checks

Deployment also runs a tool-free authenticated model probe using `healthcheck.py`.
The gateway checks local credential expiry every five minutes without model calls,
logs unavailable/expiring state and writes `auth-health.json` in its private state
directory. It does not rotate the shared login. Provider errors become failed turns
and useful user messages, and are excluded from future model context.

Earnings identity lookup runs the fixed root-owned bridge `identities` operation
through the existing user-service broker; the gateway retains `NoNewPrivileges`.
The lookup does not accept arbitrary command input or expose another creator's
binding. Live reads still precede saved bindings to detect ownership conflicts.

Operators can ask to close a confirmed resolved support case in ordinary language;
`resolve_support_case` rechecks authority and channel access and notifies the creator.
Historical cases are not automatically closed. Long job status calls can wait up to
45 seconds so the current turn can interpret and verify completion.

### Staff guidance retrieval

Every answer receives recent verified owner announcements from currently readable
announcement channels. `guidance_channels` discovers shared announcements, Scripts
and guidance channels; `staff_guidance` searches owner messages by default, or a
specified verified staff author. It searches 100 messages per page with continuation
cursors, including for empty matches and result limits. It returns dated source links
and rechecks requester permissions. Creator searches exclude other private creator
channels. Operators can specify any readable text channel in this guild. Raw message
content remains untrusted evidence, and historical announcements do not override
creator-specific financial authority checks.

Before saying no script or instruction exists, the agent must check this evidence
and search older relevant staff messages. A missing daily script is distinct from
missing standing guidance on what to post. Invalid Discord Markdown citations are
rendered as plain labels rather than broken links.
