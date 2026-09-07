import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreatorWorkspaceShell } from "@/components/creator-workspace-shell";
import styles from "@/components/creator-workspace.module.css";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  formatMinorUnits,
  getOwnEarningsWorkspace,
  type CreatorEarningEntry,
  type EarningState,
  type SettlementState,
} from "@/server/accounts/earnings";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = { title: "Creator earnings" };
export const dynamic = "force-dynamic";

const stateOrder: EarningState[] = ["estimated", "pending", "approved", "paid", "reconciled"];

const stateDescriptions: Record<EarningState, string> = {
  estimated: "Calculated from available observations; not yet finalized.",
  pending: "Submitted for review against verified campaign data.",
  approved: "Approved for a future settlement.",
  paid: "Recorded as paid with provider evidence; reconciliation remains open.",
  reconciled: "Matched against the completed provider transaction.",
};

function labelState(state: EarningState | SettlementState) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function totalsByState(entries: CreatorEarningEntry[]) {
  const totals = new Map<string, {
    state: EarningState;
    currency: string;
    exponent: number;
    amount: bigint;
  }>();

  for (const entry of entries) {
    const key = `${entry.state}:${entry.currency}:${entry.currencyExponent}`;
    const current = totals.get(key);
    totals.set(key, {
      state: entry.state,
      currency: entry.currency,
      exponent: entry.currencyExponent,
      amount: (current?.amount ?? BigInt(0)) + BigInt(entry.amountMinor),
    });
  }

  return [...totals.values()].sort(
    (left, right) => stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state),
  );
}

export default async function CreatorEarningsPage() {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Faccount%2Fearnings");

  const workspaceResult = await Promise.allSettled([getOwnEarningsWorkspace()]);
  const workspace = workspaceResult[0].status === "fulfilled" ? workspaceResult[0].value : null;
  const totals = workspace ? totalsByState(workspace.entries) : [];

  return (
    <CreatorWorkspaceShell
      active="earnings"
      eyebrow="Finance"
      title="Earnings and settlements"
      description="Every amount keeps its real lifecycle. Estimated, pending, approved, paid, and reconciled are deliberately different states."
      accountEmail={account.email}
    >
      {workspace ? (
        <>
          {workspace.entries.length === 0 ? (
            <section className={styles.panel}>
              <div className={styles.emptyState}>
                <h2>No earnings have been posted yet</h2>
                <p>This is an unknown balance, not a zero balance. Earnings appear after attributed content has verified observations and an earning entry is created.</p>
              </div>
            </section>
          ) : (
            <>
              <section className={styles.summaryGrid} aria-label="Known earnings by state">
                {totals.map((total) => (
                  <article className={styles.summaryCard} key={`${total.state}:${total.currency}:${total.exponent}`}>
                    <span>{labelState(total.state)}</span>
                    <strong>{formatMinorUnits(total.amount.toString(), total.currency, total.exponent)}</strong>
                    <p>{stateDescriptions[total.state]}</p>
                  </article>
                ))}
              </section>

              <section className={styles.panel} aria-labelledby="earnings-ledger-title">
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.kicker}>Ledger</p>
                    <h2 id="earnings-ledger-title">Earning entries</h2>
                  </div>
                  <span className={styles.truthBadge}>Recorded amounts only</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Entry</th><th>State</th><th>Amount</th><th>Earned</th></tr></thead>
                    <tbody>
                      {workspace.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <strong className={styles.category}>{entry.category.replaceAll("_", " ")}</strong>
                            {entry.postId ? <small>Attributed to a matched post</small> : <small>Program-level entry</small>}
                          </td>
                          <td><span className={styles.statePill}>{labelState(entry.state)}</span></td>
                          <td>{formatMinorUnits(entry.amountMinor, entry.currency, entry.currencyExponent)}</td>
                          <td>{formatDate(entry.earnedAt) ?? "Date unavailable"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <section className={styles.panel} aria-labelledby="settlements-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Payment record</p>
                <h2 id="settlements-title">Settlements</h2>
              </div>
            </div>
            {workspace.settlements.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No settlement records yet</h3>
                <p>No payment batch has been recorded for this account. Approved earnings are not shown as paid until provider evidence exists.</p>
              </div>
            ) : (
              <div className={styles.cardList}>
                {workspace.settlements.map((settlement) => (
                  <article className={styles.settlementCard} key={settlement.id}>
                    <div>
                      <span className={styles.statePill}>{labelState(settlement.state)}</span>
                      <strong>{formatMinorUnits(settlement.totalMinor, settlement.currency, settlement.currencyExponent)}</strong>
                    </div>
                    <dl>
                      <div><dt>Period</dt><dd>{formatDate(settlement.periodStart) ?? "Not specified"} – {formatDate(settlement.periodEnd) ?? "Not specified"}</dd></div>
                      <div><dt>Provider</dt><dd>{settlement.payoutProvider ?? "Not assigned"}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className={styles.panel}>
          <div className={styles.errorState} role="alert">
            <h2>Earnings data is temporarily unavailable</h2>
            <p>We could not verify the ledger state. No balance is being inferred or displayed.</p>
          </div>
        </section>
      )}
    </CreatorWorkspaceShell>
  );
}
