# Twilio + Spark Ads Automation Plan (Living Doc)

## Document Info

- Status: Draft
- Intended lifespan: Living planning doc (update as we implement)
- Primary owner: Growth engineering
- Last updated: 2026-03-17

## Why This Exists

We want a reliable, low-friction workflow to:

1. Associate creators with messaging channels (WhatsApp/SMS).
2. Request Spark authorization codes from creators.
3. Automatically parse creator replies and apply authorization to our ad account.
4. Let operators select approved videos and launch ads with minimal manual work.

This doc defines the target system and rollout plan.

---

## Target User Flow

1. Team member connects Twilio (SMS + WhatsApp).
2. Team member links one or more creator phone numbers to creator records.
3. Team member sends a "request Spark code" message to selected creators.
4. Creator replies with Spark code (or message containing it).
5. Our app receives Twilio webhook, parses message, validates and applies authorization in TikTok.
6. Authorization data is stored and attached to creator/video context.
7. Operator selects reviewed/approved videos and launches ads.
8. App tracks TikTok review outcome and surfaces approval/rejection reasons.

Yes, this overall flow makes sense and is a strong fit for Spark Ads operations.

---

## Current System Anchors

Existing code paths we should integrate with:

- `web/src/server/videos/mutations.ts`
  - `setVideoReviewForOrganization()`: best trigger point for "reviewed" workflow transitions.
  - `trackVideoForOrganization()`: existing video capture and mapping entrypoint.
- `web/src/server/creators/mutations.ts`
  - Existing creator/account tracking and campaign linking.
- `web/prisma/schema.prisma`
  - Existing entities: `Creator`, `Video`, `CampaignCreator`, `VideoReview`, `SourceMapping`.

---

## Scope

### In Scope

- Twilio messaging integration for inbound and outbound messaging.
- Creator-to-phone association.
- Spark code request messaging templates.
- Inbound parser + TikTok authorization apply flow.
- Ad launch flow from already approved internal videos.
- Audit logs and operational visibility.

### Out of Scope (Initial)

- Fully autonomous media planning/budget optimization.
- Auto-generation of campaign strategy beyond configured templates.
- Multi-language NLP extraction beyond deterministic Spark-code parsing.

---

## Proposed Architecture

### 1) Messaging Layer (Twilio)

- Outbound:
  - Use Twilio Programmable Messaging (Messaging Service SID preferred).
  - Support both SMS and WhatsApp send channels.
- Inbound:
  - Twilio webhook endpoint receives creator replies.
  - Validate Twilio signature before processing.
  - Store raw inbound payload for audit/debug.

### 2) Conversation + Parsing Layer

- Match incoming message to creator via normalized E.164 phone number and channel.
- Parse candidate Spark code from message body.
- If code found:
  - Store candidate.
  - Attempt TikTok authorization flow.
- If code missing/invalid:
  - Mark message as unparsed.
  - Optional automated "please resend code" response.

### 3) TikTok Authorization Layer

- Use parsed code to call:
  - `POST /open_api/v1.3/tt_video/authorize/`
  - `GET /open_api/v1.3/tt_video/info/`
- Persist:
  - `auth_code` metadata (masked in logs),
  - `item_id` (for `tiktok_item_id`),
  - `identity_id`,
  - `identity_type`,
  - `auth_start_time` / `auth_end_time`,
  - authorization status.

### 4) Ad Launch Layer

- From approved video selection:
  - Validate active Spark authorization exists and is not expired.
  - Create campaign/ad group/ad (or use one-step Spark endpoint where appropriate).
  - Optionally create in paused state first, then enable.
- Track review lifecycle via:
  - review info APIs,
  - subscription webhook events where available.

---

## Data Model Plan (Proposed)

Add dedicated messaging + authorization models instead of overloading existing fields.

### Creator Contact and Messaging

- `CreatorContactPoint`
  - `id`
  - `creatorId`
  - `channel` (`SMS`, `WHATSAPP`)
  - `phoneE164`
  - `isPrimary`
  - `verifiedAt`
  - `optInAt`
  - `optOutAt`
  - unique on (`channel`, `phoneE164`)

- `CreatorMessageThread`
  - `id`
  - `creatorId`
  - `channel`
  - `contactPointId`
  - `lastInboundAt`
  - `lastOutboundAt`
  - `state` (`IDLE`, `AWAITING_SPARK_CODE`, `CODE_RECEIVED`, `AUTH_APPLIED`, `FAILED`)

