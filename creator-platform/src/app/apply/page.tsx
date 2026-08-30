import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApplicationPreviewForm } from "@/components/application-preview-form";
import { BrandMark } from "@/components/brand-mark";
import { sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
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
  if (accountState.nextPath !== "/apply") {
    redirect(sanitizeNextPath(accountState.nextPath, "/account"));
  }

  return (
    <main className="application-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>
      <section className="application-layout">
        <div className="application-intro">
          <p className="eyebrow">Creator application</p>
          <h1>Tell us where you create.</h1>
          <p>Share your name, phone number, Discord username, and every TikTok or Instagram handle you use. That is all we need to start.</p>
          <div className="application-intro__facts"><span>About 1 minute</span><span>TikTok + Instagram</span><span>One standard deal</span></div>
        </div>
        <ApplicationPreviewForm accountEmail={account.email} />
      </section>
    </main>
  );
}
