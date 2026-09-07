import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Banknote, LockKeyhole } from "lucide-react";

import {
  AdminWorkspaceShell,
  adminWorkspaceStyles as workspaceStyles,
} from "@/components/admin-workspace-shell";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { formatMinorUnits } from "@/server/accounts/earnings";
import { requireCreatorStaff } from "@/server/admin/access";
import {
  getAdminFinanceLedger,
  type AdminEarningEntry,
} from "@/server/admin/content-finance";

import styles from "../content-finance.module.css";

export const metadata: Metadata = { title: "Finance ledger" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function date(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

function stateTone(value: string) {
  return value === "paid" || value === "reconciled" ? "ok" : value === "estimated" ? "warn" : undefined;
}

function settlementGroups(entries: AdminEarningEntry[]) {
  const groups = new Map<string, AdminEarningEntry[]>();
  for (const entry of entries) {
    if (entry.state !== "approved" || entry.settlementId) continue;
    const key = [entry.accountId, entry.enrollmentId, entry.currency, entry.currencyExponent].join(":");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
}

function EarningTransition({ entry }: { entry: AdminEarningEntry }) {
  const nextState = entry.state === "estimated"
    ? "pending"
    : entry.state === "pending"
      ? "approved"
      : null;
  if (!nextState) {
    return <small>{entry.settlementId ? `Settlement ${entry.settlementId.slice(0, 8)}` : entry.state === "approved" ? "Available for settlement" : "No manual transition available"}</small>;
  }

  return (
    <form className={styles.transitionForm} action="/api/admin/finance" method="post">
      <input name="action" type="hidden" value="transition_earning" />
      <input name="earningId" type="hidden" value={entry.id} />
      <input name="nextState" type="hidden" value={nextState} />
      <input aria-label={`Audit reason for ${entry.sourceKey}`} name="reason" minLength={2} maxLength={1000} placeholder="Audit reason" required />
      <button className={styles.secondaryButton} type="submit">{nextState === "pending" ? "Move to pending" : "Approve"}</button>
    </form>
  );
}

export default async function AdminFinancePage({ searchParams }: PageProps) {
  const { staff } = await requireCreatorStaff("/admin/finance");
  const params = await searchParams;
  const notice = getSearchParamValue(params, "notice");
  const error = getSearchParamValue(params, "error");

  if (staff.role !== "admin") {
    return (
      <AdminWorkspaceShell
        active="finance"
        role={staff.role}
        eyebrow="Finance controls"
        title="Finance ledger"
        description="Earning and settlement records are restricted to active administrators."
      >
        <p className={workspaceStyles.error} role="alert">Administrator access is required. No ledger amounts or payment records have been loaded.</p>
      </AdminWorkspaceShell>
    );
  }

  const ledger = await getAdminFinanceLedger().catch(() => null);
  const groups = ledger ? settlementGroups(ledger.entries) : [];
  const openEarnings = ledger?.entries.filter((entry) => entry.state !== "reconciled").length ?? 0;
  const approvedUnsettled = ledger?.entries.filter((entry) => entry.state === "approved" && !entry.settlementId).length ?? 0;
  const openSettlements = ledger?.settlements.filter((settlement) => settlement.state !== "reconciled").length ?? 0;

  return (
    <AdminWorkspaceShell
      active="finance"
      role={staff.role}
      eyebrow="Finance controls"
      title="Finance ledger"
      description="Recorded amounts move through explicit estimated, pending, approved, paid, and reconciled states. A pending settlement is an auditable batch, not a payment."
      actions={<Link className={styles.secondaryButton} href="/admin/creators">Creator directory</Link>}
    >
      {notice ? <p className={styles.flash} role="status">{notice}</p> : null}
      {error ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{error}</p> : null}

      <div className={styles.providerWarning} role="status">
        <AlertTriangle aria-hidden="true" size={17} />
        <div>
          <strong>Payout execution is not configured</strong>
          <p>This interface can review earnings, create pending settlement records, and approve those records. It cannot send money or mark a settlement paid. Paid and reconciled remain evidence-backed states only.</p>
        </div>
      </div>

      {!ledger ? (
        <p className={workspaceStyles.error} role="alert">The finance ledger is unavailable. No amount, count, or payment state is being claimed.</p>
      ) : (
        <>
          <section className={workspaceStyles.metrics} aria-label="Recorded finance counts">
            <div className={workspaceStyles.metric}><span>Recorded entries</span><strong>{ledger.entries.length}</strong><small>Rows returned by the live ledger</small></div>
            <div className={workspaceStyles.metric}><span>Open earnings</span><strong>{openEarnings}</strong><small>Not yet reconciled</small></div>
            <div className={workspaceStyles.metric}><span>Approved, unsettled</span><strong>{approvedUnsettled}</strong><small>Eligible for a pending batch</small></div>
            <div className={workspaceStyles.metric}><span>Open settlements</span><strong>{openSettlements}</strong><small>Not yet reconciled</small></div>
          </section>

          <section className={workspaceStyles.panel} aria-labelledby="earnings-title">
            <header className={workspaceStyles.panelHeader}>
              <div><h2 id="earnings-title">Earning entries</h2><p>Immutable amount facts with forward-only state changes.</p></div>
              <Banknote aria-hidden="true" size={16} />
            </header>
            {ledger.entries.length === 0 ? (
              <div className={workspaceStyles.empty}><h3>No earning entries returned</h3><p>This is an empty ledger result, not a claim that creators earned zero.</p></div>
            ) : (
              <div className={workspaceStyles.tableWrap}>
                <table className={workspaceStyles.table}>
                  <thead><tr><th>Creator / source</th><th>State</th><th>Recorded amount</th><th>Earned</th><th>Next action</th></tr></thead>
                  <tbody>
                    {ledger.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td><Link href={`/admin/creators/${entry.accountId}`}>Creator {entry.accountId.slice(0, 8)}</Link><small>{entry.sourceKey} · {label(entry.category)}</small></td>
                        <td><span className={workspaceStyles.status} data-tone={stateTone(entry.state)}>{label(entry.state)}</span></td>
                        <td><strong>{formatMinorUnits(entry.amountMinor, entry.currency, entry.currencyExponent)}</strong><small>Entry {entry.id.slice(0, 8)}</small></td>
                        <td>{date(entry.earnedAt)}</td>
                        <td><EarningTransition entry={entry} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={workspaceStyles.panel} aria-labelledby="draft-settlement-title">
            <header className={workspaceStyles.panelHeader}>
              <div><h2 id="draft-settlement-title">Create pending settlement</h2><p>Select exact approved, unsettled entries. Each form is locked to one creator, enrollment, currency, and exponent.</p></div>
              <LockKeyhole aria-hidden="true" size={16} />
            </header>
            {groups.length === 0 ? (
              <div className={workspaceStyles.empty}><h3>No entries eligible for batching</h3><p>An earning must be approved and absent from every existing settlement line.</p></div>
            ) : (
              <div className={styles.settlementGroups}>
                {groups.map((entries) => {
                  const first = entries[0];
                  return (
                    <form className={styles.settlementGroup} action="/api/admin/finance" method="post" key={`${first.accountId}:${first.enrollmentId}:${first.currency}:${first.currencyExponent}`}>
                      <input name="action" type="hidden" value="create_settlement" />
                      <input name="accountId" type="hidden" value={first.accountId} />
                      <input name="enrollmentId" type="hidden" value={first.enrollmentId} />
                      <header><div><h3>Creator {first.accountId.slice(0, 8)} · {first.currency}</h3><p>{entries.length} eligible entr{entries.length === 1 ? "y" : "ies"} · pending record only</p></div><Link href={`/admin/creators/${first.accountId}`}>View creator</Link></header>
                      <div className={styles.checkList}>
                        {entries.map((entry) => (
                          <label className={styles.checkRow} key={entry.id}>
                            <input name="earningEntryId" type="checkbox" value={entry.id} />
                            <span>{entry.sourceKey}<small>{date(entry.earnedAt)}</small></span>
                            <strong>{formatMinorUnits(entry.amountMinor, entry.currency, entry.currencyExponent)}</strong>
                          </label>
                        ))}
                      </div>
                      <div className={styles.settlementActions}><button className={styles.primaryButton} type="submit">Record pending settlement</button></div>
                    </form>
                  );
                })}
              </div>
            )}
          </section>

          <section className={workspaceStyles.panel} aria-labelledby="settlements-title">
            <header className={workspaceStyles.panelHeader}><div><h2 id="settlements-title">Settlement ledger</h2><p>Provider evidence is shown when it has actually been recorded.</p></div></header>
            {ledger.settlements.length === 0 ? (
              <div className={workspaceStyles.empty}><h3>No settlement records returned</h3><p>No payment batch is being inferred from approved earnings.</p></div>
            ) : (
              <div className={workspaceStyles.tableWrap}>
                <table className={workspaceStyles.table}>
                  <thead><tr><th>Settlement</th><th>State</th><th>Recorded total</th><th>Provider evidence</th><th>Next action</th></tr></thead>
                  <tbody>
                    {ledger.settlements.map((settlement) => (
                      <tr key={settlement.id}>
                        <td><Link href={`/admin/creators/${settlement.accountId}`}>Creator {settlement.accountId.slice(0, 8)}</Link><small>{settlement.earningEntryIds.length} ledger line{settlement.earningEntryIds.length === 1 ? "" : "s"} · {date(settlement.createdAt)}</small></td>
                        <td><span className={workspaceStyles.status} data-tone={stateTone(settlement.state)}>{label(settlement.state)}</span></td>
                        <td><strong>{formatMinorUnits(settlement.totalMinor, settlement.currency, settlement.currencyExponent)}</strong></td>
                        <td><span className={styles.evidence}>{settlement.payoutProvider && settlement.externalPayoutId ? <><strong>{settlement.payoutProvider}</strong><small>{settlement.externalPayoutId}</small></> : <small>No provider evidence recorded</small>}</span></td>
                        <td>
                          {settlement.state === "pending" ? (
                            <form className={styles.transitionForm} action="/api/admin/finance" method="post">
                              <input name="action" type="hidden" value="transition_settlement" />
                              <input name="settlementId" type="hidden" value={settlement.id} />
                              <input name="nextState" type="hidden" value="approved" />
                              <input aria-label={`Audit reason for settlement ${settlement.id}`} name="reason" minLength={2} maxLength={1000} placeholder="Approval reason" required />
                              <button className={styles.secondaryButton} type="submit">Approve</button>
                            </form>
                          ) : settlement.state === "approved" ? <small>Awaiting external payout provider</small> : <small>No manual transition available</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </AdminWorkspaceShell>
  );
}
