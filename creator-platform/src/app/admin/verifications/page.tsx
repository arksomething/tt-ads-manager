import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, SearchCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCreatorPlatformVerificationQueue } from "@/server/accounts/platform-verification";
import { getCurrentDiscordStaffMembership } from "@/server/admin/discord";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = { title: "Campaign-account verification" };
export const dynamic = "force-dynamic";

type VerificationAdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function date(value: string | null) {
  if (!value) return "Not requested";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not requested";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed) + " UTC";
}

export default async function VerificationAdminPage({ searchParams }: VerificationAdminPageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fadmin%2Fverifications");
  const staff = await getCurrentDiscordStaffMembership().catch(() => undefined);
  if (staff === undefined) {
    return (
      <main className="discord-admin-page verification-admin-page">
        <header className="discord-admin-header">
          <div>
            <Link className="discord-admin-back" href="/admin" aria-label="Back to operations"><ArrowLeft size={16} /></Link>
            <Link href="/admin" className="wordmark"><BrandMark /><span>Creator operations</span></Link>
          </div>
          <span className="discord-admin-readonly">Access unavailable</span>
        </header>
        <section className="verification-admin-shell">
          <section className="verification-admin-empty" role="alert">
            <h1>Verification operations are unavailable</h1>
            <p>The staff access check could not be loaded. No verification queue or account state is being claimed. Refresh before reviewing a creator.</p>
          </section>
        </section>
      </main>
    );
  }
  if (!staff) redirect("/account");

  const [queueResult, params] = await Promise.all([
    getCreatorPlatformVerificationQueue()
      .then((queue) => ({ queue, failed: false as const }))
      .catch(() => ({ queue: [], failed: true as const })),
    searchParams,
  ]);
  const notice = getSearchParamValue(params, "notice");
  const error = getSearchParamValue(params, "error");

  return (
    <main className="discord-admin-page verification-admin-page">
      <header className="discord-admin-header">
        <div>
          <Link className="discord-admin-back" href="/admin" aria-label="Back to operations"><ArrowLeft size={16} /></Link>
          <Link href="/admin" className="wordmark"><BrandMark /><span>Creator operations</span></Link>
        </div>
        <span className="discord-admin-readonly">{label(staff.role)} access</span>
      </header>

      <section className="verification-admin-shell">
        <header className="verification-admin-title">
          <div>
            <p className="eyebrow">Onboarding operations</p>
            <h1>Campaign-account verification</h1>
            <p>Confirm the public bio code and stable native platform ID. Every decision is retained as an audit event.</p>
          </div>
          <Link className="button button--ghost" href="/admin/discord">Discord health</Link>
        </header>

        {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}
        {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}

        {queueResult.failed ? (
          <section className="verification-admin-empty" role="alert">
            <h2>Verification queue is unavailable</h2>
            <p>No campaign-account count or review state is being claimed. Refresh before reviewing a creator.</p>
          </section>
        ) : queueResult.queue.length ? (
          <div className="verification-review-list">
            {queueResult.queue.map((item) => (
              <article className="verification-review-card" key={item.id}>
                <header>
                  <div>
                    <p>{item.creatorName} · {item.creatorEmail}</p>
                    <h2>{item.platform === "TIKTOK" ? "TikTok" : "Instagram"} · @{item.handle.replace(/^@+/u, "")}</h2>
                  </div>
                  <span className={`verification-status verification-status--${item.status === "verified" ? "ok" : item.status === "needs_attention" ? "warn" : "waiting"}`}>
                    {item.status === "verified" ? <CheckCircle2 size={13} /> : <SearchCheck size={13} />}
                    {label(item.status)}
                  </span>
                </header>

                <dl>
                  <div><dt>Expected bio code</dt><dd><code>{item.bioCode}</code></dd></div>
                  <div><dt>Requested</dt><dd>{date(item.lastCheckRequestedAt)}</dd></div>
                  <div><dt>Last checked</dt><dd>{date(item.lastCheckedAt)}</dd></div>
                </dl>

                {item.status !== "verified" ? (
                  <form className="verification-review-form" action="/api/admin/verifications/review" method="post">
                    <input name="claimId" type="hidden" value={item.id} />
                    <label>
                      <span>Stable native account ID</span>
                      <input name="nativeAccountId" placeholder="Platform account ID" maxLength={191} />
                    </label>
                    <label>
                      <span>Evidence reference</span>
                      <input name="evidenceReference" placeholder="Profile URL or internal evidence reference" maxLength={2000} />
                    </label>
                    <label className="verification-review-form__wide">
                      <span>Creator-facing correction note</span>
                      <textarea name="note" placeholder="Only required when marking needs attention" maxLength={500} rows={2} />
                    </label>
                    <div className="verification-review-form__actions">
                      <button className="button button--ghost" name="decision" value="reject" type="submit">Needs attention</button>
                      <button className="button button--ink" name="decision" value="approve" type="submit">Verify account</button>
                    </div>
                  </form>
                ) : (
                  <p className="verification-review-card__complete">Verified {date(item.verifiedAt)} · native ID {item.nativeAccountId}</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <section className="verification-admin-empty">
            <CheckCircle2 aria-hidden="true" size={22} />
            <h2>No campaign accounts are waiting.</h2>
            <p>Approved application handles will appear here automatically.</p>
          </section>
        )}
      </section>
    </main>
  );
}
