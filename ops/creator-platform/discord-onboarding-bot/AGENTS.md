# Creator notification rule

Whenever an asynchronous staff/admin decision requires the creator to act,
send a channel-visible notification to that creator in their private channel.
Use a real Discord user mention with allowed_mentions restricted to that user.
State the decision, the next action, and include a direct link to the current
status card. An edited status card or ephemeral staff receipt is not sufficient.

This also applies to requested revisions, agreement/signature decisions, trial
decisions and leave decisions. Notify at approval milestones such as warm-up
and first-video approval, but accurately explain when the next step still belongs
to staff. Purely internal actions (notes, diagnostics, attaching an unsent signing
link) should not ping the creator.

Use the persistent delivery queue and idempotent event IDs. Deliver after the
status card is synchronized; retries must not ping repeatedly. Reuse an existing
creator-facing notification where one exists rather than sending a duplicate.
New admin workflow actions must implement and test this notification behavior.

## Review routing rule

Every creator submission requiring human review must enqueue one notification
in the private staff review channel mentioning the Manager role (role_staff).
Use <@&ROLE_ID> and allowed_mentions with only that role ID. Do not target
a hard-coded reviewer user. Apply to accounts, warm-up, signing, drafts, posts,
and time off, including future review workflows. Keep review authorization and
channel access tied to the Manager role and preserve idempotent delivery.

## Creator channel naming rule

Whenever creator account details are submitted or changed, synchronize the
private channel name to the creator name plus campaign handle automatically.
Prefer the TikTok handle, falling back to Instagram. Preserve the status emoji
and normalize the result to Discord channel naming rules. Do not depend on a
manual channel rename. Compare the current name before PATCHing to avoid
unnecessary rename rate limits, and retry failed synchronization.
