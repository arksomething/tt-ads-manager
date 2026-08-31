import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFormShell } from "@/components/auth-form-shell";
import { getSearchParamValue, sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Confirm your email",
};

export const dynamic = "force-dynamic";

type CheckEmailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CheckEmailPage({ searchParams }: CheckEmailPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(getSearchParamValue(params, "next"), "/apply");
  const configured = hasSupabaseAuthEnv();

  if (configured && (await getCurrentAccount())) {
    redirect(nextPath);
  }

  return (
    <AuthFormShell
      eyebrow="One quick step"
      title="Confirm your email."
      description="Open the message from GoTall and use the confirmation link. That securely connects this browser to your creator account."
      error={
        getSearchParamValue(params, "error") ??
        (configured ? null : "Email confirmation is being configured. Please check back shortly.")
      }
      notice={
        getSearchParamValue(params, "notice") ??
        "We sent a confirmation link if that address can be registered."
      }
      footer={
        <div className="auth-footer-links">
          <Link href={`/auth/sign-in?next=${encodeURIComponent(nextPath)}`}>Already confirmed? Sign in</Link>
          <Link href={`/auth/sign-up?next=${encodeURIComponent(nextPath)}`}>Use another email</Link>
        </div>
      }
    >
      <form className="auth-form" action="/api/auth/resend-confirmation" method="post">
        <input type="hidden" name="next" value={nextPath} />
        <label>
          <span>Need a new link?</span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </label>
        <button className="button button--ink button--large" disabled={!configured} type="submit">
          Resend confirmation email
        </button>
      </form>
    </AuthFormShell>
  );
}
