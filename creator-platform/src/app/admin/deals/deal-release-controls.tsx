"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type { AdminDealTemplateSourceArtifact } from "@/server/admin/deal-template-source";
import type {
  AdminDealApproval,
  AdminDealDetail,
  AdminDealProviderBinding,
} from "@/server/admin/deals";

import styles from "./admin-deals.module.css";

type DealReleaseControlsProps = {
  activationConfirmation: string;
  actorUserId: string;
  deal: AdminDealDetail;
  role: "admin" | "reviewer";
  templateSourceArtifact: AdminDealTemplateSourceArtifact | null;
  templateSourceUnavailable: boolean;
  verificationAttestation: string;
};

type MutationName =
  | "artifact-upload"
  | "binding"
  | "binding-verification"
  | "business-approval"
  | "legal-approval"
  | "business-revocation"
  | "legal-revocation"
  | "activation";

type ReleaseApiResult = {
  artifact?: {
    id?: unknown;
    dealVersionId?: unknown;
    snapshotHash?: unknown;
    templateId?: unknown;
    sourceSha256?: unknown;
  };
  deal?: {
    id?: unknown;
    snapshotHash?: unknown;
  };
  error?: unknown;
};

const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

function inputValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function exactActiveApproval(
  approvals: AdminDealApproval[],
  kind: AdminDealApproval["kind"],
  snapshotHash: string,
) {
  return approvals.filter((approval) => (
    approval.kind === kind &&
    approval.status === "approved" &&
    approval.snapshotHash === snapshotHash
  ));
}

function currentProductionBindings(deal: AdminDealDetail) {
  return deal.providerBindings.filter((binding) => (
    binding.provider === "signwell" &&
    binding.environment === "production" &&
    binding.status !== "disabled" &&
    binding.boundSnapshotHash === deal.snapshotHash
  ));
}

function StatusMessages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
    </>
  );
}

function BindingSummary({ binding }: { binding: AdminDealProviderBinding }) {
  return (
    <dl className={styles.releaseEvidence}>
      <div><dt>Production template ID</dt><dd>{binding.templateId}</dd></div>
      <div><dt>Archived source SHA-256</dt><dd>{binding.templateHash}</dd></div>
      <div><dt>Bound deal snapshot</dt><dd>{binding.boundSnapshotHash}</dd></div>
    </dl>
  );
}

function ArtifactSummary({ artifact }: { artifact: AdminDealTemplateSourceArtifact }) {
  return (
    <dl className={styles.releaseEvidence}>
      <div><dt>Archived file</dt><dd>{artifact.originalFilename}</dd></div>
      <div><dt>Production template ID</dt><dd>{artifact.templateId}</dd></div>
      <div><dt>Server-computed SHA-256</dt><dd>{artifact.sourceSha256}</dd></div>
      <div><dt>Bound deal snapshot</dt><dd>{artifact.snapshotHash}</dd></div>
      <div><dt>Archive size</dt><dd>{artifact.byteSize.toLocaleString()} bytes</dd></div>
      <div><dt>Immutable artifact ID</dt><dd>{artifact.id}</dd></div>
    </dl>
  );
}

