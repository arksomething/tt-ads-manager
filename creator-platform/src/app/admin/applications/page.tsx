import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CircleDot, Inbox } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  getCurrentApplicationStaffMembership,
  getStaffApplicationQueue,
  normalizeApplicationFilter,
  type StaffApplicationStatus,
} from "@/server/admin/applications";
import { getCurrentAccount } from "@/server/auth/session";

import styles from "./admin-applications.module.css";

export const metadata: Metadata = {
  title: "Application review",
  description: "Staff review queue for creator applications.",
};

export const dynamic = "force-dynamic";

const filters = [
  ["all", "All"],
  ["submitted", "Submitted"],
  ["in_review", "In review"],
  ["changes_requested", "Changes requested"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
] as const;

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function statusClass(status: StaffApplicationStatus) {
  if (status === "submitted") return styles.statusSubmitted;
  if (status === "in_review") return styles.statusInReview;
  if (status === "changes_requested") return styles.statusChangesRequested;
  if (status === "approved") return styles.statusApproved;
  if (status === "rejected") return styles.statusRejected;
  return styles.statusWithdrawn;
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function platformLabel(value: "TIKTOK" | "INSTAGRAM_REELS") {
  return value === "TIKTOK" ? "TikTok" : "Instagram";
}

type PageProps = {
  searchParams: Promise<{ status?: string | string[] }>;
};

export default async function AdminApplicationsPage({ searchParams }: PageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fadmin%2Fapplications");

  const staff = await getCurrentApplicationStaffMembership().catch(() => null);
  if (!staff) redirect("/account");

  const query = await searchParams;
  const filter = normalizeApplicationFilter(
    Array.isArray(query.status) ? query.status[0] : query.status,
  );
  const queue = await getStaffApplicationQueue(filter).catch(() => null);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/admin" className={styles.brand}><BrandMark /><span>Creator operations</span></Link>
        <nav className={styles.headerActions} aria-label="Staff navigation">
          <span>{account.email}</span>
          <Link href="/admin">Operations home</Link>
          <Link href="/admin/discord">Discord operations</Link>
          <Link href="/account">Account</Link>
        </nav>
      </header>

      <div className={styles.shell}>
        <section className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>Creator operations</p>
            <h1>Application review</h1>
            <p>Review creator identity and platform claims, record a clear decision, and keep every lifecycle change auditable.</p>
          </div>
          <span className={styles.role}>{statusLabel(staff.role)} access</span>
        </section>

        <nav aria-label="Application status filters">
          <ul className={styles.filters}>
            {filters.map(([value, label]) => (
              <li key={value}>
                <Link
                  href={value === "all" ? "/admin/applications" : `/admin/applications?status=${value}`}
                  aria-current={filter === value ? "page" : undefined}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {queue === null ? (
          <p className={styles.alert} role="alert">
            The application queue is unavailable. No applicant count or review-state claim is being made. Refresh before taking a decision.
          </p>
        ) : (
          <section className={styles.panel} aria-labelledby="queue-title">
            <header className={styles.panelHeader}>
              <strong id="queue-title">{filter === "all" ? "All applications" : statusLabel(filter)}</strong>
              <span>{queue.length} {queue.length === 1 ? "application" : "applications"}</span>
            </header>
            {queue.length ? (
              <ul className={styles.queue}>
                {queue.map((application) => (
                  <li className={styles.queueItem} key={application.id}>
                    <Link className={styles.rowLink} href={`/admin/applications/${application.id}`}>
                      <div className={styles.identity}>
                        <strong>{application.name}</strong>
                        <span>{application.email}</span>
                        <span>Discord: {application.discordUsername}</span>
                      </div>
                      <div className={styles.secondary}>
                        <span>Creator accounts</span>
                        <strong>{application.handleCount} submitted</strong>
                        <div className={styles.platforms}>
                          {application.platforms.map((platform) => <em key={platform}>{platformLabel(platform)}</em>)}
                        </div>
                      </div>
                      <div className={styles.submitted}>
                        <span>{application.reviewRevision ? `Revision ${application.reviewRevision}` : "Initial submission"}</span>
                        <strong>{date(application.submittedAt)}</strong>
                      </div>
                      <span className={`${styles.status} ${statusClass(application.status)}`}>
                        <CircleDot aria-hidden="true" size={11} />{statusLabel(application.status)}
                        <ArrowRight aria-hidden="true" size={12} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <Inbox aria-hidden="true" size={24} />
                <strong>No applications in this view</strong>
                <span>Try another status filter.</span>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
