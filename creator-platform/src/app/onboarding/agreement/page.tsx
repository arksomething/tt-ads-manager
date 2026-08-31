import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Creator agreement",
};

export const dynamic = "force-dynamic";

export default async function AgreementPage() {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fonboarding%2Fagreement");

  const state = await getCreatorAccountState();
  if (state.nextPath === "/apply") redirect("/apply");
  if (state.nextPath === "/application/status") redirect("/application/status");

  const complete = state.agreementState === "completed";

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>

      <section className="account-layout">
        <div>
          <p className="eyebrow">Creator agreement</p>
          <h1>{complete ? "Your agreement is complete." : "Your agreement is the next gate."}</h1>
          <p>
            {complete
              ? "Your verified agreement state is attached to this creator account."
              : "The exact agreement is tied to the deal version assigned when your application is approved. The creator team will make it available here."}
          </p>
        </div>

        <section className="account-status" aria-labelledby="agreement-status-title">
          <p className="eyebrow">Agreement status</p>
          <h2 id="agreement-status-title">{complete ? "Completed" : "Preparing agreement"}</h2>
          <p className="account-status__note">
            Completion comes from verified agreement evidence. Returning from a signing page alone never unlocks the creator workspace.
          </p>
          <div className="account-status__actions">
            {complete ? (
              <Link className="button button--ink button--large" href="/account">Open your creator account</Link>
            ) : (
              <span className="account-status__next">No signing provider has been exposed in this account flow yet.</span>
            )}
            <Link className="button button--ghost button--large" href="/account">Back to account</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