- `CreatorMessageEvent`
  - `id`
  - `threadId`
  - `direction` (`INBOUND`, `OUTBOUND`)
  - `providerMessageSid`
  - `body`
  - `parsedCode`
  - `parseStatus`
  - `rawPayload` (JSON)
  - `createdAt`

### Spark Authorization

- `SparkAuthorization`
  - `id`
  - `organizationId`
  - `creatorId`
  - `videoId` (nullable initially, attach when known)
  - `advertiserId`
  - `authCodeHash` (never store plain auth code in cleartext logs)
  - `identityId`
  - `identityType` (`AUTH_CODE`, `TT_USER`, `BC_AUTH_TT`)
  - `identityAuthorizedBcId` (nullable)
  - `tiktokItemId`
  - `authStartTime`
  - `authEndTime`
  - `status` (`PENDING`, `AUTHORIZED`, `FAILED`, `EXPIRED`, `REVOKED`)
  - `lastError`
  - `createdAt`
  - `updatedAt`

### Ad Launch Tracking

- `VideoAdLaunch`
  - `id`
  - `videoId`
  - `campaignId` (local)
  - `advertiserId`
  - `tiktokCampaignId`
  - `tiktokAdgroupId`
  - `tiktokAdId`
  - `operationStatus`
  - `secondaryStatus`
  - `reviewStatus`
  - `reviewRejectInfo` (JSON)
  - `createdAt`
  - `updatedAt`

---

## API and Backend Surface Plan

### New internal server modules (proposed)

- `web/src/server/messaging/twilio.ts`
  - Twilio client setup and send helpers.
- `web/src/server/messaging/parser.ts`
  - Spark code extraction logic.
- `web/src/server/spark-auth/service.ts`
  - TikTok `tt_video/authorize` + `tt_video/info` application logic.
- `web/src/server/ads/launch.ts`
  - TikTok ad creation orchestration.

### New route handlers (proposed)

- `POST /api/twilio/webhook/inbound`
  - Receive creator inbound messages.
- `POST /api/twilio/webhook/status`
  - Optional delivery status events.

### Existing mutation integration points

- Hook `setVideoReviewForOrganization()` to support workflow transition:
  - reviewed video can become "eligible for launch" only if valid Spark authorization exists.

---

## Parsing and Validation Strategy

Use deterministic extraction first (avoid AI dependency for this critical step):

1. Normalize whitespace/newlines.
2. Extract likely code candidates:
   - direct code token patterns,
   - values after labels like `code:`, `spark code`, `auth code`.
3. Try candidates in order against TikTok authorization endpoint.
4. First successful authorization wins.
5. Save parse attempts and final result for supportability.

Notes:

- TikTok auth codes may include characters like `+`, `/`, `=`.
- Preserve raw token and URL-encode correctly when needed.
- Never log full raw code in plaintext application logs.

---

## Messaging UX Plan

### Outbound template (initial)

- Request message:
  - "Hi {{creator_name}}, please send your TikTok Spark authorization code for video {{video_ref}}. Reply with just the code."

### Automated responses

- On successful apply:
  - "Thanks, got it. Your Spark authorization was applied."
- On parse failure:
  - "I could not read that code. Please paste the Spark code exactly as copied from TikTok."
- On TikTok reject:
  - "That code was not accepted. Please generate a new Spark code and resend."

---

## Security and Compliance

- Validate Twilio webhook signatures on every inbound request.
- Store minimal PII and secure phone data access by organization boundary.
- Mask codes and tokens in logs.
- Encrypt sensitive provider metadata at rest where possible.
- Add opt-out handling and compliance by channel:
  - SMS STOP semantics,
  - WhatsApp policy-compliant messaging windows/templates.

---

## Environment Variables (Planned Additions)

