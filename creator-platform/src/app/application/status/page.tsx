import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { CreatorOnboardingHome } from "@/components/creator-onboarding";
import { SubmittedApplicationDetails } from "@/components/submitted-application-details";
import { getSignWellReadiness } from "@/lib/agreements/signwell";
import { deriveCreatorOnboardingViewModel } from "@/lib/creator-onboarding";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getOwnCreatorApplication } from "@/server/accounts/application";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Application status",
};

export const dynamic = "force-dynamic";

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
  const pageError = stateUnavailable
    ? application
      ? "Your application is saved, but its current review state is temporarily unavailable."
      : "Your application details and current review state are temporarily unavailable."
    : applicationUnavailable
      ? "Your review state loaded, but the submitted application details are temporarily unavailable."
      : null;
  const onboarding = deriveCreatorOnboardingViewModel({
    nextPath: state?.nextPath,
    stateAvailable: !stateUnavailable,
    applicationStatus,
    agreementStatus: state?.agreementState,
    decisionMessage: application?.decisionMessage,
    agreementReadyToSend: getSignWellReadiness().readyToSend,
  });
  const firstName = application?.name.split(/\s+/u)[0];

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>

      <CreatorOnboardingHome error={pageError} firstName={firstName} model={onboarding}>
        {application ? (
          <div id="submitted-application">
            <SubmittedApplicationDetails
              application={application}
              titleId="status-submitted-details-title"
            />
          </div>
        ) : null}
      </CreatorOnboardingHome>
    </main>
  );
}
