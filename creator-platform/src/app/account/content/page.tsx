import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContentSubmissionForm } from "@/components/content-submission-form";
import { CreatorWorkspaceShell } from "@/components/creator-workspace-shell";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  getOwnContentWorkspace,
  type ContentMatchState,
  type ContentPlatform,
} from "@/server/accounts/content";
import { getCurrentAccount } from "@/server/auth/session";

import styles from "@/components/creator-workspace.module.css";

export const metadata: Metadata = { title: "Creator content" };
export const dynamic = "force-dynamic";

function platformLabel(platform: ContentPlatform) {
  return platform === "TIKTOK" ? "TikTok" : "Instagram Reels";
}

function statusLabel(status: ContentMatchState) {
  const labels: Record<ContentMatchState, string> = {
    submitted: "Submitted",
    matching: "Matching",
    matched: "Matched",
    needs_review: "Needs review",
    rejected: "Not accepted",
    withdrawn: "Withdrawn",
  };
  return labels[status];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatCounter(value: string | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
    .format(BigInt(value));
}

export default async function CreatorContentPage() {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Faccount%2Fcontent");

  const workspaceResult = await Promise.allSettled([getOwnContentWorkspace()]);
  const workspace = workspaceResult[0].status === "fulfilled" ? workspaceResult[0].value : null;

  return (
    <CreatorWorkspaceShell
      active="content"
      eyebrow="Publishing"
      title="Your content"
      description="Submit a published post once. The creator team and tracker will match it to a canonical post before performance or earnings appear."
      accountEmail={account.email}
    >
      {workspace ? (
        <>
          <section className={styles.panel} aria-labelledby="submit-content-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>New submission</p>
                <h2 id="submit-content-title">Add a published post</h2>
              </div>
              <span className={styles.truthBadge}>Attribution reviewed</span>
            </div>
            <p className={styles.panelIntro}>
              A URL is a creator claim, not tracking proof. Matching and verified observations are recorded separately.
            </p>
            <ContentSubmissionForm
              canSubmit={workspace.canSubmit}
              platformAccounts={workspace.platformAccounts}
            />
          </section>

          <section className={styles.panel} aria-labelledby="submission-history-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Submission history</p>
                <h2 id="submission-history-title">Posts you sent us</h2>
              </div>
            </div>
            {workspace.submissions.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No posts submitted yet</h3>
                <p>Your first submitted URL will appear here with its real matching state.</p>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Post</th><th>Status</th><th>Submitted</th></tr></thead>
                  <tbody>
                    {workspace.submissions.map((submission) => (
                      <tr key={submission.id}>
                        <td>
                          <a href={submission.url} target="_blank" rel="noreferrer">
                            {platformLabel(submission.platform)} post
                          </a>
                          {submission.declaredNativePostId ? (
                            <small>Native ID {submission.declaredNativePostId}</small>
                          ) : null}
                        </td>
                        <td><span className={styles.statePill}>{statusLabel(submission.matchState)}</span></td>
                        <td>{formatDate(submission.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="tracked-posts-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Attributed content</p>
                <h2 id="tracked-posts-title">Matched posts</h2>
              </div>
            </div>
            {workspace.posts.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No posts matched yet</h3>
                <p>This does not mean you have no views. Verified post and observation data has not been connected to this account yet.</p>
              </div>
            ) : (
              <div className={styles.cardList}>
                {workspace.posts.map((post) => {
                  const views = formatCounter(post.latestObservation?.viewCount ?? null);
                  return (
                    <article className={styles.postCard} key={post.id}>
                      <div>
                        <span className={styles.statePill}>{platformLabel(post.platform)}</span>
                        <h3>
                          {post.canonicalUrl ? (
                            <a href={post.canonicalUrl} target="_blank" rel="noreferrer">Open published post</a>
                          ) : "Matched provider post"}
                        </h3>
                        <p>{post.publishedAt ? `Published ${formatDate(post.publishedAt)}` : "Publish time is not verified yet."}</p>
                      </div>
                      <div className={styles.metricBlock}>
                        {views ? (
                          <><strong>{views}</strong><span>verified views</span></>
                        ) : (
                          <><strong>—</strong><span>Waiting for a verified observation</span></>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className={styles.panel}>
          <div className={styles.errorState} role="alert">
            <h2>Content data is temporarily unavailable</h2>
            <p>We could not verify your submission or tracking state. Refresh before relying on this page.</p>
          </div>
        </section>
      )}
    </CreatorWorkspaceShell>
  );
}
