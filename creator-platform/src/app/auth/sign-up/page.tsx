import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFormShell } from "@/components/auth-form-shell";
import { getSearchParamValue, sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Create creator account",
};

export const dynamic = "force-dynamic";

type SignUpPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(getSearchParamValue(params, "next"), "/apply");
  const configured = hasSupabaseAuthEnv();

  if (configured && (await getCurrentAccount())) {
    redirect(nextPath);
  }

  const queryError = getSearchParamValue(params, "error");

  return (
    <AuthFormShell
      eyebrow="Start here"
      title="Create your creator account."
      description="Your account keeps your application, onboarding, agreement, and creator workspace connected to one verified email."
      error={
        queryError ??
        (configured
          ? null
          : "Account creation is being configured. Please check back shortly.")
      }
      footer={
        <p>
          Already have an account?{" "}
          <Link href={`/auth/sign-in?next=${encodeURIComponent(nextPath)}`}>
            Sign in
          </Link>
        </p>
      }
    >
      <form className="auth-form" action="/api/auth/sign-up" method="post">
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
            autoComplete="new-password"
            minLength={10}
            name="password"
            placeholder="At least 10 characters"
            required
            type="password"
          />
        </label>
        <label>
          <span>Confirm password</span>
          <input
            autoComplete="new-password"
            minLength={10}
            name="passwordConfirm"
            placeholder="Enter it again"
            required
            type="password"
          />
        </label>
        <button className="button button--ink button--large" disabled={!configured} type="submit">
          Create account
        </button>
      </form>
    </AuthFormShell>
  );
}
