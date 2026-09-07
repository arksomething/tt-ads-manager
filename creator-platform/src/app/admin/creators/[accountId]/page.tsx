import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminWorkspaceShell,
  adminWorkspaceStyles as styles,
} from "@/components/admin-workspace-shell";
import { formatMinorUnits } from "@/server/accounts/earnings";
import { requireCreatorStaff } from "@/server/admin/access";
import { getAdminCreatorProfile } from "@/server/admin/workspace";

export const metadata: Metadata = {
  title: "Creator profile",
  description: "Operational creator identity, content, tracking, and finance history.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ accountId: string }>;
};

type UnknownRecord = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function field(record: UnknownRecord | null, key: string) {
  return stringValue(record?.[key]);
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function label(value: string | null) {
  return value
    ? value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase())
    : "Not recorded";
}

function date(value: string | null, includeTime = false) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(parsed) + (includeTime ? " UTC" : "");
}

function integer(value: string | null) {
  if (!value || !/^\d+$/u.test(value)) return "Unknown";
  return new Intl.NumberFormat("en-US").format(BigInt(value));
}

function money(record: UnknownRecord, amountKey: "amountMinor" | "totalMinor") {
  const amount = field(record, amountKey);
  const currency = field(record, "currency");
  const exponentValue = record.currencyExponent;
  const exponent = typeof exponentValue === "number" && Number.isInteger(exponentValue) && exponentValue >= 0 && exponentValue <= 4
    ? exponentValue
    : null;
  return amount && /^-?\d+$/u.test(amount) && currency && exponent !== null
    ? formatMinorUnits(amount, currency, exponent)
    : "Amount unavailable";
}

function safeUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusTone(value: string | null) {
  return value && ["active", "approved", "completed", "matched", "verified", "paid", "reconciled"].includes(value)
    ? "ok"
    : "warn";
}

