import type { Metadata } from "next";
import { ShieldCheck, UserCheck, UserRoundCog, UsersRound } from "lucide-react";

import { AdminWorkspaceShell } from "@/components/admin-workspace-shell";
import { requireCreatorAdmin } from "@/server/admin/access";
import { getAdminStaffDirectory } from "@/server/admin/staff";

import { StaffAccessForm } from "./staff-access-form";
import styles from "./staff.module.css";

export const metadata: Metadata = {
  title: "Staff access",
  description: "Administrator-managed access to creator operations.",
};

export const dynamic = "force-dynamic";

function roleLabel(role: "reviewer" | "admin") {
  return role === "admin" ? "Administrator" : "Reviewer";
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

export default async function AdminStaffPage() {
  const { staff } = await requireCreatorAdmin("/admin/staff");
  const directory = await getAdminStaffDirectory().catch(() => null);
  const members = directory?.staffMembers ?? null;
  const activeAdmins = members?.filter((member) => member.active && member.role === "admin").length ?? 0;
  const activeReviewers = members?.filter((member) => member.active && member.role === "reviewer").length ?? 0;
  const inactiveMembers = members?.filter((member) => !member.active).length ?? 0;
  const recentEvents = directory?.recentEvents ?? [];
  const directoryReady = members !== null && activeAdmins > 0;

  return (
    <AdminWorkspaceShell
      active="staff"
      role={staff.role}
      eyebrow="Workspace security"
      title="Staff access"
      description="Add a confirmed account to creator operations or safely reactivate a prior membership with its stored role. Existing roles cannot be changed here."
    >
      {!directoryReady ? (
        <p className={styles.error} role="alert">
          The staff directory is unavailable or did not include an active administrator. No staff count or access state is being claimed, and access changes are disabled. Refresh before continuing.
        </p>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Staff access summary">
            <div><ShieldCheck aria-hidden="true" size={17} /><span>Active administrators</span><strong>{activeAdmins}</strong></div>
            <div><UserCheck aria-hidden="true" size={17} /><span>Active reviewers</span><strong>{activeReviewers}</strong></div>
            <div><UsersRound aria-hidden="true" size={17} /><span>Inactive staff</span><strong>{inactiveMembers}</strong></div>
          </section>

          <div className={styles.layout}>
            <section className={styles.panel} aria-labelledby="staff-directory-title">
              <header className={styles.panelHeader}>
                <div>
                  <h2 id="staff-directory-title">Staff directory</h2>
                  <p>Only the account email, access role, and current status are shown.</p>
                </div>
                <span>{members.length} {members.length === 1 ? "member" : "members"}</span>
              </header>
              {members.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Account email</th><th>Role</th><th>Access</th><th>Email</th></tr></thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.email}>
                          <td><strong>{member.email}</strong></td>
                          <td>{roleLabel(member.role)}</td>
                          <td><span className={styles.status} data-tone={member.active ? "ok" : "muted"}>{member.active ? "Active" : "Inactive"}</span></td>
                          <td><span className={styles.status} data-tone={member.emailConfirmed ? "ok" : "warn"}>{member.emailConfirmed ? "Confirmed" : "Needs confirmation"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <aside className={styles.panel} aria-labelledby="staff-add-title">
              <header className={styles.panelHeader}>
                <div>
                  <h2 id="staff-add-title">Add or reactivate</h2>
                  <p>Use the exact email from an existing confirmed account.</p>
                </div>
                <UserRoundCog aria-hidden="true" size={18} />
              </header>
              <div className={styles.panelBody}>
                <p className={styles.safetyNote}>
                  <strong>Add-only recovery boundary</strong>
                  This screen cannot deactivate staff, delete memberships, or change a stored role. A second administrator account adds account-level separation and recovery; it does not prove two distinct humans or independent approval.
                </p>
                <StaffAccessForm />
              </div>
            </aside>
          </div>

          <section className={styles.panel} aria-labelledby="staff-audit-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="staff-audit-title">Recent access changes</h2>
                <p>Append-only add and reactivation outcomes. No-op requests are not recorded as changes.</p>
              </div>
              <span>Latest {recentEvents.length} of 20</span>
            </header>
            {recentEvents.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Time</th><th>Actor</th><th>Target</th><th>Outcome</th><th>Prior state</th></tr></thead>
                  <tbody>
                    {recentEvents.map((event, index) => (
                      <tr key={`${event.createdAt}-${event.targetEmail}-${index}`}>
                        <td><time dateTime={event.createdAt}>{timestamp(event.createdAt)}</time></td>
                        <td>{event.actor}</td>
                        <td><strong>{event.targetEmail}</strong></td>
                        <td>{event.outcome === "added" ? "Added" : "Reactivated"} as {roleLabel(event.newRole)}</td>
                        <td>{event.priorRole === null ? "No staff membership" : `${roleLabel(event.priorRole)} · inactive`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>
                <h3>No access changes recorded</h3>
                <p>The current staff row may predate this immutable audit ledger.</p>
              </div>
            )}
          </section>
        </>
      )}
    </AdminWorkspaceShell>
  );
}
