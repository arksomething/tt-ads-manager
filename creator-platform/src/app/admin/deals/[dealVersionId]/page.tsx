import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AgreementTerms } from "@/components/agreement-terms";
import { AdminWorkspaceShell } from "@/components/admin-workspace-shell";
import { requireCreatorStaff } from "@/server/admin/access";
import { getAdminDealTemplateSourceArtifact } from "@/server/admin/deal-template-source";
import {
  adminDealActivationConfirmation,
  getAdminDealDetail,
  signWellBindingVerificationAttestation,
  type AdminDealAuditEvent,
} from "@/server/admin/deals";

import styles from "../admin-deals.module.css";
import {
  DealStateBadge,
  EconomicsSummary,
  formatDate,
  ReadinessPanel,
} from "../deal-display";
import { EditDealDraftForm, SealDealDraftForm } from "../deal-forms";
import { DealReleaseControls } from "../deal-release-controls";

export const metadata: Metadata = { title: "Deal version detail" };
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function title(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function auditEvidence(event: AdminDealAuditEvent) {
  const metadata = event.metadata;
  return [
    metadata.approvalKind ? `Approval gate: ${title(metadata.approvalKind)}` : null,
    metadata.approvalNote ? `Approval reference: ${metadata.approvalNote}` : null,
    metadata.originalApprover ? `Original approver: ${metadata.originalApprover}` : null,
    metadata.revocationNote ? `Revocation reason: ${metadata.revocationNote}` : null,
    metadata.newAssignmentsBlocked === null
      ? null
      : `New assignments blocked: ${metadata.newAssignmentsBlocked ? "Yes" : "No"}`,
    metadata.provider ? `Provider: ${title(metadata.provider)} · ${metadata.environment}` : null,
    metadata.templateId ? `Template ID: ${metadata.templateId}` : null,
    metadata.sourceArtifactId ? `Archived source ID: ${metadata.sourceArtifactId}` : null,
    metadata.templateSourceSha256
      ? `Template source SHA-256: ${metadata.templateSourceSha256}`
      : null,
    metadata.originalFilename ? `Archived file: ${metadata.originalFilename}` : null,
    metadata.contentType ? `Content type: ${metadata.contentType}` : null,
    metadata.byteSize === null ? null : `Archived bytes: ${metadata.byteSize}`,
    metadata.verificationState
      ? `Verification state: ${title(metadata.verificationState)}`
      : null,
    metadata.verificationMethod
      ? `Verification method: ${title(metadata.verificationMethod)}`
      : null,
    metadata.attestationText ? `Attestation: ${metadata.attestationText}` : null,
    metadata.replacementDealVersionId
      ? `Replacement deal version: ${metadata.replacementDealVersionId}`
      : null,
    metadata.replacementSnapshotHash
      ? `Replacement snapshot: ${metadata.replacementSnapshotHash}`
      : null,
    metadata.previousDefaultDealVersionId
      ? `Previous default deal version: ${metadata.previousDefaultDealVersionId}`
      : null,
    metadata.activationConfirmation
      ? `Activation confirmation: ${metadata.activationConfirmation}`
      : null,
    metadata.readinessRecomputedUnderLock === null
      ? null
      : `Readiness recomputed under lock: ${metadata.readinessRecomputedUnderLock ? "Yes" : "No"}`,
  ].filter((line): line is string => line !== null);
}

type PageProps = { params: Promise<{ dealVersionId: string }> };

export default async function AdminDealDetailPage({ params }: PageProps) {
  const { dealVersionId } = await params;
  if (!uuidPattern.test(dealVersionId)) notFound();
  const { account, staff } = await requireCreatorStaff(`/admin/deals/${dealVersionId}`);
  const [result, templateSourceResult] = await Promise.all([
    getAdminDealDetail(dealVersionId)
      .then((deal) => ({ deal, unavailable: false }))
      .catch(() => ({ deal: null, unavailable: true })),
    getAdminDealTemplateSourceArtifact(dealVersionId)
      .then((artifact) => ({ artifact, unavailable: false }))
      .catch(() => ({ artifact: null, unavailable: true })),
  ]);
  if (!result.unavailable && !result.deal) notFound();
  const deal = result.deal;

  return (
    <AdminWorkspaceShell
      active="deals"
      role={staff.role}
      eyebrow="Program governance"
      title="Deal version"
      description="Inspect the exact stored terms, economics, hashes, release gates, provider bindings, approvals, and immutable audit history."
    >
      <Link className={styles.backLink} href="/admin/deals"><ArrowLeft aria-hidden="true" size={13} />Deal catalog</Link>

      {result.unavailable || !deal ? (
        <p className={styles.error} role="alert">
          This deal version is temporarily unavailable. No term, hash, assignment, approval, or provider state is being claimed. Return to the catalog and refresh before acting.
        </p>
      ) : (
        <>
          <div className={styles.detailHeader}>
            <div>
              <DealStateBadge deal={deal} />
              <h1>{deal.label}</h1>
              <p>{deal.dealKey} · Version {deal.version} · Draft revision {deal.draftRevision}</p>
            </div>
            <span className={styles.badge} data-tone="muted">{deal.assignmentCount} assigned</span>
          </div>

          <p className={styles.notice}>
            <strong>The public sample is separate and non-binding</strong>
            It cannot be imported into this record, activated, assigned, or sent for signature. Only the exact database terms and hashes below describe this version.
          </p>

          <div className={styles.detailLayout}>
            <div className={styles.stack}>
              <section className={styles.panel} aria-labelledby="terms-title">
                <header className={styles.panelHeader}>
                  <div><h2 id="terms-title">Exact legal terms</h2><p>Rendered from the database record, not from the reference sample.</p></div>
                  <span className={styles.badge} data-tone={deal.termsMarkdown.trim() ? "muted" : "warn"}>{deal.termsMarkdown.trim() ? "Stored terms" : "Blank draft"}</span>
                </header>
                <div className={styles.preview}>
                  {deal.termsMarkdown.trim() ? (
                    <AgreementTerms headingOffset={2} markdown={deal.termsMarkdown} />
                  ) : (
                    <p className={styles.emptyTerms}>No legal terms are recorded. This version cannot be treated as an offer or agreement.</p>
                  )}
                </div>
              </section>

              <section className={styles.panel} aria-labelledby="economics-title">
                <header className={styles.panelHeader}>
                  <div><h2 id="economics-title">Structured economics</h2><p>Internal calculation inputs must match the signed prose exactly.</p></div>
                  <span className={styles.badge} data-tone="muted">Schema v{deal.economics?.schemaVersion ?? "—"}</span>
                </header>
                <div className={styles.panelBody}><EconomicsSummary economics={deal.economics} /></div>
              </section>

              {deal.status === "draft" ? (
                <section className={styles.panel} aria-labelledby="edit-title">
                  <header className={styles.panelHeader}>
                    <div><h2 id="edit-title">Revise internal draft</h2><p>Every successful save advances the optimistic draft revision and audit history.</p></div>
                  </header>
                  <div className={styles.panelBody}>
                    {staff.role === "admin" ? (
                      <EditDealDraftForm deal={deal} />
                    ) : (
                      <p className={styles.readOnly}>Reviewer access is read-only. You can inspect this draft and its evidence, but only an administrator can save or seal it.</p>
                    )}
                  </div>
                </section>
              ) : null}

              <DealReleaseControls
                activationConfirmation={adminDealActivationConfirmation}
                actorUserId={account.id}
                deal={deal}
                role={staff.role}
                templateSourceArtifact={templateSourceResult.artifact}
                templateSourceUnavailable={templateSourceResult.unavailable}
                verificationAttestation={signWellBindingVerificationAttestation}
              />

              <section className={styles.panel} aria-labelledby="audit-title">
                <header className={styles.panelHeader}>
                  <div><h2 id="audit-title">Audit history</h2><p>Database-recorded changes for this deal version.</p></div>
                  <span className={styles.badge} data-tone="muted">{deal.auditEvents.length} events</span>
                </header>
                <div className={styles.panelBody}>
                  {deal.auditEvents.length ? (
                    <ol className={styles.auditList}>
                      {deal.auditEvents.map((event) => (
                        <li key={event.id}>
                          <strong>{title(event.type)}</strong>
                          <p>
                            Revision {event.draftRevision}
                            {event.fromStatus || event.toStatus ? ` · ${title(event.fromStatus ?? "none")} → ${title(event.toStatus ?? "none")}` : ""}
                            {event.metadata.changedFields.length ? ` · ${event.metadata.changedFields.map(title).join(", ")}` : ""}
                          </p>
                          {event.metadata.changeNote ? <p>{event.metadata.changeNote}</p> : null}
                          {event.metadata.snapshotHash ? <p className={styles.hash}>Snapshot {event.metadata.snapshotHash}</p> : null}
                          {auditEvidence(event).map((line) => (
                            <p className={styles.hash} key={line}>{line}</p>
                          ))}
                          <time dateTime={event.createdAt}>{formatDate(event.createdAt)} · Actor {event.actorUserId}</time>
                        </li>
                      ))}
                    </ol>
                  ) : <p className={styles.emptyTerms}>No audit event is available for this version.</p>}
                </div>
              </section>
            </div>

            <aside className={styles.detailSidebar}>
              <ReadinessPanel deal={deal} />

              <section className={styles.panel} aria-labelledby="identity-title">
                <header className={styles.panelHeader}><div><h2 id="identity-title">Version identity</h2><p>Full hashes are shown for exact comparison.</p></div></header>
                <div className={styles.panelBody}>
                  <dl className={styles.definitionList}>
                    <div><dt>Terms SHA-256</dt><dd className={styles.hash}>{deal.termsHash}</dd></div>
                    <div><dt>Economics SHA-256</dt><dd className={styles.hash}>{deal.economicsHash ?? "Not recorded"}</dd></div>
                    <div><dt>Snapshot SHA-256</dt><dd className={styles.hash}>{deal.snapshotHash}</dd></div>
                    <div><dt>Provider template hash</dt><dd className={styles.hash}>{deal.providerTemplateHash ?? "Not bound"}</dd></div>
                    <div><dt>Created</dt><dd>{formatDate(deal.createdAt)}</dd></div>
                    <div><dt>Updated</dt><dd>{formatDate(deal.updatedAt)}</dd></div>
                    <div><dt>Effective</dt><dd>{formatDate(deal.effectiveAt)}</dd></div>
                    <div><dt>Sealed</dt><dd>{formatDate(deal.sealedAt)}</dd></div>
                  </dl>
                </div>
              </section>

              <section className={styles.panel} aria-labelledby="provider-title">
                <header className={styles.panelHeader}>
                  <div><h2 id="provider-title">Provider bindings</h2><p>Template identity must match this version.</p></div>
                  <span className={styles.badge} data-tone="muted">{deal.providerBindingCount}</span>
                </header>
                <div className={styles.panelBody}>
                  {deal.providerBindings.length ? (
                    <ul className={styles.auditList}>
                      {deal.providerBindings.map((binding) => (
                        <li key={binding.id}>
                          <strong>{title(binding.provider)} · {binding.environment}</strong>
                          <p><span className={styles.badge} data-tone={binding.status === "verified" ? "ok" : binding.status === "disabled" ? "muted" : "warn"}>{title(binding.status)}</span></p>
                          <p className={styles.hash}>Source archive {binding.sourceArtifactId ?? "Not linked"}</p>
                          <p className={styles.hash}>Template {binding.templateHash}</p>
                          <p className={styles.hash}>Bound snapshot {binding.boundSnapshotHash}</p>
                          <time dateTime={binding.updatedAt}>Verified {formatDate(binding.verifiedAt)} · Updated {formatDate(binding.updatedAt)}</time>
                        </li>
                      ))}
                    </ul>
                  ) : <p className={styles.emptyTerms}>No signing-provider template is bound to this version.</p>}
                </div>
              </section>

              <section className={styles.panel} aria-labelledby="approvals-title">
                <header className={styles.panelHeader}>
                  <div><h2 id="approvals-title">Recorded approvals</h2><p>Approvals are bound to an exact snapshot hash.</p></div>
                  <span className={styles.badge} data-tone="muted">{deal.approvalCount}</span>
                </header>
                <div className={styles.panelBody}>
                  {deal.approvals.length ? (
                    <ul className={styles.auditList}>
                      {deal.approvals.map((approval) => (
                        <li key={approval.id}>
                          <strong>{title(approval.kind)} approval</strong>
                          <p><span className={styles.badge} data-tone={approval.status === "approved" ? "ok" : "danger"}>{title(approval.status)}</span></p>
                          {approval.note ? <p>{approval.note}</p> : null}
                          <p className={styles.hash}>Snapshot {approval.snapshotHash}</p>
                          <time dateTime={approval.approvedAt}>{formatDate(approval.approvedAt)} · Approver {approval.approvedBy}{approval.revokedAt ? ` · Revoked ${formatDate(approval.revokedAt)}` : ""}</time>
                        </li>
                      ))}
                    </ul>
                  ) : <p className={styles.emptyTerms}>No business or legal approval is recorded for this exact snapshot.</p>}
                </div>
              </section>

              {deal.status === "draft" && staff.role === "admin" ? <SealDealDraftForm deal={deal} /> : null}
              {staff.role === "reviewer" ? <p className={styles.readOnly}>Reviewer access is read-only. No activation, assignment, provider-binding, approval, or signing mutation is available here.</p> : null}
            </aside>
          </div>
        </>
      )}
    </AdminWorkspaceShell>
  );
}
