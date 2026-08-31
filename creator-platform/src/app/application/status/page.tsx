import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { SubmittedApplicationDetails } from "@/components/submitted-application-details";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getOwnCreatorApplication } from "@/server/accounts/application";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Application status",
};

export const dynamic = "force-dynamic";

function statusCopy(status: string | null) {
  if (status === "approved") {
    return {
      title: "Your application is approved.",
      body: "Your exact default-deal version is assigned during approval. The agreement step must be completed before the creator workspace unlocks.",
    };
  }

  if (status === "rejected") {
    return {
      title: "The creator team has finished its review.",
      body: "Your account keeps the application decision and any next steps in one place. Contact the creator team if you need clarification.",
    };
  }

  if (status === "in_review") {
    return {
      title: "Your application is being reviewed.",
      body: "The creator team is checking your submitted profile and creator accounts. You do not need to submit it again.",
    };
  }

  if (status === "submitted") {
    return {
      title: "Your application is in.",
      body: "The creator team has received your details. This page will update as review and onboarding move forward.",
    };
  }

  if (status === "withdrawn") {
    return {
      title: "Your application was withdrawn.",
      body: "Your submitted details remain attached to this account. Contact the creator team if you need help with the decision.",
    };
  }

  return {
    title: "Your application status is temporarily unavailable.",
    body: "Your creator account remains active. Refresh this page before taking another onboarding action.",
  };
}

function stateLabel(value: string | null | undefined, fallback: string) {
  return value
    ? value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase())
    : fallback;
}

function NextStatusAction({
  nextPath,
  unavailable,
}: {
  nextPath: string | null | undefined;
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <span className="account-status__next">
        We cannot determine your next action right now. Refresh this page before continuing.
      </span>
    );
  }

  if (nextPath === "/onboarding/agreement") {
    return (
      <Link className="button button--ink button--large" href="/onboarding/agreement">
        Continue to agreement
      </Link>
    );
  }

  if (nextPath === "/account") {
    return <span className="account-status__next">Your creator account is active.</span>;
  }

  return (
    <span className="account-status__next">
      No action is required while the creator team reviews your application.
    </span>
  );
}

export default async function ApplicationStatusPage() {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fapplication%2Fstatus");

  const [accountStateResult, applicationResult] = await Promise.allSettled([
    getCreatorAccountState(),
    getOwnCreatorApplication(),
  ]);
  const state = accountStateResult.status === "fulfilled"
    ? accountStateResult.value
    : null;
  const application = applicationResult.status === "fulfilled"
    ? applicationResult.value
    : null;
  const stateUnavailable =
    accountStateResult.status === "rejected" || !state?.nextPath;
  const applicationUnavailable = applicationResult.status === "rejected";

  if (
    !stateUnavailable &&
    !applicationUnavailable &&
    state.nextPath === "/apply" &&
    !application
  ) {
    redirect("/apply");
  }

  const applicationStatus = application?.status ?? state?.applicationState ?? null;
  const copy = statusCopy(applicationStatus);
  const pageError = stateUnavailable
    ? application
      ? "Your application is saved, but its current review state is temporarily unavailable."
      : "Your application details and current review state are temporarily unavailable."
    : applicationUnavailable
      ? "Your review state loaded, but the submitted application details are temporarily unavailable."
      : null;

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>

      <section className="account-layout">
        <div>
          <p className="eyebrow">Application status</p>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </div>

        <section className="account-status" aria-labelledby="review-status-title">
          <p className="eyebrow">Current position</p>
          <h2 id="review-status-title">Review and onboarding</h2>
          {pageError ? (
            <p className="auth-message auth-message--error" role="alert">{pageError}</p>
          ) : null}
          <dl className="account-status__list">
            <div>
              <dt>Application</dt>
              <dd>{stateLabel(applicationStatus, "Temporarily unavailable")}</dd>
            </div>
            <div>
              <dt>Agreement</dt>
              <dd>{stateLabel(state?.agreementState, "Not started")}</dd>
            </div>
          </dl>

          {application ? (
            <SubmittedApplicationDetails
              application={application}
              titleId="status-submitted-details-title"
            />
          ) : null}

          <div className="account-status__actions">
            <NextStatusAction
              nextPath={state?.nextPath}
              unavailable={stateUnavailable}
            />
            <Link className="button button--ghost button--large" href="/account">Back to account</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