export default async function AdminCreatorProfilePage({ params }: PageProps) {
  const { accountId } = await params;
  if (!uuidPattern.test(accountId)) notFound();
  const { staff } = await requireCreatorStaff(`/admin/creators/${accountId}`);
  const profile = await getAdminCreatorProfile(accountId).catch(() => null);

  if (!profile) {
    return (
      <AdminWorkspaceShell
        active="creators"
        role={staff.role}
        eyebrow="Creator directory"
        title="Creator unavailable"
        description="This account could not be loaded. No identity, content, tracking, or finance claim is being made."
        actions={<Link className="button button--ghost" href="/admin/creators">Back to creators</Link>}
      >
        <p className={styles.error} role="alert">Refresh before taking an operational decision for this creator.</p>
      </AdminWorkspaceShell>
    );
  }

  const account = profile.account;
  const application = profile.application;
  const enrollment = profile.enrollment;
  const agreement = profile.agreement;
  const creatorName = field(application, "name") ?? field(account, "email") ?? "Creator";
  const applicationId = field(application, "id");

  return (
    <AdminWorkspaceShell
      active="creators"
      role={staff.role}
      eyebrow="Creator profile"
      title={creatorName}
      description="Account-level evidence across onboarding, platform ownership, publishing, tracking observations, assigned work, earnings, and settlements."
      actions={
        <>
          {applicationId ? <Link className="button button--ghost" href={`/admin/applications/${applicationId}`}>Review application</Link> : null}
          <Link className="button button--ink" href="/admin/creators">All creators</Link>
        </>
      }
    >
      <dl className={styles.profileGrid}>
        <div><dt>Email</dt><dd>{field(account, "email") ?? "Not recorded"}</dd></div>
        <div><dt>Lifecycle</dt><dd><span className={styles.status} data-tone={statusTone(field(account, "lifecycleStatus"))}>{label(field(account, "lifecycleStatus"))}</span></dd></div>
        <div><dt>Account created</dt><dd>{date(field(account, "createdAt"), true)}</dd></div>
      </dl>

      <div className={styles.twoColumn}>
        <section className={styles.panel} aria-labelledby="application-title">
          <header className={styles.panelHeader}><div><h2 id="application-title">Application identity</h2><p>Creator-supplied contact information and review state.</p></div></header>
          {application ? (
            <dl className={styles.profileGrid}>
              <div><dt>Status</dt><dd><span className={styles.status} data-tone={statusTone(field(application, "status"))}>{label(field(application, "status"))}</span></dd></div>
              <div><dt>Discord</dt><dd>{field(application, "discordUsername") ?? "Not recorded"}</dd></div>
              <div><dt>Phone</dt><dd>{field(application, "phoneNumber") ?? "Not recorded"}</dd></div>
            </dl>
          ) : <div className={styles.empty}><h3>No application</h3><p>This account has no linked creator application.</p></div>}
        </section>

        <section className={styles.panel} aria-labelledby="onboarding-title">
          <header className={styles.panelHeader}><div><h2 id="onboarding-title">Enrollment and agreement</h2><p>Approval and signature remain separate gates.</p></div></header>
          <div className={styles.moneyList}>
            <div className={styles.moneyRow}><span>Enrollment</span><strong>{label(field(enrollment, "status"))}</strong></div>
            <div className={styles.moneyRow}><span>Agreement</span><strong>{label(field(agreement, "status"))}</strong></div>
            <div className={styles.moneyRow}><span>Signing provider</span><strong>{field(agreement, "provider") ?? "Not assigned"}</strong></div>
            <div className={styles.moneyRow}><span>Agreement completed</span><strong>{date(field(agreement, "completedAt"), true)}</strong></div>
          </div>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="platform-claims-title">
        <header className={styles.panelHeader}><div><h2 id="platform-claims-title">Platform ownership</h2><p>Submitted handles and stored verification outcomes.</p></div><Link href="/admin/verifications">Verification queue</Link></header>
        {profile.platformClaims.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Platform</th><th>Handle</th><th>Status</th><th>Last checked</th><th>Verified</th></tr></thead>
              <tbody>{profile.platformClaims.map((claim) => (
                <tr key={field(claim, "id") ?? `${field(claim, "platform")}-${field(claim, "handle")}`}>
                  <td>{field(claim, "platform") === "INSTAGRAM_REELS" ? "Instagram" : label(field(claim, "platform"))}</td>
                  <td>@{(field(claim, "handle") ?? "Unknown").replace(/^@+/u, "")}</td>
                  <td><span className={styles.status} data-tone={statusTone(field(claim, "status"))}>{label(field(claim, "status"))}</span></td>
                  <td>{date(field(claim, "lastCheckedAt"), true)}</td>
                  <td>{date(field(claim, "verifiedAt"), true)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className={styles.empty}><h3>No platform claims</h3><p>No creator handles are linked to this account.</p></div>}
      </section>

      <section className={styles.panel} aria-labelledby="posts-title">
        <header className={styles.panelHeader}><div><h2 id="posts-title">Attributed posts and latest observations</h2><p>A missing observation is shown as unknown, never as zero.</p></div><Link href="/admin/content">Content queue</Link></header>
        {profile.posts.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Post</th><th>Published</th><th>Attribution</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Observed</th></tr></thead>
              <tbody>{profile.posts.map((post) => {
                const observation = recordValue(post.latestObservation);
                const url = safeUrl(field(post, "url"));
                return (
                  <tr key={field(post, "id") ?? field(post, "nativePostId") ?? "post"}>
                    <td>{url ? <a href={url} rel="noreferrer" target="_blank">{label(field(post, "platform"))} post</a> : label(field(post, "platform"))}<small>{field(post, "nativePostId") ?? "Native ID unknown"}</small></td>
                    <td>{date(field(post, "publishedAt"), true)}</td>
                    <td><span className={styles.status} data-tone={statusTone(field(post, "attributionState"))}>{label(field(post, "attributionState"))}</span></td>
                    <td>{integer(field(observation, "viewCount"))}</td>
                    <td>{integer(field(observation, "likeCount"))}</td>
                    <td>{integer(field(observation, "commentCount"))}</td>
                    <td>{integer(field(observation, "shareCount"))}</td>
                    <td>{date(field(observation, "observedAt"), true)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <div className={styles.empty}><h3>No attributed posts</h3><p>Matched creator submissions and discovered posts will appear here.</p></div>}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.panel} aria-labelledby="submissions-title">
          <header className={styles.panelHeader}><div><h2 id="submissions-title">Content submissions</h2><p>Creator-reported URLs and matching state.</p></div></header>
          {profile.submissions.length ? (
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Submission</th><th>State</th><th>Submitted</th></tr></thead>
              <tbody>{profile.submissions.map((submission) => {
                const url = safeUrl(field(submission, "url"));
                return <tr key={field(submission, "id") ?? "submission"}>
                  <td>{url ? <a href={url} rel="noreferrer" target="_blank">{label(field(submission, "platform"))} URL</a> : label(field(submission, "platform"))}</td>
                  <td><span className={styles.status} data-tone={statusTone(field(submission, "matchState"))}>{label(field(submission, "matchState"))}</span></td>
                  <td>{date(field(submission, "submittedAt"), true)}</td>
                </tr>;
              })}</tbody>
            </table></div>
          ) : <div className={styles.empty}><h3>No submissions</h3><p>The creator has not submitted a content URL.</p></div>}
        </section>

        <section className={styles.panel} aria-labelledby="scripts-title">
          <header className={styles.panelHeader}><div><h2 id="scripts-title">Assigned scripts</h2><p>Current creator assignment history.</p></div></header>
          {profile.scripts.length ? (
            <div className={styles.moneyList}>{profile.scripts.map((script, index) => (
              <div className={styles.moneyRow} key={`${field(script, "title")}-${field(script, "assignedAt")}-${index}`}>
                <span>{field(script, "title") ?? "Untitled script"}<small>Assigned {date(field(script, "assignedAt"))}</small></span>
                <strong>{label(field(script, "state"))}</strong>
              </div>
            ))}</div>
          ) : <div className={styles.empty}><h3>No assigned scripts</h3><p>Assignments from the script library will appear here.</p></div>}
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="earnings-title">
        <header className={styles.panelHeader}><div><h2 id="earnings-title">Earnings ledger</h2><p>Estimated, pending, approved, paid, and reconciled remain distinct.</p></div><Link href="/admin/finance">Finance workspace</Link></header>
        {profile.earnings.length ? (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Earned</th><th>Category</th><th>Amount</th><th>State</th><th>Post reference</th></tr></thead>
            <tbody>{profile.earnings.map((earning) => (
              <tr key={field(earning, "id") ?? "earning"}>
                <td>{date(field(earning, "earnedAt"), true)}</td>
                <td>{label(field(earning, "category"))}</td>
                <td><strong>{money(earning, "amountMinor")}</strong></td>
                <td><span className={styles.status} data-tone={statusTone(field(earning, "state"))}>{label(field(earning, "state"))}</span></td>
                <td>{field(earning, "postId") ?? "Program-level earning"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className={styles.empty}><h3>No earnings recorded</h3><p>No zero balance is inferred from an empty ledger.</p></div>}
      </section>

      <section className={styles.panel} aria-labelledby="settlements-title">
        <header className={styles.panelHeader}><div><h2 id="settlements-title">Settlement history</h2><p>Recorded payout batches; provider delivery is a separate state transition.</p></div></header>
        {profile.settlements.length ? (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Created</th><th>Amount</th><th>State</th><th>Settlement ID</th></tr></thead>
            <tbody>{profile.settlements.map((settlement) => (
              <tr key={field(settlement, "id") ?? "settlement"}>
                <td>{date(field(settlement, "createdAt"), true)}</td>
                <td><strong>{money(settlement, "totalMinor")}</strong></td>
                <td><span className={styles.status} data-tone={statusTone(field(settlement, "state"))}>{label(field(settlement, "state"))}</span></td>
                <td>{field(settlement, "id") ?? "Not recorded"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className={styles.empty}><h3>No settlements recorded</h3><p>No payout status is inferred until a settlement record exists.</p></div>}
      </section>
    </AdminWorkspaceShell>
  );
}