Add to `web/.env.example` when implementation starts:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_SMS_FROM`
- `TWILIO_WHATSAPP_FROM`
- `TWILIO_INBOUND_WEBHOOK_URL` (optional convenience)

TikTok-related env vars should remain in your existing auth config layer.

---

## Rollout Plan

### Phase 0: Foundation

- [ ] Add schema models + migrations.
- [ ] Add Twilio client wrapper.
- [ ] Add inbound webhook endpoint with signature validation.
- [ ] Add basic admin UI to link creator phone numbers.

### Phase 1: Spark Code Intake

- [ ] Add outbound request action from creator/video context.
- [ ] Persist message events and thread state.
- [ ] Add parser and attempt authorization flow.
- [ ] Store `SparkAuthorization` records and statuses.

### Phase 2: Ad Launch from Approved Videos

- [ ] Add "Launch ad" action for reviewed videos.
- [ ] Require valid non-expired Spark authorization before launch.
- [ ] Create campaign/adgroup/ad via TikTok APIs.
- [ ] Store TikTok IDs and launch status in `VideoAdLaunch`.

### Phase 3: Review Monitoring + Ops

- [ ] Add polling for `ad/review_info` and `adgroup/review_info`.
- [ ] Add webhook subscriptions where useful.
- [ ] Surface reject reasons in UI with retry path.
- [ ] Add dashboards and alerting for failed auth/launches.

---

## Success Metrics

- Time from creator request to valid Spark authorization.
- Authorization success rate from inbound messages.
- Time from video review to ad launch.
- Ad launch failure rate (by cause).
- Ad review rejection rate and top reject reasons.

---

## Risks and Mitigations

- Risk: creators send malformed/non-code replies.
  - Mitigation: deterministic parser + guided auto-reply + manual override path.
- Risk: expired or revoked authorizations.
  - Mitigation: enforce auth window checks before launch and preflight revalidation.
- Risk: duplicate inbound events and retries.
  - Mitigation: idempotency keys from Twilio message SID and request signatures.
- Risk: channel policy issues (WhatsApp/SMS).
  - Mitigation: compliant templates, opt-out handling, and rate controls.

---

## Open Questions

- Should one creator have multiple active contact points by default?
- Should ad launch be automatic when review is marked, or always operator-confirmed?
- Do we need approval routing for legal/compliance before sending outbound messages?
- Should Spark authorizations be tied to creator only, or strictly to creator+video?
- Do we need separate advertiser account mappings per organization/campaign?

---

## Implementation Details (V1)

This section is the execution blueprint for implementation.

### Guiding Decisions

1. Keep queue check-off and ad-launch approval separate.
   - `setVideoReviewForOrganization()` tracks per-user review queue progress.
   - Add a separate org-level "approved for launch" state so one reviewer checking off a queue item does not accidentally launch ads.
2. Make Spark code collection request-scoped.
   - Each outbound request includes a short request token (example: `BV-7K2M`) so inbound replies can be mapped to the right pending request.
3. Build for retries and idempotency.
   - Twilio webhooks can be repeated.
   - TikTok calls can fail transiently.
   - We should rely on provider IDs and unique constraints to make all handlers retry-safe.

### Current App Touchpoints

- Existing backend:
  - `web/src/server/videos/mutations.ts` (`setVideoReviewForOrganization`, `trackVideoForOrganization`)
  - `web/src/server/creators/mutations.ts`
  - `web/src/lib/server-env.ts`
- Existing UI:
  - `web/src/app/org/[organizationSlug]/integrations/page.tsx` (currently placeholder)
  - `web/src/app/org/[organizationSlug]/creators/page.tsx`
  - `web/src/app/org/[organizationSlug]/review/page.tsx`
  - `web/src/app/org/[organizationSlug]/videos/page.tsx`

### Prisma Schema Plan (Concrete)

Add new enums:

- `MessagingChannel`: `SMS`, `WHATSAPP`
- `MessageDirection`: `INBOUND`, `OUTBOUND`
- `MessageParseStatus`: `NOT_ATTEMPTED`, `NO_CODE_FOUND`, `CODE_FOUND`, `APPLIED`, `FAILED`
- `SparkCodeRequestStatus`: `PENDING`, `RECEIVED`, `AUTHORIZED`, `FAILED`, `EXPIRED`, `CANCELLED`
- `SparkAuthorizationStatus`: `PENDING`, `AUTHORIZED`, `FAILED`, `EXPIRED`, `REVOKED`
- `VideoLaunchApprovalStatus`: `PENDING`, `APPROVED`, `REJECTED`
- `VideoAdLaunchStatus`: `QUEUED`, `LAUNCHED`, `REVIEW_PENDING`, `REVIEW_APPROVED`, `REVIEW_REJECTED`, `FAILED`

Add new models:

- `OrganizationTwilioConfig`
  - `organizationId` (unique)
  - `messagingServiceSid`
  - `smsFrom`
  - `whatsappFrom`
  - `enabled`
  - `createdAt`, `updatedAt`

- `OrganizationTikTokAccount`
  - `organizationId`
  - `advertiserId`
  - `accessToken`
  - `scope` (JSON/string[])
  - `status`
  - `lastValidatedAt`
  - `createdAt`, `updatedAt`
  - Unique: (`organizationId`, `advertiserId`)

- `CreatorContactPoint`
  - `creatorId`
  - `channel`
  - `phoneE164`
  - `isPrimary`
  - `verifiedAt`, `optInAt`, `optOutAt`
  - `createdAt`, `updatedAt`
  - Unique: (`channel`, `phoneE164`)

- `SparkCodeRequest`
  - `organizationId`, `creatorId`, `videoId`
  - `channel`
  - `requestToken` (unique)
  - `status`
  - `requestedAt`, `expiresAt`
  - `lastError`
  - `createdAt`, `updatedAt`

- `CreatorMessageEvent`
  - `organizationId`, `creatorId`, `sparkCodeRequestId?`
  - `direction`
  - `providerMessageSid` (unique)
  - `channel`
  - `fromE164`, `toE164`
  - `body`
  - `parseStatus`
  - `parsedCodeHash`
  - `rawPayload` (JSON)
  - `createdAt`

- `SparkAuthorization`
  - `organizationId`, `creatorId`, `videoId`
  - `advertiserId`
  - `authCodeHash`
  - `identityType`, `identityId`, `identityAuthorizedBcId?`
  - `tiktokItemId`
  - `authStartTime`, `authEndTime`
  - `status`
  - `lastError`
  - `createdAt`, `updatedAt`

- `VideoLaunchApproval`
  - `videoId` (unique)
  - `organizationId`
  - `status`
  - `decidedByUserId`
  - `decidedAt`
  - `notes`
  - `createdAt`, `updatedAt`

- `VideoAdLaunch`
  - `videoId`
  - `organizationId`
  - `advertiserId`
  - `tiktokCampaignId`, `tiktokAdgroupId`, `tiktokAdId`
  - `operationStatus`, `secondaryStatus`, `reviewStatus`
  - `rejectInfo` (JSON)
  - `status`
  - `lastError`
  - `createdAt`, `updatedAt`
  - Index: (`organizationId`, `status`, `createdAt`)

### Environment and Validation Plan

Add env vars to `web/.env.example`:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_SMS_FROM`
- `TWILIO_WHATSAPP_FROM`

