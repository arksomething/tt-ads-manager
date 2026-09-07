import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Check,
  CircleAlert,
  Clock3,
  RefreshCw,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { CreatorOnboardingProgress } from "@/components/creator-onboarding";
import {
  VerificationCodeCopy,
  VerificationStatusRefresh,
} from "@/components/verification-actions";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { deriveCreatorOnboardingViewModel } from "@/lib/creator-onboarding";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  getOwnCreatorPlatformSetup,
  type CreatorPlatformSetupClaim,
} from "@/server/accounts/platform-verification";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Verify campaign accounts",
};

export const dynamic = "force-dynamic";

type AccountsOnboardingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function platformLabel(platform: CreatorPlatformSetupClaim["platform"]) {
  return platform === "TIKTOK" ? "TikTok" : "Instagram";
}

function statusDetails(claim: CreatorPlatformSetupClaim) {
  if (claim.status === "verified") {
    return { label: "Verified", tone: "ok", description: "Ownership confirmed" };
  }
  if (claim.status === "checking") {
    return { label: "Queued", tone: "waiting", description: "Waiting for a profile check" };
  }
  if (claim.status === "needs_attention") {
    return { label: "Needs attention", tone: "warn", description: "The code was not confirmed" };
  }
  if (claim.status === "revoked") {
    return { label: "Unavailable", tone: "warn", description: "Contact the creator team" };
  }
  return { label: "Add code", tone: "waiting", description: "Put the code in your public bio" };
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not checked yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function ClaimCard({ claim }: { claim: CreatorPlatformSetupClaim }) {
  const status = statusDetails(claim);
  const complete = claim.status === "verified";
  const expired = claim.codeExpired;
  const canRotate = expired || claim.status === "pending_code" || claim.status === "needs_attention";

  return (
    <article className="verification-card">
      <header className="verification-card__header">
        <div className="verification-card__identity">
          <span className="verification-card__platform" aria-hidden="true">
            {claim.platform === "INSTAGRAM_REELS" ? "IG" : "TT"}
          </span>
          <div>
            <p>{platformLabel(claim.platform)}</p>
            <h2>@{claim.handle.replace(/^@+/u, "")}</h2>
          </div>
        </div>
        <span className={`verification-status verification-status--${status.tone}`}>
          {complete ? <Check size={13} /> : claim.status === "needs_attention" ? <CircleAlert size={13} /> : <Clock3 size={13} />}
          {status.label}
        </span>
      </header>

      {complete ? (
        <div className="verification-card__complete">
          <Check aria-hidden="true" size={18} />
          <div>
            <strong>Account ownership confirmed</strong>
            <span>Verified {formatTimestamp(claim.verifiedAt)}</span>
          </div>
        </div>
      ) : (
        <>
          <ol className="verification-steps">
            <li><span>1</span><p>Open the public profile for <strong>@{claim.handle.replace(/^@+/u, "")}</strong>.</p></li>
            <li><span>2</span><p>Add this exact code anywhere in the profile bio.</p></li>
          </ol>

          <div className="verification-code" aria-label={`Verification code ${claim.bioCode}`}>
            <code>{claim.bioCode}</code>
            <VerificationCodeCopy code={claim.bioCode} />
          </div>

          <ol className="verification-steps verification-steps--continued" start={3}>
            <li><span>3</span><p>Keep the profile public, then request a check. You can remove the code after verification.</p></li>
          </ol>

          {claim.status === "needs_attention" || expired ? (
            <p className="verification-card__warning" role="status">
              {expired
                ? "This bio code expired. Replace it before requesting another check."
                : claim.creatorMessage ?? "The last review could not confirm this code. Check the handle and bio, then queue another review."}
            </p>
          ) : null}

          <div className="verification-card__actions">
            {claim.status === "checking" ? (
              <VerificationStatusRefresh />
            ) : (
              <form action="/api/onboarding/accounts/check" method="post">
                <input name="claimId" type="hidden" value={claim.id} />
                <button className="button button--ink" disabled={expired} type="submit">
                  <RefreshCw aria-hidden="true" size={14} />
                  Check bio
                </button>
              </form>
            )}
            {canRotate ? (
              <form action="/api/onboarding/accounts/code" method="post">
                <input name="claimId" type="hidden" value={claim.id} />
                <button className="application-edit-button" type="submit">Replace code</button>
              </form>
            ) : null}
          </div>
        </>
      )}

      <footer className="verification-card__footer">
        <span>{status.description}</span>
        <span>{claim.status === "checking" ? "An active check keeps its queue position" : `Last check: ${formatTimestamp(claim.lastCheckedAt ?? claim.lastCheckRequestedAt)}`}</span>
      </footer>
    </article>
  );
}

export default async function AccountsOnboardingPage({ searchParams }: AccountsOnboardingPageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fonboarding%2Faccounts");

  const state = await getCreatorAccountState();
  if (state.nextPath === "/apply") redirect("/apply");
  if (state.nextPath === "/application/status") redirect("/application/status");

  const [claims, params] = await Promise.all([
    getOwnCreatorPlatformSetup(),
    searchParams,
  ]);
  const verifiedCount = claims.filter((claim) => claim.status === "verified").length;
  const complete = claims.length > 0 && verifiedCount === claims.length;
  const notice = getSearchParamValue(params, "notice");
  const error = getSearchParamValue(params, "error");
  const onboarding = deriveCreatorOnboardingViewModel({
    nextPath: state.nextPath,
    stateAvailable: Boolean(state.nextPath),
    applicationStatus: state.applicationState,
    agreementStatus: state.agreementState,
  });

  return (
    <main className="account-page verification-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>

      <section className="verification-layout">
        <div className="verification-progress">
          <CreatorOnboardingProgress steps={onboarding.steps} />
        </div>
        <div className="verification-intro">
          <p className="eyebrow">Campaign accounts</p>
          <h1>Verify the accounts you post from.</h1>
          <p>
            A short bio code proves you control each public account. Handles can change; verified platform IDs keep posts attached to the right creator.
          </p>
          <dl>
            <div><dt>Accounts</dt><dd>{claims.length || "Not prepared"}</dd></div>
            <div><dt>Verified</dt><dd>{verifiedCount} of {claims.length}</dd></div>
          </dl>
        </div>

        <section className="verification-workspace" aria-labelledby="verification-workspace-title">
          <header>
            <div>
              <p className="eyebrow">Ownership check</p>
              <h2 id="verification-workspace-title">Complete every listed account</h2>
            </div>
            <span>{verifiedCount}/{claims.length}</span>
          </header>

          {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}
          {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}

          {claims.length ? (
            <div className="verification-list">
              {claims.map((claim) => <ClaimCard claim={claim} key={claim.id} />)}
            </div>
          ) : (
            <div className="verification-empty">
              <CircleAlert aria-hidden="true" size={20} />
              <div>
                <strong>No campaign accounts are ready yet.</strong>
                <p>Your approved application handles will appear here automatically. Contact the creator team if this remains empty.</p>
              </div>
            </div>
          )}

          <footer className="verification-workspace__footer">
            {complete ? (
              <Link className="button button--ink button--large" href="/onboarding/agreement">Continue to agreement</Link>
            ) : (
              <span>Agreement access unlocks after every listed account is verified.</span>
            )}
            <Link className="button button--ghost" href="/account">Back to account</Link>
          </footer>
        </section>
      </section>
    </main>
  );
}
