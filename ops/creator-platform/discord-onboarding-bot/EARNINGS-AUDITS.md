# Earnings audit downloads

`/payments` displays a calculation snapshot. Audit log lists previous successful
calculations for the selected creator and month; Download PDF exports the selected
snapshot plus its exact normalized JSON inputs. Downloading does not recalculate.

The root earnings worker captures deal versions, per-video overrides, calculator
source fingerprints, line items, warnings and independent arithmetic checks.
Successful records are appended to `creator_earnings_audits` in the existing bot
SQLite database. Update/delete triggers protect normal application writes, and a
SHA-256 check detects changed payloads before export. This is not an external
signature or protection against an administrator replacing the entire database.
Include this table in regular database backups. Failed requests do not replace
the last successful snapshot; retries with the same request ID are idempotent.

PDFs are generated in memory using system Python and ReportLab (`python3-reportlab`
on Ubuntu). No payment credentials are included. Account ownership is checked
before download; interaction downloads are ephemeral. Discord hosts the resulting
attachments after delivery.

The report separates arithmetic reconciliation from source completeness. Unknown
paid traffic, capped provider results and decimal rounding differences remain
visible. A matching total is not evidence that a settlement is final.
