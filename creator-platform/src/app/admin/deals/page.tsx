import type { Metadata } from "next";
import Link from "next/link";

import { AdminWorkspaceShell } from "@/components/admin-workspace-shell";
import { requireCreatorStaff } from "@/server/admin/access";
import { getAdminDealCatalog } from "@/server/admin/deals";

import styles from "./admin-deals.module.css";
import { DealStateBadge, formatDate } from "./deal-display";
import { NewDealDraftForm } from "./deal-forms";

export const metadata: Metadata = {
  title: "Deal versions",
  description: "Versioned creator-program legal terms and business economics.",
};

export const dynamic = "force-dynamic";

function hash(value: string | null) {
  if (!value) return "Not bound";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export default async function AdminDealsPage() {
  const { staff } = await requireCreatorStaff("/admin/deals");
  const catalog = await getAdminDealCatalog().catch(() => null);
  const currentDefault = catalog?.defaultVersion ?? null;

  return (
    <AdminWorkspaceShell
      active="deals"
      role={staff.role}
      eyebrow="Program governance"
      title="Deal versions"
      description="Draft, compare, and seal exact legal and economic revisions without changing creator assignments or the current default."
      actions={<Link className="button button--ghost" href="/standard-agreement">View non-binding sample</Link>}
    >
      <p className={styles.notice}>
        <strong>Reference only · Non-binding</strong>
        This sample contains unresolved terms and cannot be activated, assigned, or sent for signature.
      </p>

      {!catalog ? (
        <p className={styles.error} role="alert">
          The deal catalog is unavailable. No current default, version, assignment, or readiness state is being claimed. Refresh before making changes.
        </p>
      ) : (
        <div className={styles.catalogGrid}>
          <div className={styles.stack}>
            <section className={`${styles.panel} ${currentDefault ? "" : styles.emptyDefault}`} aria-labelledby="default-title">
              {currentDefault ? (
                <>
                  <div className={styles.defaultCard}>
                    <div>
                      <DealStateBadge deal={currentDefault} />
                      <h2 id="default-title">{currentDefault.label}</h2>
                      <p>
                        {currentDefault.dealKey} · Version {currentDefault.version}. New approvals receive this exact immutable version; existing assignments do not move.
                      </p>
                    </div>
                    <Link className="button button--ghost" href={`/admin/deals/${currentDefault.id}`}>Inspect exact version</Link>
                  </div>
                  <dl className={styles.summaryList}>
                    <div><dt>Assigned enrollments</dt><dd>{currentDefault.assignmentCount}</dd></div>
                    <div><dt>Provider bindings</dt><dd>{currentDefault.providerBindingCount}</dd></div>
                    <div><dt>Snapshot hash</dt><dd className={styles.hash} title={currentDefault.snapshotHash}>{hash(currentDefault.snapshotHash)}</dd></div>
                  </dl>
                </>
              ) : (
                <div className={styles.defaultCard}>
                  <div>
                    <span className={styles.badge} data-tone="warn">No active default</span>
                    <h2 id="default-title">Approvals remain fail-closed</h2>
                    <p>No active default deal is recorded. Creating or saving a draft will not change this state.</p>
                  </div>
                </div>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="versions-title">
              <header className={styles.panelHeader}>
                <div>
                  <h2 id="versions-title">Version catalog</h2>
                  <p>Every row is a distinct legal and economic snapshot.</p>
                </div>
                <span className={styles.badge} data-tone="muted">{catalog.versions.length} versions</span>
              </header>
              {catalog.versions.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>State</th>
                        <th>Hashes</th>
                        <th className={styles.numberCell}>Assignments</th>
                        <th className={styles.numberCell}>Bindings</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalog.versions.map((deal) => (
                        <tr key={deal.id}>
                          <td>
                            <Link href={`/admin/deals/${deal.id}`}>{deal.label}</Link>
                            <small>{deal.dealKey} · v{deal.version} · draft revision {deal.draftRevision}</small>
                          </td>
                          <td><DealStateBadge deal={deal} /><small>{deal.readinessBlockerCount} readiness blockers</small></td>
                          <td className={styles.hash}>
                            Terms {hash(deal.termsHash)}
                            <small>Snapshot {hash(deal.snapshotHash)}</small>
                          </td>
                          <td className={styles.numberCell}>{deal.assignmentCount}</td>
                          <td className={styles.numberCell}>{deal.providerBindingCount}</td>
                          <td>{formatDate(deal.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.panelBody}>
                  <p className={styles.emptyTerms}>No deal versions exist. Administrator-created drafts remain internal until they pass every separate release gate.</p>
                </div>
              )}
            </section>
          </div>

          <aside>
            <section className={styles.panel} aria-labelledby="new-draft-title">
              <header className={styles.panelHeader}>
                <div>
                  <h2 id="new-draft-title">New internal draft</h2>
                  <p>Blank legal terms with proposed, editable economics.</p>
                </div>
              </header>
              <div className={styles.panelBody}>
                {staff.role === "admin" ? (
                  <NewDealDraftForm />
                ) : (
                  <p className={styles.readOnly}>
                    Reviewer access is read-only. An administrator can create and revise drafts; reviewers can inspect exact terms, hashes, approvals, bindings, and audit history.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </AdminWorkspaceShell>
  );
}
