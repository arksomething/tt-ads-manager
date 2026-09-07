import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { CreatorCommandCenter } from "@/components/creator-command-center";
import { CreatorOnboardingHome } from "@/components/creator-onboarding";
import { getSignWellReadiness } from "@/lib/agreements/signwell";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { deriveCreatorOnboardingViewModel } from "@/lib/creator-onboarding";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getOwnCreatorApplication } from "@/server/accounts/application";
import {
  buildCreatorHomeOverview,
  deriveCreatorNextAction,
  getCreatorHomeOverview,
} from "@/server/accounts/home";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentDiscordStaffMembership } from "@/server/admin/discord";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Creator account",
};

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  if (!hasSupabaseAuthEnv()) {
    redirect("/auth/sign-in");
  }

  const account = await getCurrentAccount();
  if (!account) {
    redirect("/auth/sign-in?next=%2Faccount");
  }

  const params = await searchParams;
  const [accountStateResult, applicationResult, staffResult] = await Promise.allSettled([
    getCreatorAccountState(),
    getOwnCreatorApplication(),
    getCurrentDiscordStaffMembership(),
  ]);
  const accountState = accountStateResult.status === "fulfilled"
    ? accountStateResult.value
    : null;
  const application = applicationResult.status === "fulfilled"
    ? applicationResult.value
    : null;
  const staff = staffResult.status === "fulfilled" ? staffResult.value : null;
  let home = buildCreatorHomeOverview({
    content: null,
    earnings: null,
    library: null,
    updates: null,
  });
  if (accountState?.nextPath === "/account") {
    const [homeResult] = await Promise.allSettled([getCreatorHomeOverview(account.id)]);
    home = homeResult.status === "fulfilled" ? homeResult.value : home;
  }
  const stateUnavailable =
    accountStateResult.status === "rejected" || !accountState?.nextPath;
  const accountError = stateUnavailable
    ? "Your account is safe, but its onboarding state is temporarily unavailable."
    : applicationResult.status === "rejected"
      ? "Your account status loaded, but the submitted application details are temporarily unavailable."
      : null;
  const firstName = application?.name.split(/\s+/u)[0];
  const notice = getSearchParamValue(params, "notice");
  const onboarding = deriveCreatorOnboardingViewModel({
    nextPath: accountState?.nextPath,
    stateAvailable: !stateUnavailable,
    applicationStatus: application?.status ?? accountState?.applicationState,
    agreementStatus: accountState?.agreementState,
    decisionMessage: application?.decisionMessage,
    agreementReadyToSend: getSignWellReadiness().readyToSend,
  });
  const nextAction = deriveCreatorNextAction({
    accountNextPath: accountState?.nextPath,
    accountStateAvailable: !stateUnavailable,
    libraryAvailable: home.availability.library,
    scripts: home.scripts,
  });

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <div className="application-header__actions">
          {staff ? <Link className="application-edit-button" href="/admin">Creator operations</Link> : null}
          <form action="/api/auth/sign-out" method="post">
            <input type="hidden" name="next" value="/" />
            <button className="application-edit-button" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {accountState?.nextPath !== "/account" ? (
        <CreatorOnboardingHome
          error={accountError}
          firstName={firstName}
          model={onboarding}
          notice={notice}
        />
      ) : (
      <section className="account-layout">
        <div>
          <p className="eyebrow">Creator account</p>
          <h1>{firstName ? `Welcome, ${firstName}.` : "Your creator account."}</h1>
          <p>{account.email ?? "Verified creator account"}</p>
        </div>

        <section className="account-status" aria-labelledby="account-status-title">
          <p className="eyebrow">Creator workspace</p>
          <h2 id="account-status-title">Ready to create</h2>
          {notice ? (
            <p className="auth-message auth-message--notice" role="status">
              {notice}
            </p>
          ) : null}
          {accountError ? <p className="auth-message auth-message--error" role="alert">{accountError}</p> : null}
          <p className="account-status__note">Submit posts, review attributed content and earnings, and use the scripts and assets assigned to you.</p>

          <section className="account-workspace" aria-labelledby="account-workspace-title">
            <div>
              <h3 id="account-workspace-title">Program tools</h3>
            </div>
            <nav aria-label="Creator workspace">
              <Link href="/account/content">Content</Link>
              <Link href="/account/earnings">Earnings</Link>
              <Link href="/account/scripts">Scripts</Link>
              <Link href="/account/assets">Assets</Link>
            </nav>
          </section>

          <section className="account-integration" aria-labelledby="account-discord-title">
            <div>
              <p className="eyebrow">Integration</p>
              <h3 id="account-discord-title">Discord and reminders</h3>
              <p>Verify your Discord identity, control direct-message consent, and inspect real delivery history.</p>
            </div>
            <Link className="button button--ghost" href="/account/discord">Manage Discord</Link>
          </section>

          {staff ? (
            <section className="account-integration" aria-labelledby="account-discord-operations-title">
              <div>
                <p className="eyebrow">Staff operations</p>
                <h3 id="account-discord-operations-title">Creator operations</h3>
                <p>Review applications, verify campaign accounts, manage content, inspect creator activity, and operate finance and Discord workflows.</p>
              </div>
              <Link className="button button--ghost" href="/admin">Open operations</Link>
            </section>
          ) : null}

          <div className="account-status__actions">
            <p className="account-status__note">The command center below uses recorded account data only.</p>
            <Link className="button button--ghost button--large" href="/">Creator program</Link>
          </div>
        </section>

        <CreatorCommandCenter overview={home} nextAction={nextAction} />
      </section>
      )}
    </main>
  );
}