export function DealReleaseControls({
  activationConfirmation,
  actorUserId,
  deal,
  role,
  templateSourceArtifact,
  templateSourceUnavailable,
  verificationAttestation,
}: DealReleaseControlsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<MutationName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationText, setActivationText] = useState("");

  const exactBindings = useMemo(() => currentProductionBindings(deal), [deal]);
  const verifiedBinding = exactBindings.find((binding) => binding.status === "verified") ?? null;
  const pendingBinding = exactBindings.find((binding) => binding.status === "pending") ?? null;
  const currentBinding = verifiedBinding ?? pendingBinding;
  const bindingMatchesArtifact = Boolean(
    currentBinding &&
    templateSourceArtifact &&
    currentBinding.sourceArtifactId === templateSourceArtifact.id &&
    templateSourceArtifact.dealVersionId === deal.id &&
    templateSourceArtifact.snapshotHash === deal.snapshotHash &&
    templateSourceArtifact.templateId === currentBinding.templateId &&
    templateSourceArtifact.sourceSha256 === currentBinding.templateHash,
  );
  const businessApprovals = exactActiveApproval(deal.approvals, "business", deal.snapshotHash);
  const legalApprovals = exactActiveApproval(deal.approvals, "legal", deal.snapshotHash);
  const businessApproval = businessApprovals[0] ?? null;
  const legalApproval = legalApprovals[0] ?? null;
  const approvalEvidenceConsistent = businessApprovals.length <= 1 && legalApprovals.length <= 1;
  const bindingEvidenceConsistent = exactBindings.length <= 1;
  const currentActorApprovalKind = businessApproval?.approvedBy === actorUserId
    ? "business"
    : legalApproval?.approvedBy === actorUserId
      ? "legal"
      : null;
  const evidenceReady = Boolean(
    verifiedBinding &&
    templateSourceArtifact &&
    bindingMatchesArtifact &&
    businessApproval &&
    legalApproval &&
    businessApproval.approvedBy !== legalApproval.approvedBy &&
    approvalEvidenceConsistent &&
    bindingEvidenceConsistent,
  );
  const activationVisible = deal.activationReady &&
    deal.status === "sealed" &&
    deal.readinessBlockerCount === 0 &&
    deal.readinessBlockers.length === 0 &&
    evidenceReady;

  async function mutate(
    name: MutationName,
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    if (busy) return false;
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as ReleaseApiResult | null;
      if (!response.ok) {
        setError(typeof result?.error === "string"
          ? result.error
          : "The release change was rejected. No change is being claimed.");
        return false;
      }
      if (result?.deal?.id !== deal.id || result.deal.snapshotHash !== deal.snapshotHash) {
        setError("The change response did not match this loaded snapshot. Refresh before relying on any release state.");
        return false;
      }
      setNotice(successMessage);
      router.refresh();
      return true;
    } catch {
      setError("The deal service could not be reached. No release change is being claimed.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function archiveTemplateSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    form.set("snapshotHash", deal.snapshotHash);
    setBusy("artifact-upload");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/deals/${deal.id}/template-source`, {
        method: "POST",
        body: form,
      });
      const result = await response.json().catch(() => null) as ReleaseApiResult | null;
      if (!response.ok) {
        setError(typeof result?.error === "string"
          ? result.error
          : "The source was not archived. No binding or verification is being claimed.");
        return;
      }
      if (
        typeof result?.artifact?.id !== "string" ||
        result.artifact.dealVersionId !== deal.id ||
        result.artifact.snapshotHash !== deal.snapshotHash ||
        typeof result.artifact.templateId !== "string" ||
        typeof result.artifact.sourceSha256 !== "string"
      ) {
        setError("The archive response did not match this loaded snapshot. Refresh before relying on it.");
        return;
      }
      setNotice("The exact PDF or DOCX was privately archived and hashed by the server. It is not yet a binding or verification, and no agreement was sent.");
      router.refresh();
    } catch {
      setError("The archive service could not be reached. No source archive is being claimed.");
    } finally {
      setBusy(null);
    }
  }

  async function recordBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateSourceArtifact) {
      setError("Archive the exact template source before recording a binding.");
      return;
    }
    await mutate(
      "binding",
      `/api/admin/deals/${deal.id}/signing-binding`,
      {
        sourceArtifactId: templateSourceArtifact.id,
        snapshotHash: deal.snapshotHash,
      },
      "The immutable archived source was recorded as the pending SignWell production binding. It is not verified and no agreement was sent.",
    );
  }

  async function verifyBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("verificationAttestation") !== "accepted") {
      setNotice(null);
      setError("Confirm the full manual verification attestation before recording verification.");
      return;
    }
    await mutate(
      "binding-verification",
      `/api/admin/deals/${deal.id}/signing-binding/verify`,
      {
        sourceArtifactId: templateSourceArtifact?.id,
        snapshotHash: deal.snapshotHash,
        attestation: verificationAttestation,
      },
      "Manual source verification recorded for this exact snapshot. This does not claim SignWell API verification and no agreement was sent.",
    );
  }

  async function recordApproval(
    event: FormEvent<HTMLFormElement>,
    kind: AdminDealApproval["kind"],
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      `${kind}-approval`,
      `/api/admin/deals/${deal.id}/approvals`,
      {
        kind,
        snapshotHash: deal.snapshotHash,
        note: inputValue(form, `${kind}ApprovalNote`) || null,
      },
      `${kind === "business" ? "Business" : "Legal"} approval recorded for this exact snapshot.`,
    );
  }

  async function revokeApproval(
    event: FormEvent<HTMLFormElement>,
    kind: AdminDealApproval["kind"],
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      `${kind}-revocation`,
      `/api/admin/deals/${deal.id}/approvals/revoke`,
      {
        kind,
        snapshotHash: deal.snapshotHash,
        reason: inputValue(form, `${kind}RevocationReason`),
      },
      `${kind === "business" ? "Business" : "Legal"} approval revoked for this exact snapshot. Activation remains fail-closed.`,
    );
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activationText !== activationConfirmation) {
      setNotice(null);
      setError("Type the full activation confirmation exactly before continuing.");
      return;
    }
    const changed = await mutate(
      "activation",
      `/api/admin/deals/${deal.id}/activate`,
      {
        snapshotHash: deal.snapshotHash,
        confirmation: activationConfirmation,
      },
      "This exact sealed snapshot was activated as the default for future approvals.",
    );
    if (changed) setActivationText("");
  }

  function approvalCard(
    kind: AdminDealApproval["kind"],
    approval: AdminDealApproval | null,
    mode: "release" | "revoke-only" = "release",
  ) {
    const label = kind === "business" ? "Business" : "Legal";
    const blockedBySameActor = currentActorApprovalKind !== null && currentActorApprovalKind !== kind;

    return (
      <section className={styles.approvalCard} aria-labelledby={`${kind}-approval-title`}>
        <div className={styles.releaseStepHeader}>
          <div>
            <span className={styles.releaseStepNumber}>{kind === "business" ? "3A" : "3B"}</span>
            <h3 id={`${kind}-approval-title`}>{label} approval</h3>
          </div>
          <span className={styles.badge} data-tone={approval ? "ok" : "muted"}>
            {approval ? "Approved" : "Required"}
          </span>
        </div>

        {approval ? (
          <>
            <p className={styles.releaseCopy}>
              Recorded by <span className={styles.inlineHash}>{approval.approvedBy}</span> for this snapshot.
            </p>
            {approval.note ? <p className={styles.approvalNote}>{approval.note}</p> : null}
            <form className={styles.compactForm} onSubmit={(event) => revokeApproval(event, kind)}>
              <label className={styles.field}>
                <span>{label} revocation reason</span>
                <textarea
                  name={`${kind}RevocationReason`}
                  minLength={4}
                  maxLength={2_000}
                  placeholder="Why is this exact approval no longer valid?"
                  required
                />
              </label>
              <button className={styles.buttonDanger} disabled={Boolean(busy)} type="submit">
                {busy === `${kind}-revocation` ? "Revoking…" : `Revoke ${kind} approval`}
              </button>
            </form>
          </>
        ) : mode === "revoke-only" ? (
          <p className={styles.gateMessage}>
            No active {kind} approval remains for this snapshot. Future assignments should already be blocked by the server-side readiness gate.
          </p>
        ) : (
          <form className={styles.compactForm} onSubmit={(event) => recordApproval(event, kind)}>
            <label className={styles.field}>
              <span>
                {kind === "legal"
                  ? "Legal review reference (required)"
                  : "Business approval note (optional)"}
              </span>
              <textarea
                name={`${kind}ApprovalNote`}
                minLength={kind === "legal" ? 4 : undefined}
                maxLength={2_000}
                placeholder={`Record the basis or review reference for ${kind} approval.`}
                required={kind === "legal"}
              />
            </label>
            {blockedBySameActor ? (
              <p className={styles.gateMessage}>
                A different active administrator must record this approval because you recorded the {currentActorApprovalKind} approval.
              </p>
            ) : null}
            <button
              className={styles.buttonSecondary}
              disabled={Boolean(busy) || blockedBySameActor}
              type="submit"
            >
              {busy === `${kind}-approval` ? "Recording…" : `Record ${kind} approval`}
            </button>
          </form>
        )}
      </section>
    );
  }

  let readOnlyReason: string | null = null;
  if (role === "reviewer") {
    readOnlyReason = "Reviewer access is read-only. Only an active administrator can change release evidence or lifecycle state.";
  } else if (deal.status === "draft") {
    readOnlyReason = "This version is still an editable internal draft. Seal it before recording release evidence or approvals.";
  } else if (deal.status === "retired") {
    readOnlyReason = "This version is retired and remains read-only. Create a new version for any future change.";
  }

  const activeEmergencyControls = !readOnlyReason && deal.status === "active";
  const sealedReleaseControls = !readOnlyReason && deal.status === "sealed";
  const inconsistentVisibleEvidence = !approvalEvidenceConsistent ||
    (sealedReleaseControls && !bindingEvidenceConsistent);

  return (
    <section className={styles.panel} aria-labelledby="release-controls-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="release-controls-title">Release controls</h2>
          <p>Every mutation is bound to the immutable snapshot shown here.</p>
        </div>
        <span className={styles.badge} data-tone={activationVisible ? "ok" : deal.status === "sealed" ? "warn" : activeEmergencyControls ? "danger" : "muted"}>
          {activationVisible ? "Ready to activate" : deal.status === "sealed" ? "Awaiting gates" : activeEmergencyControls ? "Emergency control" : "Read-only"}
        </span>
      </header>
      <div className={styles.releaseBody}>
        <div className={styles.snapshotBanner}>
          <span>Exact snapshot SHA-256</span>
          <code>{deal.snapshotHash}</code>
        </div>

        {readOnlyReason ? <p className={styles.readOnly}>{readOnlyReason}</p> : null}

        {(sealedReleaseControls || activeEmergencyControls) && inconsistentVisibleEvidence ? (
          <p className={styles.error} role="alert">
            Stored release evidence is internally inconsistent. Controls are withheld until the duplicate records are reviewed directly in the database.
          </p>
        ) : null}

        {activeEmergencyControls && approvalEvidenceConsistent ? (
          <>
            <StatusMessages error={error} notice={notice} />
            <section className={`${styles.releaseStep} ${styles.activationStep}`} aria-labelledby="emergency-revocation-title">
              <div className={styles.releaseStepHeader}>
                <div>
                  <span className={styles.releaseStepNumber}>!</span>
                  <h3 id="emergency-revocation-title">Emergency assignment stop</h3>
                </div>
                <span className={styles.badge} data-tone="danger">Active default</span>
              </div>
              <p className={styles.releaseCopy}>
                Revoking either approval makes this active default fail readiness and blocks new creator assignments. It does not alter existing assignments, and no agreement is sent.
              </p>
              <div className={styles.approvalGrid}>
                {approvalCard("business", businessApproval, "revoke-only")}
                {approvalCard("legal", legalApproval, "revoke-only")}
              </div>
            </section>
          </>
        ) : null}

        {sealedReleaseControls && approvalEvidenceConsistent && bindingEvidenceConsistent ? (
          <>
            <StatusMessages error={error} notice={notice} />

            <section className={styles.releaseStep} aria-labelledby="binding-title">
              <div className={styles.releaseStepHeader}>
                <div>
                  <span className={styles.releaseStepNumber}>1</span>
                  <h3 id="binding-title">Archive and bind the SignWell source</h3>
                </div>
                <span className={styles.badge} data-tone={currentBinding ? currentBinding.status === "verified" ? "ok" : "warn" : templateSourceArtifact ? "warn" : "muted"}>
                  {currentBinding
                    ? currentBinding.status === "verified" ? "Manually verified" : "Binding pending"
                    : templateSourceArtifact ? "Source archived" : "Not archived"}
                </span>
              </div>
              <p className={styles.releaseCopy}>
                Upload the exact reviewed PDF or DOCX used to build the production SignWell template. The server validates and hashes the bytes into a private immutable archive. A wrong archive cannot be replaced on this sealed version; create a new version instead.
              </p>
              {templateSourceUnavailable ? (
                <p className={styles.error} role="alert">
                  Archived-source state is unavailable. Upload, binding, verification, and activation remain withheld until it loads.
                </p>
              ) : templateSourceArtifact ? (
                <>
                  <ArtifactSummary artifact={templateSourceArtifact} />
                  <p className={styles.releaseCopy}>
                    <a href={`/api/admin/deals/${deal.id}/template-source`}>Download the private archived source</a> before manual comparison.
                  </p>
                  {currentBinding ? <BindingSummary binding={currentBinding} /> : null}
                  {currentBinding && !bindingMatchesArtifact ? (
                    <p className={styles.error} role="alert">
                      The visible binding does not match this immutable archive. Verification and activation remain blocked.
                    </p>
                  ) : null}
                  {!currentBinding ? (
                    <form className={styles.compactForm} onSubmit={recordBinding}>
                      <p className={styles.releaseCopy}>
                        Recording copies the template ID, server-computed hash, and exact snapshot from the archived database row. Browser-entered hashes are never accepted.
                      </p>
                      <button className={styles.buttonSecondary} disabled={Boolean(busy)} type="submit">
                        {busy === "binding" ? "Recording…" : "Record pending binding from archive"}
                      </button>
                    </form>
                  ) : null}
                </>
              ) : currentBinding ? (
                <p className={styles.error} role="alert">
                  This historical binding has no immutable server-hashed source archive. Archive the exact matching source before relying on it.
                </p>
              ) : (
                <form className={styles.compactForm} encType="multipart/form-data" onSubmit={archiveTemplateSource}>
                  <div className={styles.releaseFieldGrid}>
                    <label className={styles.field}>
                      <span>Production template ID</span>
                      <input
                        name="templateId"
                        pattern={uuidPattern}
                        placeholder="00000000-0000-4000-8000-000000000000"
                        required
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Exact reviewed source file</span>
                      <input
                        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                        name="file"
                        type="file"
                        required
                      />
                      <small>PDF or DOCX only, up to 4 MB. The server verifies the file signature and computes SHA-256.</small>
                    </label>
                  </div>
                  <button className={styles.buttonSecondary} disabled={Boolean(busy)} type="submit">
                    {busy === "artifact-upload" ? "Archiving…" : "Archive exact template source"}
                  </button>
                </form>
              )}
            </section>

            <section className={styles.releaseStep} aria-labelledby="verification-title">
              <div className={styles.releaseStepHeader}>
                <div>
                  <span className={styles.releaseStepNumber}>2</span>
                  <h3 id="verification-title">Attest to the reviewed source</h3>
                </div>
                <span className={styles.badge} data-tone={verifiedBinding ? "ok" : "muted"}>
                  {verifiedBinding ? "Complete" : "Required"}
                </span>
              </div>
              {verifiedBinding ? (
                <p className={styles.releaseCopy}>
                  An administrator manually attested that the archived server-hashed source matches the production template and this sealed snapshot. This is not a SignWell API content-verification claim.
                </p>
              ) : pendingBinding && templateSourceArtifact && bindingMatchesArtifact ? (
                <form className={styles.compactForm} onSubmit={verifyBinding}>
                  <p className={styles.releaseCopy}>
                    Download the archived source, open the production SignWell template separately, and compare every term and economic rule before attesting. The provider has not verified this match for us.
                  </p>
                  <label className={styles.attestationField}>
                    <input name="verificationAttestation" type="checkbox" value="accepted" required />
                    <span>{verificationAttestation}</span>
                  </label>
                  <button className={styles.buttonSecondary} disabled={Boolean(busy)} type="submit">
                    {busy === "binding-verification" ? "Recording verification…" : "Record manual verification"}
                  </button>
                </form>
              ) : (
                <p className={styles.gateMessage}>Archive the exact source and record its matching pending production binding before manual verification can be attested.</p>
              )}
            </section>

            <section className={styles.releaseStep} aria-labelledby="approval-gates-title">
              <div className={styles.releaseStepHeader}>
                <div>
                  <span className={styles.releaseStepNumber}>3</span>
                  <h3 id="approval-gates-title">Collect independent approvals</h3>
                </div>
              </div>
              <p className={styles.releaseCopy}>
                Business and legal approvals must be recorded by two different currently active administrator accounts. The database enforces distinct accounts; it does not establish human identity separation.
              </p>
              <div className={styles.approvalGrid}>
                {approvalCard("business", businessApproval)}
                {approvalCard("legal", legalApproval)}
              </div>
            </section>

            <section className={`${styles.releaseStep} ${styles.activationStep}`} aria-labelledby="activation-title">
              <div className={styles.releaseStepHeader}>
                <div>
                  <span className={styles.releaseStepNumber}>4</span>
                  <h3 id="activation-title">Activate the default</h3>
                </div>
                <span className={styles.badge} data-tone={activationVisible ? "ok" : "muted"}>
                  {activationVisible ? "Ready" : "Blocked"}
                </span>
              </div>
              {activationVisible ? (
                <form className={styles.compactForm} onSubmit={activate}>
                  <p className={styles.releaseCopy}>
                    Activation makes this exact sealed snapshot the default assigned to future approved creators. It does not send an agreement.
                  </p>
                  <div className={styles.field}>
                    <label htmlFor="deal-activation-confirmation">Type the full confirmation</label>
                    <code className={styles.confirmationPhrase}>{activationConfirmation}</code>
                    <input
                      autoComplete="off"
                      id="deal-activation-confirmation"
                      name="activationConfirmation"
                      onChange={(event) => setActivationText(event.currentTarget.value)}
                      spellCheck={false}
                      value={activationText}
                      required
                    />
                  </div>
                  <button
                    className={styles.buttonDanger}
                    disabled={Boolean(busy) || activationText !== activationConfirmation}
                    type="submit"
                  >
                    {busy === "activation" ? "Activating…" : "Activate exact snapshot as default"}
                  </button>
                </form>
              ) : (
                <p className={styles.gateMessage}>
                  Activation stays unavailable until the server reports no blockers and the exact verified binding plus two distinct-admin approvals are present.
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