Update `web/src/lib/server-env.ts`:

- Add Twilio schema and `getTwilioEnv()`.
- Keep tokens and secrets server-only.

### File/Module Plan

New server modules:

- `web/src/server/messaging/twilio-client.ts`
  - Twilio send wrapper.
  - Signature verification helper.
- `web/src/server/messaging/parser.ts`
  - Extract request token and Spark code candidates from text.
- `web/src/server/messaging/mutations.ts`
  - Add/update creator contact points.
  - Send Spark code request messages.
- `web/src/server/tiktok-business/client.ts`
  - Shared TikTok request wrapper and error shape.
- `web/src/server/spark-auth/service.ts`
  - `tt_video/authorize` and `tt_video/info` orchestration.
- `web/src/server/ads/mutations.ts`
  - Launch approval actions.
  - Ad launch orchestration.
- `web/src/server/ads/review-sync.ts`
  - Review polling and status refresh.

New API routes:

- `web/src/app/api/webhooks/twilio/inbound/route.ts`
- `web/src/app/api/webhooks/twilio/status/route.ts` (optional but recommended)
- `web/src/app/api/cron/ad-review-sync/route.ts` (protected by `CRON_SECRET`)

### Twilio Inbound Webhook Flow (Exact)

1. Receive `application/x-www-form-urlencoded` payload.
2. Validate `X-Twilio-Signature`.
3. Normalize sender and destination:
   - infer channel from `From` prefix (`whatsapp:` vs phone-only),
   - normalize to E.164.
4. Upsert inbound event by `MessageSid` (idempotent).
5. Resolve creator via `CreatorContactPoint` (`channel + phoneE164`).
6. Resolve active `SparkCodeRequest`:
   - first by request token from message body,
   - fallback to most recent pending request for that creator and channel.
7. Parse Spark code candidates from message.
8. Attempt TikTok authorization candidate-by-candidate.
9. On success:
   - save/update `SparkAuthorization`,
   - mark request as `AUTHORIZED`,
   - optionally send confirmation message.
10. On failure:
   - mark request as `FAILED` or keep `PENDING` with `lastError` based on failure type,
   - optionally send "please resend code" guidance.

