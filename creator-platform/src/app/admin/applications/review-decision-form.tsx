"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import type { StaffApplicationStatus } from "@/server/admin/applications";
import type { AdminDealVersion } from "@/server/admin/deals";

import styles from "./admin-applications.module.css";

const baseActionLabels = {
  start_review: "Begin review",
  request_changes: "Request changes",
  reject: "Reject application",
  approve: "Approve application",
} as const;

type ReviewAction = keyof typeof baseActionLabels;

function actionsFor(status: StaffApplicationStatus): ReviewAction[] {
  if (status === "submitted") {
    return ["start_review", "request_changes", "reject", "approve"];
  }
  if (status === "in_review") {
    return ["request_changes", "reject", "approve"];
  }
  if (status === "changes_requested") return ["reject"];
  return [];
}

export function ReviewDecisionForm({
  applicationId,
  status,
  staffRole,
  defaultDeal,
  approvalEligible,
  dealCatalogUnavailable = false,
}: {
  applicationId: string;
  status: StaffApplicationStatus;
  staffRole: "reviewer" | "admin";
  defaultDeal: AdminDealVersion | null;
  approvalEligible: boolean;
  dealCatalogUnavailable?: boolean;
}) {
  const router = useRouter();
  const actions = useMemo(() => actionsFor(status), [status]);
  const [action, setAction] = useState<ReviewAction | "">(actions[0] ?? "");
  const [applicantMessage, setApplicantMessage] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [dealReviewConfirmed, setDealReviewConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!actions.length) {
    return (
      <p className={styles.finalState}>
        This application is in a final state. Its history remains available below, but no review mutation is available.
      </p>
    );
  }

  const publicMessageRequired = action === "request_changes" || action === "reject";
  const approvalBlocked = action === "approve" && (!defaultDeal || !approvalEligible);
  const actionLabel = action === "approve" && defaultDeal && approvalEligible
    ? `Approve and assign ${defaultDeal.label} v${defaultDeal.version}`
    : action === "approve" && approvalBlocked
      ? "Approval blocked"
      : action
        ? baseActionLabels[action]
        : "Save decision";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !action || saving || approvalBlocked ||
      (action === "approve" && (!defaultDeal || !dealReviewConfirmed))
    ) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/applications/${applicationId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? {
          action,
          applicantMessage,
          staffNote,
          dealReviewConfirmed,
          expectedDealVersionId: defaultDeal?.id,
          expectedDealSnapshotHash: defaultDeal?.snapshotHash,
        } : { action, applicantMessage, staffNote }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string; status?: string }
        | null;

      if (!response.ok) {
        setError(result?.error ?? "The review decision could not be saved.");
        return;
      }

      const savedStatus = result?.status?.replaceAll("_", " ") ?? "updated";
      setNotice(`Decision saved. Application is now ${savedStatus}.`);
      router.refresh();
    } catch {
      setError("The review service could not be reached. No status change is being claimed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Decision
        <select
          name="action"
          value={action}
          onChange={(event) => {
            setAction(event.target.value as ReviewAction);
            setDealReviewConfirmed(false);
            setError(null);
            setNotice(null);
          }}
        >
          {actions.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate === "approve" && defaultDeal && approvalEligible
                ? `Approve and assign ${defaultDeal.label} v${defaultDeal.version}`
                : candidate === "approve" && (!defaultDeal || !approvalEligible)
                  ? "Approve application (deal blocked)"
                  : baseActionLabels[candidate]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Message to creator {publicMessageRequired ? "(required)" : "(optional)"}
        <textarea
          name="applicantMessage"
          value={applicantMessage}
          onChange={(event) => setApplicantMessage(event.target.value)}
          maxLength={2_000}
          required={publicMessageRequired}
          placeholder={publicMessageRequired
            ? "Explain the decision and the creator's next action."
            : "Visible to the creator on their application status page."}
        />
        <span className={styles.hint}>This text is applicant-facing. Do not include internal discussion.</span>
      </label>

      <label>
        Internal note (optional)
        <textarea
          name="staffNote"
          value={staffNote}
          onChange={(event) => setStaffNote(event.target.value)}
          maxLength={4_000}
          placeholder="Record the evidence or reasoning behind this action."
        />
        <span className={styles.hint}>Stored in the staff-only audit history and never returned by the creator snapshot.</span>
      </label>

      {action === "approve" ? (
        <section className={styles.dealReview} aria-labelledby="deal-review-title">
          <div className={styles.dealReviewHeader}>
            <div>
              <strong id="deal-review-title">Exact deal assignment</strong>
              <span>Approval is locked to this reviewed database snapshot.</span>
            </div>
            {defaultDeal ? <Link href={`/admin/deals/${defaultDeal.id}`}>Inspect version</Link> : null}
          </div>
          {defaultDeal ? (
            <dl className={styles.dealIdentity}>
              <div><dt>Current default</dt><dd>{defaultDeal.label} · v{defaultDeal.version}</dd></div>
              <div><dt>Snapshot SHA-256</dt><dd className={styles.snapshot}>{defaultDeal.snapshotHash}</dd></div>
            </dl>
          ) : null}

          {defaultDeal && approvalEligible ? (
            <label className={styles.confirmation}>
              <input
                type="checkbox"
                checked={dealReviewConfirmed}
                onChange={(event) => setDealReviewConfirmed(event.target.checked)}
                required
              />
              <span>I reviewed {defaultDeal.label} v{defaultDeal.version} and confirm this exact snapshot will be assigned.</span>
            </label>
          ) : (
            <div className={styles.dealBlocked} role="alert">
              <strong>Approval is unavailable</strong>
              <p>
                {dealCatalogUnavailable
                  ? "The current deal state could not be loaded, so approval is blocked."
                  : defaultDeal
                    ? "The current default deal is not yet effective or has unresolved readiness blockers."
                    : "No eligible active default deal is configured."}
              </p>
              {staffRole === "admin" ? (
                <Link href="/admin/deals">Open deal readiness</Link>
              ) : (
                <span>An administrator must prepare the default deal before this application can be approved.</span>
              )}
            </div>
          )}
          <p className={styles.hint}>
            Approval atomically assigns the confirmed version, creates onboarding and an assigned agreement record, and advances lifecycle state. A changed default or hash fails closed.
          </p>
        </section>
      ) : null}

      <div className={styles.decisionActions}>
        <button
          className={styles.submit}
          disabled={saving || approvalBlocked || (action === "approve" && !dealReviewConfirmed)}
          type="submit"
        >
          {saving ? "Saving…" : actionLabel}
        </button>
      </div>

      {error ? (
        <p className={`${styles.formMessage} ${styles.formError}`} role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className={`${styles.formMessage} ${styles.formSuccess}`} role="status">{notice}</p>
      ) : null}
    </form>
  );
}
