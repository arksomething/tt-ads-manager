import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApplicationPreviewForm } from "@/components/application-preview-form";
import { BrandMark } from "@/components/brand-mark";
import { CreatorOnboardingProgress } from "@/components/creator-onboarding";
import { sanitizeNextPath } from "@/lib/auth-navigation";
import { deriveCreatorOnboardingViewModel } from "@/lib/creator-onboarding";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getOwnCreatorApplication } from "@/server/accounts/application";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Creator application",
  description: "Apply to the GoTall creator program from your verified creator account.",
};

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  if (!hasSupabaseAuthEnv()) {
    redirect("/auth/sign-up?next=%2Fapply");
  }

  const account = await getCurrentAccount();
  if (!account) {
    redirect("/auth/sign-up?next=%2Fapply");
  }

  const accountState = await getCreatorAccountState();
  const revising = accountState.applicationState === "changes_requested";
  if (accountState.nextPath !== "/apply" && !revising) {
    redirect(sanitizeNextPath(accountState.nextPath, "/account"));
  }

  const existingApplication = revising
    ? await getOwnCreatorApplication().catch(() => null)
    : null;

  if (revising && !existingApplication) {
    redirect("/application/status");
  }
  const onboarding = deriveCreatorOnboardingViewModel({
    nextPath: accountState.nextPath,
    stateAvailable: Boolean(accountState.nextPath),
    applicationStatus: accountState.applicationState,
    agreementStatus: accountState.agreementState,
    decisionMessage: existingApplication?.decisionMessage,
  });

  return (
    <main className="application-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>
      <div className="application-onboarding-progress">
        <CreatorOnboardingProgress steps={onboarding.steps} />
      </div>
      <section className="application-layout">
        <div className="application-intro">
          <p className="eyebrow">{revising ? "Application revision" : "Creator application"}</p>
          <h1>{revising ? "Update the requested details." : "Tell us where you create."}</h1>
          <p>{revising
            ? "The creator team requested an update. Review their message on your status page, edit the submitted details, and resubmit for a new review."
            : "Share your name, phone number, Discord username, and every TikTok or Instagram handle you use. That is all we need to start."}</p>
          <div className="application-intro__facts"><span>About 1 minute</span><span>TikTok + Instagram</span><span>One standard deal</span></div>
        </div>
        <ApplicationPreviewForm
          accountEmail={account.email}
          mode={revising ? "revise" : "apply"}
          initialApplication={existingApplication ? {
            name: existingApplication.name,
            phoneNumber: existingApplication.phoneNumber,
            discordUsername: existingApplication.discordUsername,
            accounts: existingApplication.accounts,
          } : undefined}
        />
      </section>
    </main>
  );
}