### Spark Code Parsing Strategy

Deterministic parser first (no AI dependency):

1. Normalize text (spaces/newlines).
2. Pull token if present (example pattern `BV-[A-Z0-9]{4,8}`).
3. Extract code candidates:
   - after labels (`spark code`, `auth code`, `code:`),
   - full-line token-like candidates.
4. Try each candidate against TikTok authorization endpoint.
5. Store parse result and attempt traces.

Important:

- Spark codes may contain `+`, `/`, `=`.
- Never store raw code in logs.
- Store hashes for traceability.

### TikTok Authorization Apply Flow

For each candidate:

1. `POST /open_api/v1.3/tt_video/authorize/` with `advertiser_id`, `auth_code`.
2. `GET /open_api/v1.3/tt_video/info/` with `advertiser_id`, `auth_code`.
3. Persist:
   - `identity_id`, `identity_type`,
   - `item_id` as `tiktokItemId`,
   - `auth_start_time`, `auth_end_time`,
   - status + error details.

### Ad Launch Flow (Exact)

From an operator action:

1. Validate org access and role permissions.
2. Require `VideoLaunchApproval.status = APPROVED`.
3. Require valid non-expired `SparkAuthorization`.
4. Build payload from org defaults + selected campaign settings.
5. Create hierarchy:
   - `/campaign/create/`
   - `/adgroup/create/`
   - `/ad/create/` with Spark fields (`identity_type`, `identity_id`, `tiktok_item_id`, optional `identity_authorized_bc_id`)
6. Persist TikTok IDs in `VideoAdLaunch`.
7. Set launch status to `REVIEW_PENDING`.
8. Review sync job updates final outcome.

### Review Status Sync Plan

Use periodic sync:

- `GET /open_api/v1.3/ad/review_info/`
- `GET /open_api/v1.3/adgroup/review_info/`
- `GET /open_api/v1.3/ad/get/` filtering by `secondary_status` where useful.

Persist:

- `reviewStatus`
- `secondaryStatus`
- reject reasons/suggestions (`rejectInfo` JSON)

### UI Plan (Concrete)

- `integrations` page:
  - Replace placeholder with Twilio and TikTok config forms.
  - Add "test outbound message" action.
- `creators` page:
  - Add contact points panel (SMS/WhatsApp).
  - Add "Request Spark code" action scoped to creator + video.
- `review` page:
  - Keep check-off behavior.
  - Add explicit "Approve for ad launch" toggle/action (org-level).
- New page:
  - `web/src/app/org/[organizationSlug]/ads/page.tsx`
  - Queue approved videos, launch actions, and review status cards.

### Reliability and Idempotency Rules

- Unique on `providerMessageSid` for inbound events.
- Unique request tokens for Spark requests.
- Upsert on launch rows per (`videoId`, active launch) to prevent duplicates.
- Retry-safe server actions and webhook handlers.

### Security/Compliance Implementation Notes

- Validate Twilio signatures in webhook routes.
- Enforce org boundaries in all queries.
- Mask secrets and auth codes in all logs.
- Add SMS opt-out handling (`STOP`, `START`).
- Respect WhatsApp template/session policy for outbound messaging.

### Testing Plan

1. Unit tests:
   - parser extraction cases,
   - Twilio signature validator,
   - TikTok client error mapping.
2. Integration tests:
   - inbound webhook -> request match -> auth apply.
   - launch flow with mocked TikTok responses.
3. Manual E2E:
   - creator receives request,
   - replies with code,
   - auth appears in UI,
   - approved video launches,
   - review status updates.

### Suggested PR Breakdown

PR 1:

- Prisma models/enums + migrations.
- Env additions + `server-env` parsing.

PR 2:

- Twilio client + inbound webhook route + signature validation.
- Message event persistence.

PR 3:

- Creator contact point UI + mutations.
- Spark code request sending action.

PR 4:

- Spark auth apply service (`tt_video/authorize` + `tt_video/info`).
- Request state machine + automated replies.

PR 5:

- Video launch approval model and actions.
- Ad launch orchestration and ads page.

PR 6:

- Review sync cron + status dashboards + retry tools.

---

## Decision Log

- 2026-03-17: Plan established for Twilio-mediated Spark code collection and ad launch workflow.
- 2026-03-17: Added concrete V1 implementation blueprint (schema, endpoints, flows, and PR sequence).

