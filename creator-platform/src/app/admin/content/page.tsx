import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";

import {
  AdminWorkspaceShell,
  adminWorkspaceStyles as workspaceStyles,
} from "@/components/admin-workspace-shell";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { requireCreatorStaff } from "@/server/admin/access";
import { getAdminContentQueue } from "@/server/admin/content-finance";

import styles from "../content-finance.module.css";

export const metadata: Metadata = { title: "Content review" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function platformLabel(value: "TIKTOK" | "INSTAGRAM_REELS") {
  return value === "TIKTOK" ? "TikTok" : "Instagram";
}

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : `${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(parsed)} UTC`;
}

export default async function AdminContentPage({ searchParams }: PageProps) {
  const { staff } = await requireCreatorStaff("/admin/content");
  const [params, queueResult] = await Promise.all([
    searchParams,
    getAdminContentQueue().then((queue) => ({ queue, failed: false as const })).catch(() => ({
      queue: [],
      failed: true as const,
    })),
  ]);
  const notice = getSearchParamValue(params, "notice");
  const error = getSearchParamValue(params, "error");

  return (
    <AdminWorkspaceShell
      active="content"
      role={staff.role}
      eyebrow="Attribution operations"
      title="Content review"
      description="Creator submissions are claims until staff matches them to a canonical post. Review states and attribution decisions are written to the audit trail."
      actions={<Link className={styles.secondaryButton} href="/admin/verifications">Campaign accounts</Link>}
    >
      {notice ? <p className={styles.flash} role="status">{notice}</p> : null}
      {error ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{error}</p> : null}

      {queueResult.failed ? (
        <p className={workspaceStyles.error} role="alert">
          The content queue is unavailable. No queue count or attribution state is being claimed. Refresh before reviewing a post.
        </p>
      ) : queueResult.queue.length === 0 ? (
        <section className={workspaceStyles.panel}>
          <div className={workspaceStyles.empty}>
            <CheckCircle2 aria-hidden="true" size={20} />
            <h2>No open submissions</h2>
            <p>The live review queue returned no submitted, matching, or needs-review items. This does not claim that every creator has posted.</p>
          </div>
        </section>
      ) : (
        <section className={styles.queue} aria-label="Open content submissions">
          {queueResult.queue.map((item) => (
            <article className={styles.queueCard} key={item.id}>
              <header className={styles.queueHeader}>
                <div>
                  <p>{platformLabel(item.platform)} submission · {date(item.submittedAt)}</p>
                  <h2><Link href={`/admin/creators/${item.accountId}`}>Creator {item.accountId.slice(0, 8)}</Link></h2>
                </div>
                <span className={workspaceStyles.status} data-tone={item.matchState === "needs_review" ? "warn" : undefined}>
                  {label(item.matchState)}
                </span>
              </header>

              <div className={styles.queueBody}>
                <dl className={styles.claimFacts}>
                  <div>
                    <dt>Creator-submitted URL</dt>
                    <dd><a href={item.url} rel="noreferrer" target="_blank">Open post <ExternalLink aria-hidden="true" size={11} /></a></dd>
                  </div>
                  <div><dt>Declared native post ID</dt><dd>{item.declaredNativePostId ?? "Not supplied"}</dd></div>
                  <div><dt>Canonical match</dt><dd>{item.matchedPostId ?? "Not matched"}</dd></div>
                  <div><dt>Submission ID</dt><dd><code>{item.id}</code></dd></div>
                </dl>

                <div className={styles.forms}>
                  <form className={styles.form} action="/api/admin/content/review" method="post">
                    <input name="submissionId" type="hidden" value={item.id} />
                    <div className={styles.formGrid}>
                      <label className={styles.field}>
                        <span>Review state</span>
                        <select name="state" defaultValue={item.matchState === "submitted" ? "matching" : item.matchState}>
                          <option value="matching">Matching in progress</option>
                          <option value="needs_review">Needs attention</option>
                          <option value="rejected">Reject submission</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>Audit note</span>
                        <input name="note" maxLength={1000} placeholder="Required for attention or rejection" />
                      </label>
                    </div>
                    <div className={styles.formActions}>
                      <button className={styles.secondaryButton} type="submit">Save review state</button>
                    </div>
                  </form>

                  <details className={styles.details}>
                    <summary>Review and match canonical post</summary>
                    <form className={styles.matchForm} action="/api/admin/content/match" method="post">
                      <input name="submissionId" type="hidden" value={item.id} />
                      <div className={styles.formGrid}>
                        <label className={`${styles.field} ${styles.fieldWide}`}>
                          <span>Canonical post URL</span>
                          <input name="canonicalUrl" type="url" defaultValue={item.url} maxLength={2048} required />
                        </label>
                        <label className={styles.field}>
                          <span>Native post ID</span>
                          <input name="nativePostId" defaultValue={item.declaredNativePostId ?? ""} maxLength={191} />
                        </label>
                        <label className={styles.field}>
                          <span>Published at (UTC)</span>
                          <input name="publishedAt" type="datetime-local" step="1" />
                        </label>
                        <label className={styles.field}>
                          <span>Provider key</span>
                          <input name="provider" maxLength={80} placeholder="Optional, e.g. tracker" />
                        </label>
                        <label className={styles.field}>
                          <span>Provider post ID</span>
                          <input name="providerPostId" maxLength={191} placeholder="Required with provider" />
                        </label>
                        <label className={styles.field}>
                          <span>Provider account ID</span>
                          <input name="providerAccountId" maxLength={191} placeholder="Optional" />
                        </label>
                        <label className={styles.field}>
                          <span>Attribution note</span>
                          <input name="reviewNote" maxLength={1000} placeholder="Evidence or review context" />
                        </label>
                      </div>
                      <p className={styles.truthNote}><ShieldCheck aria-hidden="true" size={11} /> Matching creates the canonical attribution record. It does not invent metrics, earnings, or provider observations.</p>
                      <div className={styles.formActions}>
                        <button className={styles.primaryButton} type="submit">Confirm attribution</button>
                      </div>
                    </form>
                  </details>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </AdminWorkspaceShell>
  );
}
