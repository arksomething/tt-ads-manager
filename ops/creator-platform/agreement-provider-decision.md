# Creator agreement provider decision

Status: researched, provider not yet selected or integrated.

## Recommendation

Use the creator platform's confirmed Supabase account as the identity boundary
and add **SignWell** as the first signing adapter once the agreement template and
guardian rules are approved. SignWell is the best early-volume fit because it
supports reusable templates, embedded signing, ordered multi-party recipients,
webhooks, and an audit page without the large fixed platform cost of DocuSign.

Budget conservatively from the allowance shown in the live SignWell account.
Its public pages currently describe a small included allowance and usage above
the allowance starting around $0.85 per document, but the wording about the
initial free allowance is inconsistent across those pages. Confirm the actual
entitlement before entering a payment method.

Official references:

- <https://www.signwell.com/api-pricing/>
- <https://www.signwell.com/pricing/>
- <https://developers.signwell.com/reference/createdocumentfromtemplate>
- <https://www.signwell.com/security/>

## Fallbacks and thresholds

| Provider | Appropriate use | Important constraint |
| --- | --- | --- |
| SignWell | Default low-volume creator agreement adapter | Confirm the live included-document allowance before launch |
| PandaDoc Free | Temporary zero-cost fallback for creator plus GoTall | 60 sends per year, five templates, and exactly two recipients; it does not fit creator plus guardian plus GoTall |
| BoldSign API | Re-evaluate near 35–40 agreements per month | $30 per month includes 40 envelopes; fixed spend starts immediately |
| First-party clickwrap | Policies, community rules, and acknowledgements | Do not substitute it for the bilateral creator agreement without counsel approval |

PandaDoc and BoldSign references:

- <https://www.pandadoc.com/blog/pandadoc-free-plan-api/>
- <https://support.pandadoc.com/en/articles/9715030-pandadoc-free-plan-guide>
- <https://www.pandadoc.com/developer-api/pricing/>
- <https://boldsign.com/esignature-api/>

DocuSign, Dropbox Sign embedded, and Documenso's hosted Platform plan were
rejected for the initial volume because their fixed platform pricing is
disproportionate to the expected number of agreements. Self-hosting a signing
system is also not the cheap option once certificate management, email,
storage, backups, updates, and evidentiary reliability are included.

## Required integration contract

The database remains provider-neutral. A future adapter must:

1. create an agreement from the exact immutable deal version assigned at
   approval;
2. support creator, optional guardian, and optional GoTall countersigner roles;
3. authenticate and deduplicate webhook events before changing state;
4. never treat a browser return URL as completion evidence;
5. download the completed PDF and audit certificate to private storage;
6. hash the completed evidence and record the provider document and event IDs;
7. unlock the creator workspace only after verified completion; and
8. retain a separate first-party acceptance ledger for non-contract policies.

Before enabling live signing, counsel must approve the agreement text,
retention requirements, governing jurisdiction, and the handling of creators
under 18. E-SIGN and UETA recognize electronic records and signatures, but they
do not make every click flow or agreement automatically enforceable.
