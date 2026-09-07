import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContentLibraryHeader } from "@/components/content-library-header";
import styles from "@/components/content-library.module.css";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentDiscordStaffMembership } from "@/server/admin/discord";
import { getCurrentAccount } from "@/server/auth/session";
import { getContentAdminOverview, type AdminScript, type ContentCreator } from "@/server/content/library";

export const metadata: Metadata = { title: "Script library" };
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function date(value: string | null) {
  if (!value) return "No due date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

function ScriptCard({ script, creators }: { script: AdminScript; creators: ContentCreator[] }) {
  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2>{script.title}</h2>
          <p>{script.summary || "No summary added."}</p>
        </div>
        <span className={`${styles.badge} ${script.status === "published" ? styles.badgePublished : ""}`}>{script.status}</span>
      </header>
      <div className={styles.cardBody}>
        <p className={styles.meta}><span>Revision {script.revision}</span><span>{script.assignments.length} active assignment{script.assignments.length === 1 ? "" : "s"}</span></p>
        <pre className={styles.scriptBody}>{script.bodyMarkdown}</pre>

        {script.status !== "archived" ? (
          <details className={styles.details}>
            <summary>Edit script</summary>
            <form className={styles.form} action="/api/admin/content/scripts" method="post">
              <input type="hidden" name="action" value="save" />
              <input type="hidden" name="id" value={script.id} />
              <label className={styles.field}><span>Title</span><input name="title" defaultValue={script.title} minLength={2} maxLength={140} required /></label>
              <label className={styles.field}><span>Summary</span><textarea name="summary" defaultValue={script.summary} maxLength={500} /></label>
              <label className={styles.field}><span>Script</span><textarea className={styles.body} name="bodyMarkdown" defaultValue={script.bodyMarkdown} maxLength={100000} required /></label>
              <button className={styles.button} type="submit">Save revision</button>
            </form>
          </details>
        ) : null}

        <div className={styles.actions}>
          {script.status === "draft" ? (
            <>
              <form action="/api/admin/content/scripts" method="post"><input type="hidden" name="action" value="publish" /><input type="hidden" name="scriptId" value={script.id} /><button className={styles.button} type="submit">Publish</button></form>
              <form action="/api/admin/content/scripts" method="post"><input type="hidden" name="action" value="delete" /><input type="hidden" name="scriptId" value={script.id} /><button className={styles.buttonDanger} type="submit">Delete draft</button></form>
            </>
          ) : script.status === "published" ? (
            <form action="/api/admin/content/scripts" method="post"><input type="hidden" name="action" value="archive" /><input type="hidden" name="scriptId" value={script.id} /><button className={styles.buttonSecondary} type="submit">Archive</button></form>
          ) : null}
        </div>

        {script.status === "published" ? (
          <section className={styles.assignBox} aria-label={`Assign ${script.title}`}>
            <h3>Assign to a creator</h3>
            {creators.length ? (
              <form className={styles.assignGrid} action="/api/admin/content/scripts" method="post">
                <input type="hidden" name="action" value="assign" />
                <input type="hidden" name="scriptId" value={script.id} />
                <label className={styles.field}><span>Creator</span><select name="enrollmentId" required defaultValue=""><option value="" disabled>Select creator</option>{creators.map((creator) => <option key={creator.enrollmentId} value={creator.enrollmentId}>{creator.name} · {creator.email}</option>)}</select></label>
                <label className={styles.field}><span>Due date</span><input name="dueAt" type="date" /></label>
                <label className={styles.field}><span>Creator note</span><input name="note" maxLength={1000} placeholder="Optional direction" /></label>
                <button className={styles.button} type="submit">Assign</button>
              </form>
            ) : <p className={styles.hint}>Approve a creator before assigning scripts.</p>}
          </section>
        ) : null}

        {script.assignments.length ? (
          <ul className={styles.assignments} aria-label="Current assignments">
            {script.assignments.map((assignment) => (
              <li key={assignment.id}>
                <span><strong>{assignment.creatorName}</strong><br /><small>{assignment.state} · {date(assignment.dueAt)}</small></span>
                <form action="/api/admin/content/scripts" method="post"><input type="hidden" name="action" value="withdraw" /><input type="hidden" name="assignmentId" value={assignment.id} /><button className={styles.buttonDanger} type="submit">Withdraw</button></form>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

export default async function AdminScriptsPage({ searchParams }: PageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fadmin%2Fscripts");
  const staff = await getCurrentDiscordStaffMembership().catch(() => null);
  if (!staff) redirect("/account");
  const overview = await getContentAdminOverview().catch(() => null);
  const params = await searchParams;

  return (
    <main className={styles.page}>
      <ContentLibraryHeader active="scripts" staff />
      <div className={styles.main}>
        <header className={styles.hero}>
          <div><p className={styles.eyebrow}>Program content</p><h1>Script library</h1><p>Create reviewed scripts, publish them, and assign the right revision to individual creators.</p></div>
          {overview ? <span className={styles.count}>{overview.scripts.length} scripts</span> : null}
        </header>
        {getSearchParamValue(params, "notice") ? <p className={styles.flash} role="status">{getSearchParamValue(params, "notice")}</p> : null}
        {getSearchParamValue(params, "error") ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{getSearchParamValue(params, "error")}</p> : null}
        {!overview ? <section className={styles.empty} role="alert"><h2>Script data is unavailable</h2><p>No content or assignment claim is being made. Refresh before changing the library.</p></section> : (
          <div className={styles.grid}>
            <aside className={styles.panel}>
              <header className={styles.panelHeader}><h2>New script</h2><p>Drafts remain staff-only until published.</p></header>
              <form className={styles.form} action="/api/admin/content/scripts" method="post">
                <input type="hidden" name="action" value="save" />
                <label className={styles.field}><span>Title</span><input name="title" minLength={2} maxLength={140} required /></label>
                <label className={styles.field}><span>Summary</span><textarea name="summary" maxLength={500} placeholder="When should a creator use this?" /></label>
                <label className={styles.field}><span>Script</span><textarea className={styles.body} name="bodyMarkdown" maxLength={100000} placeholder="Hook, beats, CTA, and guardrails" required /></label>
                <button className={styles.button} type="submit">Create draft</button>
              </form>
            </aside>
            <section className={styles.list} aria-label="Scripts">
              {overview.scripts.length ? overview.scripts.map((script) => <ScriptCard key={script.id} script={script} creators={overview.creators} />) : <div className={styles.empty}><h2>No scripts yet</h2><p>Create the first draft. It will not appear for creators until you publish and assign it.</p></div>}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
