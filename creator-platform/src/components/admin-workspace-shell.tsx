import Link from "next/link";
import {
  Banknote,
  Bot,
  FileCheck2,
  FolderArchive,
  Home,
  Library,
  ScrollText,
  SearchCheck,
  Shield,
  Users,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import type { DiscordStaffRole } from "@/server/admin/discord";

import styles from "@/components/admin-workspace.module.css";

export type AdminWorkspaceSection =
  | "home"
  | "applications"
  | "creators"
  | "verification"
  | "content"
  | "scripts"
  | "assets"
  | "deals"
  | "finance"
  | "discord"
  | "staff";

const navigation: ReadonlyArray<{
  key: AdminWorkspaceSection;
  href: string;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
}> = [
  { key: "home", href: "/admin", label: "Home", icon: Home },
  { key: "applications", href: "/admin/applications", label: "Applications", icon: FileCheck2 },
  { key: "creators", href: "/admin/creators", label: "Creators", icon: Users },
  { key: "verification", href: "/admin/verifications", label: "Verification", icon: SearchCheck },
  { key: "content", href: "/admin/content", label: "Content", icon: Video },
  { key: "scripts", href: "/admin/scripts", label: "Scripts", icon: Library },
  { key: "assets", href: "/admin/assets", label: "Assets", icon: FolderArchive },
  { key: "deals", href: "/admin/deals", label: "Deals", icon: ScrollText },
  { key: "finance", href: "/admin/finance", label: "Finance", icon: Banknote },
  { key: "discord", href: "/admin/discord", label: "Discord", icon: Bot },
  { key: "staff", href: "/admin/staff", label: "Staff", icon: Shield, adminOnly: true },
];

export function AdminWorkspaceShell({
  active,
  role,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  active: AdminWorkspaceSection;
  role: DiscordStaffRole;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/admin" aria-label="Creator operations home">
          <BrandMark />
          <span>Creator operations</span>
        </Link>
        <nav aria-label="Creator operations">
          {navigation.filter((item) => !item.adminOnly || role === "admin").map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={item.key === active ? styles.activeLink : undefined}
                href={item.href}
                key={item.key}
              >
                <Icon aria-hidden="true" size={15} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          <span>{role === "admin" ? "Administrator" : "Reviewer"}</span>
          <Link href="/account">Creator account</Link>
        </div>
      </aside>

      <section className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {actions ? <div className={styles.headerActions}>{actions}</div> : null}
        </header>
        {children}
      </section>
    </main>
  );
}

export { styles as adminWorkspaceStyles };
