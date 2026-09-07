import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

import styles from "./creator-workspace.module.css";

type CreatorWorkspaceShellProps = {
  active: "content" | "earnings";
  eyebrow: string;
  title: string;
  description: string;
  accountEmail: string | null;
  children: ReactNode;
};

export function CreatorWorkspaceShell({
  active,
  eyebrow,
  title,
  description,
  accountEmail,
  children,
}: CreatorWorkspaceShellProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/account" className={styles.wordmark}>
            <BrandMark />
            <span>Creator program</span>
          </Link>
          <div className={styles.headerAccount}>
            {accountEmail ? <span>{accountEmail}</span> : null}
            <form action="/api/auth/sign-out" method="post">
              <input type="hidden" name="next" value="/" />
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Creator account navigation">
          <Link href="/account">Overview</Link>
          <Link
            href="/account/content"
            aria-current={active === "content" ? "page" : undefined}
          >
            Content
          </Link>
          <Link
            href="/account/earnings"
            aria-current={active === "earnings" ? "page" : undefined}
          >
            Earnings
          </Link>
          <Link href="/account/scripts">Scripts</Link>
          <Link href="/account/assets">Assets</Link>
          <Link href="/account/discord">Discord</Link>
        </aside>

        <div className={styles.mainColumn}>
          <section className={styles.titleBlock}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </section>
          {children}
        </div>
      </div>
    </main>
  );
}
