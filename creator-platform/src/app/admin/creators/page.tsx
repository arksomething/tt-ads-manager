import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminWorkspaceShell,
  adminWorkspaceStyles as styles,
} from "@/components/admin-workspace-shell";
import { requireCreatorStaff } from "@/server/admin/access";
import { getAdminWorkspace } from "@/server/admin/workspace";

export const metadata: Metadata = {
  title: "Creator directory",
  description: "Search creator identities, lifecycle states, platform accounts, and content activity.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function number(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function date(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export default async function AdminCreatorsPage({ searchParams }: PageProps) {
  const { staff } = await requireCreatorStaff("/admin/creators");
  const query = await searchParams;
  const search = (first(query.q) ?? "").trim().slice(0, 120);
  const normalizedSearch = search.toLocaleLowerCase("en-US");
  const workspace = await getAdminWorkspace().catch(() => null);
  const creators = workspace?.creators.filter((creator) => {
    if (!normalizedSearch) return true;
    const searchable = [
      creator.name,
      creator.email,
      creator.lifecycleStatus,
      creator.applicationStatus,
      creator.enrollmentStatus,
      ...creator.platforms.flatMap((platform) => [platform.platform, platform.handle, platform.status]),
    ].filter(Boolean).join(" ").toLocaleLowerCase("en-US");
    return searchable.includes(normalizedSearch);
  }) ?? [];

  return (
    <AdminWorkspaceShell
      active="creators"
      role={staff.role}
      eyebrow="Program directory"
      title="Creators"
      description="One account-centric directory for identity, lifecycle, verified platform accounts, submissions, and publishing activity."
      actions={<Link className="button button--ghost" href="/admin/applications">Application queue</Link>}
    >
      <form className={styles.search} method="get" role="search">
        <label>
          <span>Search creators</span>
          <input
            aria-label="Search creators"
            defaultValue={search}
            maxLength={120}
            name="q"
            placeholder="Name, email, handle, or status"
            type="search"
          />
        </label>
        <button className="button button--ink" type="submit">Search</button>
        {search ? <Link className="button button--ghost" href="/admin/creators">Clear</Link> : null}
      </form>

      {workspace ? (
        <section className={styles.panel} aria-labelledby="creator-directory-title">
          <header className={styles.panelHeader}>
            <div>
              <h2 id="creator-directory-title">Creator directory</h2>
              <p>{search ? `${number(creators.length)} matching ${number(workspace.creators.length)} total accounts` : `${number(creators.length)} creator accounts`}</p>
            </div>
          </header>
          {creators.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Lifecycle</th>
                    <th>Platform accounts</th>
                    <th>Posts</th>
                    <th>Needs matching</th>
                    <th>Last post</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {creators.map((creator) => (
                    <tr key={creator.accountId}>
                      <td>
                        <Link href={`/admin/creators/${creator.accountId}`}>{creator.name ?? creator.email}</Link>
                        <small>{creator.email}</small>
                      </td>
                      <td>
                        <span className={styles.status} data-tone={creator.lifecycleStatus === "active" ? "ok" : "warn"}>
                          {label(creator.lifecycleStatus)}
                        </span>
                        <small>{creator.enrollmentStatus ? `Enrollment: ${label(creator.enrollmentStatus)}` : "No enrollment"}</small>
                      </td>
                      <td>
                        {creator.platforms.length
                          ? creator.platforms.map((platform) => (
                              <span key={`${platform.platform}-${platform.handle}`}>
                                <strong>{platform.platform === "INSTAGRAM_REELS" ? "Instagram" : label(platform.platform)}</strong>
                                <small>@{platform.handle.replace(/^@+/u, "")} · {label(platform.status)}</small>
                              </span>
                            ))
                          : "No verified accounts"}
                      </td>
                      <td>{number(creator.postCount)}</td>
                      <td>{number(creator.openSubmissionCount)}</td>
                      <td>{date(creator.lastPostAt)}</td>
                      <td>{date(creator.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.empty}>
              <h3>{search ? "No matching creators" : "No creator accounts"}</h3>
              <p>{search ? "Try a name, email address, platform handle, or lifecycle state." : "Creator accounts will appear after sign-up."}</p>
            </div>
          )}
        </section>
      ) : (
        <p className={styles.error} role="alert">
          The creator directory is unavailable. No creator-count or activity claim is being made.
        </p>
      )}
    </AdminWorkspaceShell>
  );
}
