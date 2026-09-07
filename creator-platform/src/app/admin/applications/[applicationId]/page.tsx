import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CircleDot } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  getCurrentApplicationStaffMembership,
  getStaffApplicationDetail,
  type StaffApplicationAuditEvent,
  type StaffApplicationStatus,
} from "@/server/admin/applications";
import { getAdminDealCatalog, type AdminDealVersion } from "@/server/admin/deals";
import { getCurrentAccount } from "@/server/auth/session";

import styles from "../admin-applications.module.css";
import { ReviewDecisionForm } from "../review-decision-form";

export const metadata: Metadata = { title: "Review creator application" };
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function label(value: string) {
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

function date(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function eventSummary(event: StaffApplicationAuditEvent) {
  if (event.fromStatus && event.toStatus) {
    return `${label(event.fromStatus)} → ${label(event.toStatus)}`;
  }
  return event.reviewRevision === null ? null : `Revision ${event.reviewRevision}`;
}

function isEligibleApprovalDeal(deal: AdminDealVersion | null) {
  if (
    !deal || deal.status !== "active" || !deal.isDefault ||
    !deal.activationReady || !deal.effectiveAt
  ) return false;
  const effectiveAt = new Date(deal.effectiveAt);
  return !Number.isNaN(effectiveAt.getTime()) && effectiveAt.getTime() <= Date.now();
}

type PageProps = { params: Promise<{ applicationId: string }> };

export default async function AdminApplicationDetailPage({ params }: PageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const { applicationId } = await params;
  if (!uuidPattern.test(applicationId)) notFound();

  const account = await getCurrentAccount();
  if (!account) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/admin/applications/${applicationId}`)}`);
  }

  const staff = await getCurrentApplicationStaffMembership().catch(() => null);
  if (!staff) redirect("/account");

  const detailResult = await getStaffApplicationDetail(applicationId)
    .then((application) => ({ application, unavailable: false }))
    .catch(() => ({ application: null, unavailable: true }));

  if (!detailResult.unavailable && !detailResult.application) notFound();

  const application = detailResult.application;
  const approvalCanBeChosen = application?.status === "submitted" || application?.status === "in_review";
  const dealCatalogResult = approvalCanBeChosen
    ? await getAdminDealCatalog()
        .then((catalog) => ({ catalog, unavailable: false }))
        .catch(() => ({ catalog: null, unavailable: true }))
    : { catalog: null, unavailable: false };
  const defaultDeal = dealCatalogResult.catalog?.defaultVersion ?? null;

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
        <Link className={styles.backLink} href="/admin/applications"><ArrowLeft aria-hidden="true" size={14} />Application queue</Link>

        {detailResult.unavailable || !application ? (
          <p className={styles.alert} role="alert">
            This application is temporarily unavailable. No current status or decision state is being claimed. Return to the queue and refresh before reviewing.
          </p>
        ) : (
          <>
            <section className={styles.detailTitle}>
              <div>
                <p className={styles.eyebrow}>Creator application</p>
                <h1>{application.name}</h1>
                <p>Submitted {date(application.submittedAt)} · {application.reviewRevision ? `Revision ${application.reviewRevision}` : "Initial submission"}</p>
              </div>
              <span className={`${styles.status} ${statusClass(application.status)}`}>
                <CircleDot aria-hidden="true" size={11} />{label(application.status)}
              </span>
            </section>

            <div className={styles.detailGrid}>
              <div className={styles.stack}>
                <section className={styles.panel} aria-labelledby="applicant-title">
                  <div className={styles.section}>
                    <div className={styles.sectionHeading}>
                      <h2 id="applicant-title">Applicant details</h2>
                      <span>Account lifecycle: {label(application.lifecycleStatus)}</span>
                    </div>
                    <dl className={styles.details}>
                      <div><dt>Email</dt><dd>{application.email}</dd></div>
                      <div><dt>Phone</dt><dd>{application.phoneNumber}</dd></div>
                      <div><dt>Discord</dt><dd>{application.discordUsername}</dd></div>
                      <div><dt>Last reviewed</dt><dd>{date(application.reviewedAt)}</dd></div>
                    </dl>
                  </div>

                  <div className={styles.section}>
                    <div className={styles.sectionHeading}>
                      <h2>Submitted creator accounts</h2>
                      <span>{application.handles.length} unverified {application.handles.length === 1 ? "claim" : "claims"}</span>
                    </div>
                    <ul className={styles.handles}>
                      {application.handles.map((handle) => (
                        <li key={handle.id}>
                          <span>{handle.platform === "TIKTOK" ? "TikTok" : "Instagram"}</span>
                          <strong>{handle.handle.startsWith("@") ? handle.handle : `@${handle.handle}`}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {application.decisionMessage ? (
                    <div className={styles.section}>
                      <div className={styles.sectionHeading}><h2>Current creator-facing message</h2></div>
                      <p className={styles.message}>{application.decisionMessage}</p>
                    </div>
                  ) : null}

                  {application.enrollment ? (
                    <div className={styles.section}>
                      <div className={styles.sectionHeading}><h2>Assigned onboarding record</h2></div>
                      <dl className={styles.details}>
                        <div><dt>Enrollment</dt><dd>{label(application.enrollment.status)}</dd></div>
                        <div><dt>Approved</dt><dd>{date(application.enrollment.approvedAt)}</dd></div>
                        <div><dt>Deal</dt><dd>{application.enrollment.dealLabel} · v{application.enrollment.dealVersion}</dd></div>
                        <div><dt>Agreement</dt><dd>{application.agreement ? label(application.agreement.status) : "Not created"}</dd></div>
                      </dl>
                    </div>
                  ) : null}
                </section>

                <section className={`${styles.panel} ${styles.section}`} aria-labelledby="history-title">
                  <div className={styles.sectionHeading}>
                    <h2 id="history-title">Audit history</h2>
                    <span>{application.auditEvents.length} {application.auditEvents.length === 1 ? "event" : "events"}</span>
                  </div>
                  <ol className={styles.timeline}>
                    {application.auditEvents.map((event) => (
                      <li key={event.id}>
                        <strong>{label(event.type)}</strong>
                        <div className={styles.timelineMeta}>
                          <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
                          {eventSummary(event) ? <span>{eventSummary(event)}</span> : null}
                        </div>
                        {event.applicantMessage ? <p>Creator message: {event.applicantMessage}</p> : null}
                        {event.staffNote ? <p>Internal note: {event.staffNote}</p> : null}
                      </li>
                    ))}
                  </ol>
                </section>
              </div>

              <aside className={`${styles.panel} ${styles.decision}`} aria-labelledby="decision-title">
                <p className={styles.eyebrow}>Review action</p>
                <h2 id="decision-title">Record a decision</h2>
                <p className={styles.decisionIntro}>Every action updates the application and creator lifecycle in one database transaction and appends the reviewer identity to history.</p>
                <ReviewDecisionForm
                  applicationId={application.id}
                  status={application.status}
                  staffRole={staff.role}
                  defaultDeal={defaultDeal}
                  approvalEligible={isEligibleApprovalDeal(defaultDeal)}
                  dealCatalogUnavailable={dealCatalogResult.unavailable}
                />
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
