import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminWorkspaceShell,
  adminWorkspaceStyles as styles,
} from "@/components/admin-workspace-shell";
import { formatMinorUnits } from "@/server/accounts/earnings";
import { requireCreatorStaff } from "@/server/admin/access";
import { getAdminWorkspace, type AdminMoneySummary } from "@/server/admin/workspace";

export const metadata: Metadata = {
  title: "Creator operations",
  description: "Operational health, content activity, and creator-program finance states.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function number(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function integer(value: string) {
  return new Intl.NumberFormat("en-US").format(BigInt(value));
}

function date(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function stateLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function moneyRows(rows: AdminMoneySummary[], emptyCopy: string) {
  if (!rows.length) {
    return (
      <div className={styles.empty}>
        <h3>No recorded value</h3>
        <p>{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className={styles.moneyList}>
      {rows.map((row) => (
        <div className={styles.moneyRow} key={`${row.currency}-${row.state}`}>
          <span>{stateLabel(row.state)} · {number(row.count)} {row.count === 1 ? "record" : "records"}</span>
          <strong>{formatMinorUnits(row.amountMinor, row.currency, row.currencyExponent)}</strong>
        </div>
      ))}
    </div>
  );
}

function activityLevel(posts: number, submissions: number, observedPosts: number) {
  const total = posts + submissions + observedPosts;
  if (!total) return 0;
  if (total <= 2) return 1;
  if (total <= 7) return 2;
  return 3;
}

export default async function AdminHomePage({ searchParams }: PageProps) {
  const { staff } = await requireCreatorStaff("/admin");
  const query = await searchParams;
  const suppliedStart = first(query.start);
  const suppliedEnd = first(query.end);
  const start = validDate(suppliedStart);
  const end = validDate(suppliedEnd);
  const suppliedRange = Boolean(suppliedStart || suppliedEnd);
  const rangeIsValid = start !== null && end !== null && start <= end;
  const workspace = await getAdminWorkspace(
    rangeIsValid ? start : undefined,
    rangeIsValid ? end : undefined,
  ).catch(() => null);

  return (
    <AdminWorkspaceShell
      active="home"
      role={staff.role}
      eyebrow="Creator operations"
      title="Program health"
      description="A live operational view of creator onboarding, publishing, tracking coverage, and money states. Missing observations remain unknown."
      actions={<Link className="button button--ink" href="/admin/applications">Review applications</Link>}
    >
      {suppliedRange && !rangeIsValid ? (
        <p className={styles.error} role="alert">
          Enter both dates as a valid range. The default seven-day window is shown instead.
        </p>
      ) : null}

      {workspace ? (
        <>
          <form className={styles.filters} method="get">
            <label>
              <span>Start date</span>
              <input name="start" type="date" defaultValue={workspace.range.start} required />
            </label>
            <label>
              <span>End date</span>
              <input name="end" type="date" defaultValue={workspace.range.end} required />
            </label>
            <button className="button button--ghost" type="submit">Apply range</button>
          </form>

          <section className={styles.metrics} aria-label="Program summary">
            <div className={styles.metric}>
              <span>Creators</span>
              <strong>{number(workspace.summary.creatorCount)}</strong>
              <small>{number(workspace.summary.activeCreatorCount)} active</small>
            </div>
            <div className={styles.metric}>
              <span>Posts in range</span>
              <strong>{number(workspace.summary.publishedPostCount)}</strong>
              <small>{number(workspace.summary.contentAttentionCount)} submissions need attention</small>
            </div>
            <div className={styles.metric}>
              <span>Views gained</span>
              <strong>{workspace.summary.viewsGained === null ? "Unknown" : integer(workspace.summary.viewsGained)}</strong>
              <small className={workspace.summary.viewsGained === null ? styles.metricWarning : undefined}>
                {number(workspace.summary.knownDeltaPostCount)} of {number(workspace.summary.observedPostCount)} observed posts have both range boundaries
              </small>
            </div>
            <div className={styles.metric}>
              <span>Onboarding attention</span>
              <strong>{number(workspace.summary.applicationAttentionCount)}</strong>
              <small>{number(workspace.summary.verifiedPlatformAccountCount)} verified accounts · {number(workspace.summary.discordConnectedCount)} Discord connections</small>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="daily-activity-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="daily-activity-title">Daily activity</h2>
                <p>Published posts, creator submissions, and posts observed by tracking jobs.</p>
              </div>
              <small>{workspace.range.start} through {workspace.range.end} UTC</small>
            </header>
            <div className={styles.activityGrid}>
              {workspace.dailyActivity.map((day) => (
                <div
                  className={styles.activityDay}
                  data-level={activityLevel(day.posts, day.submissions, day.observedPosts)}
                  key={day.date}
                  title={`${day.posts} posts, ${day.submissions} submissions, ${day.observedPosts} observed posts`}
                >
                  <span>{day.posts + day.submissions + day.observedPosts}</span>
                  <small>{date(day.date)}</small>
                </div>
              ))}
            </div>
          </section>

          <div className={styles.twoColumn}>
            <section className={styles.panel} aria-labelledby="earnings-title">
              <header className={styles.panelHeader}>
                <div><h2 id="earnings-title">Earnings ledger</h2><p>Kept separate by recorded state.</p></div>
                <Link href="/admin/finance">Open finance</Link>
              </header>
              {moneyRows(workspace.earnings, "No earning entries exist in this reporting range.")}
            </section>
            <section className={styles.panel} aria-labelledby="settlements-title">
              <header className={styles.panelHeader}>
                <div><h2 id="settlements-title">Settlements</h2><p>Approval and payout states are never combined.</p></div>
              </header>
              {moneyRows(workspace.settlements, "No settlements exist in this reporting range.")}
            </section>
          </div>

          <section className={styles.panel} aria-labelledby="creator-activity-title">
            <header className={styles.panelHeader}>
              <div><h2 id="creator-activity-title">Recent creator activity</h2><p>Sorted by the latest stored creator, content, or assignment event.</p></div>
              <Link href="/admin/creators">View all creators</Link>
            </header>
            {workspace.creators.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Creator</th><th>Status</th><th>Platforms</th><th>Posts</th><th>Open submissions</th><th>Last activity</th></tr></thead>
                  <tbody>
                    {workspace.creators.slice(0, 8).map((creator) => (
                      <tr key={creator.accountId}>
                        <td><Link href={`/admin/creators/${creator.accountId}`}>{creator.name ?? creator.email}</Link><small>{creator.email}</small></td>
                        <td><span className={styles.status} data-tone={creator.lifecycleStatus === "active" ? "ok" : "warn"}>{stateLabel(creator.lifecycleStatus)}</span></td>
                        <td>{creator.platforms.length ? creator.platforms.map((platform) => `${platform.platform}: @${platform.handle.replace(/^@+/u, "")}`).join(" · ") : "No verified accounts"}</td>
                        <td>{number(creator.postCount)}</td>
                        <td>{number(creator.openSubmissionCount)}</td>
                        <td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(creator.lastActivityAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}><h3>No creator accounts</h3><p>Approved and signed-up creators will appear here.</p></div>
            )}
          </section>
        </>
      ) : (
        <p className={styles.error} role="alert">
          Creator operations are unavailable. No totals or tracking coverage claim is being made. Refresh before acting on this data.
        </p>
      )}
    </AdminWorkspaceShell>
  );
}
