import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContentLibraryHeader } from "@/components/content-library-header";
import styles from "@/components/content-library.module.css";
import { AdminAssetCreateForm } from "@/components/admin-asset-create-form";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentDiscordStaffMembership } from "@/server/admin/discord";
import { getCurrentAccount } from "@/server/auth/session";
import { getContentAdminOverview, type AdminAsset, type ContentCreator } from "@/server/content/library";

export const metadata: Metadata = { title: "Asset library" };
export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function size(value: number | null) {
  if (value === null) return "Size unavailable";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetCard({ asset, creators }: { asset: AdminAsset; creators: ContentCreator[] }) {
  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div><h2>{asset.title}</h2><p>{asset.description || "No description added."}</p></div>
        <span className={`${styles.badge} ${asset.status === "published" ? styles.badgePublished : ""}`}>{asset.status}</span>
      </header>
      <div className={styles.cardBody}>
        <p className={styles.meta}><span>{asset.assetKind}</span><span>{asset.sourceType === "upload" ? asset.originalFilename ?? "Uploaded file" : "External HTTPS link"}</span><span>{size(asset.sizeBytes)}</span><span>Revision {asset.revision}</span></p>
        {asset.status !== "archived" ? <details className={styles.details}><summary>Edit asset details</summary><form className={styles.form} action="/api/admin/content/assets" method="post"><input type="hidden" name="action" value="save" /><input type="hidden" name="assetId" value={asset.id} /><label className={styles.field}><span>Title</span><input name="title" defaultValue={asset.title} minLength={2} maxLength={140} required /></label><label className={styles.field}><span>Description</span><textarea name="description" defaultValue={asset.description} maxLength={1000} /></label><label className={styles.field}><span>Type</span><select name="assetKind" defaultValue={asset.assetKind}><option value="brand">Brand</option><option value="template">Template</option><option value="footage">Footage</option><option value="audio">Audio</option><option value="image">Image</option><option value="document">Document</option><option value="link">Link</option><option value="other">Other</option></select></label><button className={styles.button} type="submit">Save revision</button></form></details> : null}
        <div className={styles.actions}>
          {asset.status === "draft" ? <><form action="/api/admin/content/assets" method="post"><input type="hidden" name="action" value="publish" /><input type="hidden" name="assetId" value={asset.id} /><button className={styles.button} type="submit">Publish</button></form><form action="/api/admin/content/assets" method="post"><input type="hidden" name="action" value="delete" /><input type="hidden" name="assetId" value={asset.id} /><button className={styles.buttonDanger} type="submit">Delete draft</button></form></> : asset.status === "published" ? <form action="/api/admin/content/assets" method="post"><input type="hidden" name="action" value="archive" /><input type="hidden" name="assetId" value={asset.id} /><button className={styles.buttonSecondary} type="submit">Archive</button></form> : null}
          {asset.status === "published" ? <a className={styles.buttonSecondary} href={`/api/assets/${asset.id}/download`} target="_blank" rel="noreferrer">Open asset</a> : null}
        </div>
        {asset.status === "published" ? (
          <section className={styles.assignBox} aria-label={`Assign ${asset.title}`}><h3>Assign to a creator</h3>{creators.length ? <form className={styles.assignGrid} action="/api/admin/content/assets" method="post"><input type="hidden" name="action" value="assign" /><input type="hidden" name="assetId" value={asset.id} /><label className={styles.field}><span>Creator</span><select name="enrollmentId" required defaultValue=""><option value="" disabled>Select creator</option>{creators.map((creator) => <option key={creator.enrollmentId} value={creator.enrollmentId}>{creator.name} · {creator.email}</option>)}</select></label><label className={styles.field}><span>Creator note</span><input name="note" maxLength={1000} placeholder="How should this be used?" /></label><button className={styles.button} type="submit">Assign</button></form> : <p className={styles.hint}>Approve a creator before assigning assets.</p>}</section>
        ) : null}
        {asset.assignments.length ? <ul className={styles.assignments} aria-label="Current assignments">{asset.assignments.map((assignment) => <li key={assignment.id}><span><strong>{assignment.creatorName}</strong><br /><small>{assignment.state}</small></span><form action="/api/admin/content/assets" method="post"><input type="hidden" name="action" value="withdraw" /><input type="hidden" name="assignmentId" value={assignment.id} /><button className={styles.buttonDanger} type="submit">Withdraw</button></form></li>)}</ul> : null}
      </div>
    </article>
  );
}

export default async function AdminAssetsPage({ searchParams }: PageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fadmin%2Fassets");
  const staff = await getCurrentDiscordStaffMembership().catch(() => null);
  if (!staff) redirect("/account");
  const overview = await getContentAdminOverview().catch(() => null);
  const params = await searchParams;
  return (
    <main className={styles.page}><ContentLibraryHeader active="assets" staff /><div className={styles.main}>
      <header className={styles.hero}><div><p className={styles.eyebrow}>Program content</p><h1>Asset library</h1><p>Keep campaign files and approved links private, then grant access through creator assignments.</p></div>{overview ? <span className={styles.count}>{overview.assets.length} assets</span> : null}</header>
      {getSearchParamValue(params, "notice") ? <p className={styles.flash} role="status">{getSearchParamValue(params, "notice")}</p> : null}
      {getSearchParamValue(params, "error") ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{getSearchParamValue(params, "error")}</p> : null}
      {!overview ? <section className={styles.empty} role="alert"><h2>Asset data is unavailable</h2><p>No asset or assignment claim is being made. Refresh before changing the library.</p></section> : <div className={styles.grid}>
        <aside className={styles.panel}><header className={styles.panelHeader}><h2>New asset</h2><p>Upload a private file or register an approved HTTPS link.</p></header><AdminAssetCreateForm /></aside>
        <section className={styles.list} aria-label="Assets">{overview.assets.length ? overview.assets.map((asset) => <AssetCard key={asset.id} asset={asset} creators={overview.creators} />) : <div className={styles.empty}><h2>No assets yet</h2><p>Create the first draft. Creators will not see it until it is published and assigned.</p></div>}</section>
      </div>}
    </div></main>
  );
}
