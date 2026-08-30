import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

type AuthFormShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  error?: string | null;
  notice?: string | null;
};

export function AuthFormShell({
  eyebrow,
  title,
  description,
  children,
  footer,
  error,
  notice,
}: AuthFormShellProps) {
  return (
    <main className="auth-page">
      <header className="auth-header">
        <Link href="/" className="wordmark">
          <BrandMark />
          <span>Creator program</span>
        </Link>
        <span>Creator account</span>
      </header>

      <section className="auth-layout">
        <div className="auth-intro">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>

        <div className="auth-card">
          {error ? (
            <p className="auth-message auth-message--error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="auth-message auth-message--notice" role="status">
              {notice}
            </p>
          ) : null}
          {children}
          <div className="auth-card__footer">{footer}</div>
        </div>
      </section>
    </main>
  );
}
