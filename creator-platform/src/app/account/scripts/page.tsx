import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContentLibraryHeader } from "@/components/content-library-header";
import styles from "@/components/content-library.module.css";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentAccount } from "@/server/auth/session";
import { getOwnCreatorContentLibrary } from "@/server/content/library";

export const metadata: Metadata = { title: "My scripts" };
export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function date(value: string | null) {
  if (!value) return "No due date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export default async function CreatorScriptsPage({ searchParams }: PageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Faccount%2Fscripts");
  const library = await getOwnCreatorContentLibrary().catch(() => null);
  const params = await searchParams;
  return (
    <main className={styles.page}><ContentLibraryHeader active="scripts" /><div className={styles.main}>
      <header className={styles.hero}><div><p className={styles.eyebrow}>Creator workspace</p><h1>Your scripts</h1><p>Every item here is the current published revision assigned to your creator account.</p></div>{library ? <span className={styles.count}>{library.scripts.length} assigned</span> : null}</header>
      {getSearchParamValue(params, "notice") ? <p className={styles.flash} role="status">{getSearchParamValue(params, "notice")}</p> : null}
      {getSearchParamValue(params, "error") ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{getSearchParamValue(params, "error")}</p> : null}
      {!library ? <section className={styles.empty} role="alert"><h2>Scripts are temporarily unavailable</h2><p>No assignment claim is being made. Refresh this page before recording progress.</p></section> : library.scripts.length ? <section className={styles.creatorGrid} aria-label="Assigned scripts">{library.scripts.map((script) => <article className={styles.card} key={script.assignmentId}><header className={styles.cardHeader}><div><h2>{script.title}</h2><p>{script.summary || "Assigned program script"}</p></div><span className={`${styles.badge} ${script.state !== "assigned" ? styles.badgePublished : ""}`}>{script.state}</span></header><div className={styles.cardBody}><p className={styles.meta}><span>Revision {script.revision}</span><span>{date(script.dueAt)}</span></p>{script.note ? <p className={styles.note}><strong>Creator-team note:</strong> {script.note}</p> : null}<pre className={styles.scriptBody}>{script.bodyMarkdown}</pre><div className={styles.actions}>{script.state === "assigned" ? <form action="/api/content/assignments" method="post"><input type="hidden" name="kind" value="script" /><input type="hidden" name="assignmentId" value={script.assignmentId} /><input type="hidden" name="state" value="viewed" /><button className={styles.buttonSecondary} type="submit">Mark viewed</button></form> : null}{script.state !== "used" ? <form action="/api/content/assignments" method="post"><input type="hidden" name="kind" value="script" /><input type="hidden" name="assignmentId" value={script.assignmentId} /><input type="hidden" name="state" value="used" /><button className={styles.button} type="submit">Mark used</button></form> : null}</div></div></article>)}</section> : <section className={styles.empty}><h2>No scripts assigned yet</h2><p>Your creator team’s published script assignments will appear here. Nothing is being shown as missing or overdue.</p></section>}
    </div></main>
  );
}
