"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type {
  ContentPlatform,
  CreatorPlatformAccountOption,
} from "@/server/accounts/content";

import styles from "./creator-workspace.module.css";

type ContentSubmissionFormProps = {
  canSubmit: boolean;
  platformAccounts: CreatorPlatformAccountOption[];
};

export function ContentSubmissionForm({
  canSubmit,
  platformAccounts,
}: ContentSubmissionFormProps) {
  const router = useRouter();
  const [platform, setPlatform] = useState<ContentPlatform>("TIKTOK");
  const [platformAccountId, setPlatformAccountId] = useState("");
  const [url, setUrl] = useState("");
  const [nativePostId, setNativePostId] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const matchingAccounts = useMemo(
    () => platformAccounts.filter((account) => account.platform === platform),
    [platform, platformAccounts],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/content-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          url,
          ...(platformAccountId ? { platformAccountId } : {}),
          ...(nativePostId.trim() ? { nativePostId } : {}),
          ...(note.trim() ? { note } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "We could not save the post.");

      setUrl("");
      setNativePostId("");
      setNote("");
      setNotice("Post submitted. It is waiting for attribution review.");
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We could not save the post.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Platform</span>
          <select
            value={platform}
            onChange={(event) => {
              setPlatform(event.target.value as ContentPlatform);
              setPlatformAccountId("");
            }}
            disabled={!canSubmit || pending}
          >
            <option value="TIKTOK">TikTok</option>
            <option value="INSTAGRAM_REELS">Instagram Reels</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Verified creator account <em>optional</em></span>
          <select
            value={platformAccountId}
            onChange={(event) => setPlatformAccountId(event.target.value)}
            disabled={!canSubmit || pending || matchingAccounts.length === 0}
          >
            <option value="">Match this later</option>
            {matchingAccounts.map((account) => (
              <option key={account.id} value={account.id}>@{account.handle}</option>
            ))}
          </select>
        </label>
      </div>

      <label className={styles.field}>
        <span>Published post URL</span>
        <input
          type="url"
          inputMode="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={platform === "TIKTOK"
            ? "https://www.tiktok.com/@creator/video/..."
            : "https://www.instagram.com/reel/..."}
          disabled={!canSubmit || pending}
        />
      </label>

      <label className={styles.field}>
        <span>Native post ID <em>optional</em></span>
        <input
          value={nativePostId}
          onChange={(event) => setNativePostId(event.target.value)}
          placeholder="Only add this if you already have it"
          disabled={!canSubmit || pending}
        />
      </label>

      <label className={styles.field}>
        <span>Note <em>optional</em></span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Anything the creator team should know about this post"
          disabled={!canSubmit || pending}
        />
      </label>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {!canSubmit ? (
        <p className={styles.mutedNotice}>
          Content submission unlocks when your creator enrollment becomes active.
        </p>
      ) : null}

      <button className={styles.primaryButton} type="submit" disabled={!canSubmit || pending}>
        {pending ? "Submitting…" : "Submit published post"}
      </button>
    </form>
  );
}
