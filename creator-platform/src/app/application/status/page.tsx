import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
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

  return {
    title: "Your application is in.",
    body: "The creator team has received your details. This page will update as review and onboarding move forward.",
  };
}

export default async function ApplicationStatusPage() {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fapplication%2Fstatus");

  const state = await getCreatorAccountState();
  if (state.nextPath === "/apply" || !state.applicationState) redirect("/apply");
  const copy = statusCopy(state.applicationState);

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
          <dl className="account-status__list">
            <div><dt>Application</dt><dd>{state.applicationState.replaceAll("_", " ")}</dd></div>
            <div><dt>Agreement</dt><dd>{state.agreementState?.replaceAll("_", " ") ?? "Not started"}</dd></div>
          </dl>
          <div className="account-status__actions">
            {state.nextPath === "/onboarding/agreement" ? (
              <Link className="button button--ink button--large" href="/onboarding/agreement">Continue to agreement</Link>
            ) : state.nextPath === "/preview/creator" ? (
              <Link className="button button--ink button--large" href="/preview/creator">Open dashboard preview</Link>
            ) : (
              <span className="account-status__next">No action is required while the creator team reviews your application.</span>
            )}
            <Link className="button button--ghost button--large" href="/account">Back to account</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
