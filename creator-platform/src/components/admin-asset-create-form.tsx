"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import styles from "@/components/content-library.module.css";

const maximumUploadBytes = 50 * 1024 * 1024;

function safeFilename(value: string) {
  const normalized = value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 160) || "asset";
}

export function AdminAssetCreateForm() {
  const router = useRouter();
  const [sourceType, setSourceType] = useState("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || sourceType !== "upload") return;

    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const payload = new FormData(form);
    const file = payload.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > maximumUploadBytes) {
      setError("Choose a file up to 50 MB.");
      setBusy(false);
      return;
    }

    const supabase = createBrowserClient(url, key);
    const claims = await supabase.auth.getClaims();
    const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
    if (!accountId) {
      router.push("/auth/sign-in?next=%2Fadmin%2Fassets");
      return;
    }
    const storagePath = `${accountId}/${crypto.randomUUID()}/${safeFilename(file.name)}`;
    const upload = await supabase.storage.from("creator-program-assets").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upload.error) {
      setError("The file could not be uploaded.");
      setBusy(false);
      return;
    }

    payload.delete("file");
    payload.set("storagePath", storagePath);
    payload.set("originalFilename", file.name.slice(0, 255));
    payload.set("mimeType", (file.type || "application/octet-stream").slice(0, 160));
    payload.set("sizeBytes", String(file.size));
    try {
      const response = await fetch(form.action, { method: "POST", body: payload, redirect: "follow" });
      if (!response.ok) throw new Error("metadata");
      const destination = new URL(response.url || "/admin/assets", window.location.origin);
      if (destination.origin !== window.location.origin) throw new Error("redirect");
      router.push(`${destination.pathname}${destination.search}${destination.hash}`);
      router.refresh();
    } catch {
      setError("The result is unknown because the server response was interrupted. Refresh the asset library before retrying.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} action="/api/admin/content/assets" method="post" encType="multipart/form-data" onSubmit={submit}>
      <input type="hidden" name="action" value="create" />
      <label className={styles.field}><span>Title</span><input name="title" minLength={2} maxLength={140} required /></label>
      <label className={styles.field}><span>Description</span><textarea name="description" maxLength={1000} /></label>
      <label className={styles.field}><span>Type</span><select name="assetKind" defaultValue="brand"><option value="brand">Brand</option><option value="template">Template</option><option value="footage">Footage</option><option value="audio">Audio</option><option value="image">Image</option><option value="document">Document</option><option value="link">Link</option><option value="other">Other</option></select></label>
      <label className={styles.field}><span>Source</span><select name="sourceType" value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="upload">Private upload</option><option value="external_url">External HTTPS link</option></select></label>
      {sourceType === "upload" ? <label className={styles.field}><span>File</span><input name="file" type="file" required /><small className={styles.hint}>Uploaded directly to private storage. Maximum 50 MB.</small></label> : <label className={styles.field}><span>External URL</span><input name="externalUrl" type="url" placeholder="https://…" maxLength={2048} required /></label>}
      {error ? <p className={`${styles.flash} ${styles.flashError}`} role="alert">{error}</p> : null}
      <button className={styles.button} type="submit" disabled={busy}>{busy ? "Uploading…" : "Create draft"}</button>
    </form>
  );
}
