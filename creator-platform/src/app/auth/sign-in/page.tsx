import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFormShell } from "@/components/auth-form-shell";
import { getSearchParamValue, sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Creator sign in",
};

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(getSearchParamValue(params, "next"));
  const configured = hasSupabaseAuthEnv();

  if (configured && (await getCurrentAccount())) {
    redirect(nextPath);
  }

  const queryError = getSearchParamValue(params, "error");
  const notice = getSearchParamValue(params, "notice");

  return (
    <AuthFormShell
      eyebrow="Welcome back"
      title="Sign in to your account."
      description="Continue your application, finish onboarding, or open your creator workspace."
      error={
        queryError ??
        (configured ? null : "Sign in is being configured. Please check back shortly.")
      }
      notice={notice}
      footer={
        <div className="auth-footer-links">
          <p>
            New here?{" "}
            <Link href={`/auth/sign-up?next=${encodeURIComponent(nextPath)}`}>
              Create an account
            </Link>
          </p>
          <Link href="/auth/forgot-password">Forgot password?</Link>
        </div>
      }
    >
      <form className="auth-form" action="/api/auth/sign-in" method="post">
        <input type="hidden" name="next" value={nextPath} />
        <label>
          <span>Email address</span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            autoComplete="current-password"
            minLength={10}
            name="password"
            placeholder="Your password"
            required
            type="password"
          />
        </label>
        <button className="button button--ink button--large" disabled={!configured} type="submit">
          Sign in
        </button>
      </form>
    </AuthFormShell>
  );
}
