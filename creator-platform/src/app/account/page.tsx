import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Creator account",
};

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function stateLabel(value: string | null, fallback: string) {
  return value
    ? value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase())
    : fallback;
}

function NextAccountAction({ nextPath }: { nextPath: string | null | undefined }) {
  if (nextPath === "/apply" || !nextPath) {
    return <Link className="button button--ink button--large" href="/apply">Continue application</Link>;
  }

  if (nextPath === "/application/status") {
    return <Link className="button button--ink button--large" href="/application/status">View application status</Link>;
  }

  if (nextPath === "/onboarding/agreement") {
    return <Link className="button button--ink button--large" href="/onboarding/agreement">Continue to agreement</Link>;
  }

  if (nextPath === "/preview/creator") {
    return <Link className="button button--ink button--large" href="/preview/creator">Open dashboard preview</Link>;
  }

  return <span className="account-status__next">The creator team is preparing your next step.</span>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  if (!hasSupabaseAuthEnv()) {
    redirect("/auth/sign-in");
  }

  const account = await getCurrentAccount();
  if (!account) {
    redirect("/auth/sign-in?next=%2Faccount");
  }

  const params = await searchParams;
  let accountState = null;
  let stateError = null;

  try {
    accountState = await getCreatorAccountState();
  } catch {
    stateError = "Your account is active, but its onboarding state is temporarily unavailable.";
  }

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <form action="/api/auth/sign-out" method="post">
          <input type="hidden" name="next" value="/" />
          <button className="application-edit-button" type="submit">Sign out</button>
        </form>
      </header>

      <section className="account-layout">
        <div>
          <p className="eyebrow">Creator account</p>
          <h1>Your next step stays clear.</h1>
          <p>{account.email ?? "Verified creator account"}</p>
        </div>

        <section className="account-status" aria-labelledby="account-status-title">
          <p className="eyebrow">Account status</p>
          <h2 id="account-status-title">Your creator journey</h2>
          {getSearchParamValue(params, "notice") ? (
            <p className="auth-message auth-message--notice" role="status">
              {getSearchParamValue(params, "notice")}
            </p>
          ) : null}
          {stateError ? <p className="auth-message auth-message--error" role="alert">{stateError}</p> : null}

          <dl className="account-status__list">
            <div><dt>Profile</dt><dd>{stateLabel(accountState?.profileState ?? null, "Account created")}</dd></div>
            <div><dt>Application</dt><dd>{stateLabel(accountState?.applicationState ?? null, "Not submitted")}</dd></div>
            <div><dt>Agreement</dt><dd>{stateLabel(accountState?.agreementState ?? null, "Not started")}</dd></div>
          </dl>

          <div className="account-status__actions">
            <NextAccountAction nextPath={accountState?.nextPath} />
            <Link className="button button--ghost button--large" href="/">Creator program</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
