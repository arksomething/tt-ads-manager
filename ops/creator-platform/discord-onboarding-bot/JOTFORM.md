# Jotform agreement integration

Configured form: `262582983401057` (GoTall Creator Agreement), owned by the
personal Jotform account. It replaced the old-account forms `262551606074051`
and `262506982690062` on September 16, 2026.

The production bot uses the personal account's Jotform API key (Full Access for
webhook registration), stored as an encrypted systemd credential on XPS. No key
belongs in Git, Discord, URLs, or logs.
The account UI currently labels this key `New API Key`.

## Signing flow

1. Approving warm-up generates a random private agreement reference and includes
   it in the creator's Review & sign link. Only the reference, not their Discord
   ID or contact details, is sent to Jotform.
2. Hidden optional form field 66, `gotallAgreementToken`, preserves the reference.
   The contract text and signature requirements are preserved from the source form.
3. Jotform sends submissions to a dedicated HTTPS webhook through Cloudflare
   Tunnel. The endpoint persists a coalesced check request, acknowledges it, and
   immediately requests an authenticated Jotform scan. Form payloads are discarded,
   never used as approval evidence. The creator does not need a confirmation button;
   five-minute polling remains the fallback. No inbound firewall port is opened.
4. Complete linked submissions automatically open first-video preparation and
   record the provider submission ID. The creator receives a next-step message;
   the private staff channel receives a Manager-role notification with the
   submission link. No staff signature approval is required. Draft approval
   before publication remains unchanged.
5. Progression, evidence and both notifications are saved in one transaction.
   Retries/restarts do not repeat the transition or notifications. Previously
   received complete submissions still awaiting review are rechecked by the
   next poll and advanced. Signing through an old unlinked URL is not guessed.
   API field presence does not establish identity or legal validity.

Missing creator name, signature or date, and partially filled guardian sections,
cannot pass the API check. The underlying form currently permits blank signature
fields, so the integration enforces completeness independently. If a guardian is
required but their entire section is absent, the bot cannot infer that requirement
from the current form. Guardian eligibility is not automatically verified.

Existing submissions without a reference are not matched by name or nickname.
Creators in agreement/review get a linked URL when their card refreshes. If they
already signed through an old link, staff must resolve the original receipt
deliberately; don't ask them to sign twice without reviewing it first. Custom
non-default agreement URLs keep the existing manual verification path.

## Runtime configuration

Install `jotform.conf` as
`/etc/systemd/system/gotall-discord-onboarding-test.service.d/jotform.conf`.
Credential source:
`/etc/credstore.encrypted/gotall-jotform-api-key.cred`, encrypted with name
`jotform-api-key`. The installer includes the new `jotform.mjs` dependency.
The runtime stays restricted to Retconned's test guild.

`jotform_requests` stores active signing references. `jotform_receipts` stores
submission IDs, field-presence checks, timestamps and a SHA-256 response digest.
Raw signature images and submission answers are not copied to the bot database.
Reopening onboarding invalidates the old reference. Receipt processing, creator
notifications and Manager notifications use the existing durable delivery queue.

API failures fail closed for approval and are logged without response bodies or
credentials. Normal Discord work continues. The scan paginates up to 1,000
submissions and reports a backlog error beyond that bound. Large-scale rollout
should use an incremental cursor or verified webhook-triggered API reads.

## Verification

Run `node --test *.test.mjs` from this directory with Node 24.
Tests cover reference isolation, duplicate receipt/restart behavior, pagination,
missing and malformed signatures/dates, guardian partial completion, deleted
submissions, outages, automatic progression, Manager routing, rollback, migration
of pending review receipts, and idempotent creator messages.
Live API reads verify account/form access and the actual field mapping.
Browser verification confirms the reference prefill is retained in the hidden
input on the live signing form. The deployed service connected to Discord with
zero restarts; 77 Node tests passed in the release validation.
No real contract was signed or fabricated for testing.

API references: https://api.jotform.com/docs/ and
https://github.com/jotform/jotform-api-python/blob/master/jotform.py

## Webhook deployment (September 12)

Public host: `gotall-webhooks.billionviews.app`. The private webhook path is a
random credential; do not copy it into logs, source control or chat. It is stored
in `/etc/credstore.encrypted/gotall-jotform-webhook-secret.cred` and loaded by
`jotform-webhook.conf`. The bot listens only on `127.0.0.1:18764`.
`gotall-jotform-tunnel.service` connects the dedicated tunnel to Cloudflare.
The tunnel config and service templates are checked in alongside this file.

`register-jotform-webhook.mjs` probes the public endpoint, registers it using
host-held credentials, and checks registration without printing secrets. It
preserves other webhooks. The bot installer includes the webhook runtime module;
install the tunnel unit/config and service drop-in when provisioning a new host.

Checks survive restarts, coalesce bursts, retry failures after 30 seconds, and
reuse transactional receipt processing and idempotent notifications. The endpoint
accepts POST only, requires the secret path and limits bodies to 1 MiB. Contract
answers and signatures are neither logged nor stored from webhook requests.

Verified: public HTTPS probe accepted and processed, provider registration read
back, automated linked receipt advances within the same check even during the
five-minute polling cooldown, one creator and one Manager notification. A new
real signed submission has not been created for this verification.
