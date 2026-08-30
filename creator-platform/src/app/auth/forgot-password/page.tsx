import type { Metadata } from "next";
import Link from "next/link";

import { AuthFormShell } from "@/components/auth-form-shell";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";

export const metadata: Metadata = {
  title: "Reset creator password",
};

export const dynamic = "force-dynamic";

type ForgotPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;
  const configured = hasSupabaseAuthEnv();

  return (
    <AuthFormShell
      eyebrow="Account recovery"
      title="Reset your password."
      description="Enter your account email and we will send a secure password-reset link if an account exists."
      error={
        getSearchParamValue(params, "error") ??
        (configured
          ? null
          : "Password recovery is being configured. Please check back shortly.")
      }
      notice={getSearchParamValue(params, "notice")}
      footer={<Link href="/auth/sign-in">Back to sign in</Link>}
    >
      <form className="auth-form" action="/api/auth/forgot-password" method="post">
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
        <button className="button button--ink button--large" disabled={!configured} type="submit">
          Send reset link
        </button>
      </form>
    </AuthFormShell>
  );
}
