import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContentLibraryHeader } from "@/components/content-library-header";
import styles from "@/components/content-library.module.css";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentAccount } from "@/server/auth/session";
import { getOwnCreatorContentLibrary } from "@/server/content/library";

export const metadata: Metadata = { title: "My assets" };
export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function size(value: number | null) {
  if (value === null) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function CreatorAssetsPage({ searchParams }: PageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Faccount%2Fassets");
  const library = await getOwnCreatorContentLibrary().catch(() => null);
  const params = await searchParams;
  return (
    <main className={styles.page}><ContentLibraryHeader active="assets" /><div className={styles.main}>
      <header className={styles.hero}><div><p className={styles.eyebrow}>Creator workspace</p><h1>Your assets</h1><p>Download only the campaign files and approved links assigned to your account.</p></div>{library ? <span className={styles.count}>{library.assets.length} assigned</span> : null}</header>
      {getSearchParamValue(params, "notice") ? <p className={styles.flash} role="status">{getSearchParamValue(params, "notice")}</p> : null}
      {getSearchParamValue(params, "error") ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{getSearchParamValue(params, "error")}</p> : null}
      {!library ? <section className={styles.empty} role="alert"><h2>Assets are temporarily unavailable</h2><p>No access or assignment claim is being made. Refresh before downloading content.</p></section> : library.assets.length ? <section className={styles.creatorGrid} aria-label="Assigned assets">{library.assets.map((asset) => <article className={styles.card} key={asset.assignmentId}><header className={styles.cardHeader}><div><h2>{asset.title}</h2><p>{asset.description || "Assigned program asset"}</p></div><span className={`${styles.badge} ${asset.state === "viewed" ? styles.badgePublished : ""}`}>{asset.state}</span></header><div className={styles.cardBody}><p className={styles.meta}><span>{asset.assetKind}</span><span>{asset.originalFilename ?? (asset.sourceType === "external_url" ? "External link" : "Private file")}</span>{size(asset.sizeBytes) ? <span>{size(asset.sizeBytes)}</span> : null}<span>Revision {asset.revision}</span></p>{asset.note ? <p className={styles.note}><strong>Creator-team note:</strong> {asset.note}</p> : null}<div className={styles.actions}><a className={styles.linkButton} href={`/api/assets/${asset.assetId}/download`} target="_blank" rel="noreferrer">{asset.sourceType === "upload" ? "Download asset" : "Open approved link"}</a>{asset.state === "assigned" ? <form action="/api/content/assignments?returnTo=%2Faccount%2Fassets" method="post"><input type="hidden" name="kind" value="asset" /><input type="hidden" name="assignmentId" value={asset.assignmentId} /><input type="hidden" name="state" value="viewed" /><button className={styles.buttonSecondary} type="submit">Mark viewed</button></form> : null}</div></div></article>)}</section> : <section className={styles.empty}><h2>No assets assigned yet</h2><p>Your creator team’s published asset assignments will appear here. Private files are never exposed before assignment.</p></section>}
    </div></main>
  );
}
