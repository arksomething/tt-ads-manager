import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import styles from "@/components/content-library.module.css";

type ContentLibrarySection = "scripts" | "assets";

export function ContentLibraryHeader({
  staff = false,
  active,
}: {
  staff?: boolean;
  active: ContentLibrarySection;
}) {
  return (
    <header className={styles.header}>
      <Link href={staff ? "/admin" : "/account"} className={styles.wordmark}>
        <BrandMark />
        <span>{staff ? "Creator operations" : "Creator program"}</span>
      </Link>
      <nav aria-label="Content library">
        {staff ? <Link href="/admin">Home</Link> : null}
        <Link
          aria-current={active === "scripts" ? "page" : undefined}
          href={staff ? "/admin/scripts" : "/account/scripts"}
        >Scripts</Link>
        <Link
          aria-current={active === "assets" ? "page" : undefined}
          href={staff ? "/admin/assets" : "/account/assets"}
        >Assets</Link>
        {staff ? <Link href="/admin/content">Content</Link> : null}
        {staff ? <Link href="/admin/finance">Finance</Link> : null}
        <Link href="/account">Account</Link>
      </nav>
    </header>
  );
}
