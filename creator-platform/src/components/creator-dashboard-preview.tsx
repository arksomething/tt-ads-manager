"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpenText,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Flame,
  Home,
  Inbox,
  MessageCircle,
  PlaySquare,
  Send,
  Settings,
  X,
} from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { PreviewNote } from "@/components/preview-note";
import { formatObservedCount, formatObservedMoney } from "@/lib/display-values";
import {
  creatorDashboardSample,
  describeEarningsStage,
  describePreviewMetric,
  getPreviewMetricValue,
} from "@/lib/preview-models";

const activityLevels = [
  0, 1, 0, 2, 1, 0, 1, 2, 0, 3, 1, 0, 2, 1, 2, 2, 0, 1, 3, 2, 1, 0, 1, 2,
  3, 1, 1, 2, 0, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0, 1, 2, 3, 3,
  2, 1, 0, 2, 3, 1, 2, 2, 0, 1, 3, 2, 1, 0, 2, 3, 2, 1, 0, 1, 2, 3,
  1, 2, 0, 1, 3, 2, 2, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2,
  1, 0, 2, 1, 3, 2,
];

const chartPath =
  "M0 188 L42 177 L84 147 L126 120 L168 128 L210 92 L252 105 L294 59 L336 84 L378 30 L420 80 L462 69 L504 46 L546 72 L588 120 L630 85 L672 63 L714 91 L756 132 L798 111";

function formatCompactCount(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCompactMoney(valueMinor: number | null) {
  if (valueMinor == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(valueMinor / 100);
}

export function CreatorDashboardPreview() {
  const [metric, setMetric] = useState<"views" | "earnings">("views");
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selectedActivityDay, setSelectedActivityDay] = useState<number | null>(null);
  const [supportPanel, setSupportPanel] = useState<"activity" | "report" | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const viewsValue = getPreviewMetricValue(creatorDashboardSample.metrics.verifiedViews);
  const earningsValue = getPreviewMetricValue(creatorDashboardSample.metrics.estimatedEarningsMinor);
  const postsValue = getPreviewMetricValue(creatorDashboardSample.metrics.postsThisWeek);
  const earningsStage = describeEarningsStage(creatorDashboardSample.earningsStage);

  useEffect(() => {
    if (!inboxOpen) return;

    const background = backgroundRef.current;
    const previousOverflow = document.body.style.overflow;
    closeButtonRef.current?.focus();
    background?.setAttribute("inert", "");
    background?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInboxOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      background?.removeAttribute("inert");
      background?.removeAttribute("aria-hidden");
      document.body.style.overflow = previousOverflow;
      if (lastFocusedRef.current?.isConnected) lastFocusedRef.current.focus();
    };
  }, [inboxOpen]);

  const openInbox = (event: MouseEvent<HTMLButtonElement>) => {
    lastFocusedRef.current = event.currentTarget;
    setInboxOpen(true);
  };

  const closeInbox = () => setInboxOpen(false);

  return (
    <div className="creator-preview">
      <div ref={backgroundRef}>
        <div className="creator-preview__topbar">
          <PreviewNote>Sample workspace · no live account or payout data</PreviewNote>
          <Link href="/" className="preview-back-link">
            <ArrowLeft aria-hidden="true" size={15} />
            Back to program
          </Link>
        </div>

        <div className="creator-shell">
        <aside className="creator-rail" aria-label="Creator navigation">
          <Link href="/" aria-label="GoTall creator program"><BrandMark /></Link>
          <nav>
            <Link className="is-active" href="/preview/creator" aria-label="Home"><Home size={19} /></Link>
            <button type="button" aria-label="Scripts"><BookOpenText size={19} /></button>
            <button type="button" aria-label="Content"><PlaySquare size={19} /></button>
            <button type="button" aria-label="Schedule"><CalendarDays size={19} /></button>
            <button type="button" aria-label="Earnings"><CircleDollarSign size={19} /></button>
            <button type="button" aria-label="Open inbox" onClick={openInbox}>
              <Inbox size={19} />
              <span className="nav-dot" />
            </button>
          </nav>
          <button type="button" aria-label="Settings"><Settings size={19} /></button>
          <span className="creator-rail__workspace">GoTall</span>
        </aside>

        <main className="creator-main">
          <header className="creator-main__header">
            <div className="creator-name">
              <span className="creator-avatar">{creatorDashboardSample.creator.initial}</span>
              <div>
                <p>Welcome back</p>
                <h1>{creatorDashboardSample.creator.firstName}</h1>
              </div>
              <span className="creator-streak"><Flame size={15} fill="currentColor" /> {creatorDashboardSample.creator.streakDays} days</span>
            </div>
            <div className="creator-header-actions">
              <button type="button" aria-label="Notifications" className="icon-button">
                <Bell size={18} />
                <span className="notification-count">1</span>
              </button>
              <span className="creator-avatar creator-avatar--small">{creatorDashboardSample.creator.initial}</span>
            </div>
          </header>

          <section className="creator-kpis" aria-label="Sample performance metrics">
            <div data-state={creatorDashboardSample.metrics.verifiedViews.state}>
              <strong>{formatCompactCount(viewsValue)}</strong><span>Verified views</span>
            </div>
            <div data-state={creatorDashboardSample.metrics.estimatedEarningsMinor.state}>
              <strong>{formatCompactMoney(earningsValue)}</strong><span>{earningsStage} earnings · stale</span>
            </div>
            <div data-state={creatorDashboardSample.metrics.postsThisWeek.state}>
              <strong>{formatObservedCount(postsValue)} / {creatorDashboardSample.weeklyPostGoal}</strong><span>Posts this week</span>
            </div>
          </section>

          <section className="creator-performance" aria-labelledby="performance-title">
            <div className="creator-performance__toolbar">
              <div className="metric-tabs" role="tablist" aria-label="Performance metric">
                <button
                  id="views-tab"
                  type="button"
                  role="tab"
                  aria-selected={metric === "views"}
                  onClick={() => setMetric("views")}
                >
                  Views
                </button>
                <button
                  id="earnings-tab"
                  type="button"
                  role="tab"
                  aria-selected={metric === "earnings"}
                  onClick={() => setMetric("earnings")}
                >
                  Earnings
                </button>
              </div>
              <button className="period-button" type="button">30 days <ChevronRight size={14} /></button>
            </div>

            <div className="creator-chart" role="tabpanel" aria-labelledby={`${metric}-tab`}>
              <div className="creator-chart__plot">
                <h2 id="performance-title" className="sr-only">Thirty-day performance</h2>
                <svg viewBox="0 0 798 220" role="img" aria-label={`Sample ${metric} trend over thirty days`}>
                  <path className="creator-chart__grid" d="M0 198H798M0 132H798M0 66H798" />
                  <path className="creator-chart__line" d={chartPath} />
                  <line x1="378" y1="18" x2="378" y2="206" className="creator-chart__cursor" />
                  <circle cx="378" cy="30" r="6" />
                </svg>
                <div className="creator-chart__tooltip">
                  <span>May 18</span>
                  <strong>{metric === "views" ? "146K views" : "$51 est."}</strong>
                </div>
                <div className="creator-chart__dates"><span>May 4</span><span>May 18</span><span>Jun 1</span></div>
              </div>
              <div className="creator-chart__summary">
                <span>{metric === "views" ? "Views (30d)" : "Est. earnings (30d)"}</span>
                <strong>{metric === "views" ? formatObservedCount(viewsValue) : formatObservedMoney(earningsValue)}</strong>
                <em>↑ 18%</em>
                <p>{metric === "views" ? "Across verified sample posts." : `${earningsStage} sample · stale · not approved for payment.`}</p>
              </div>
            </div>
          </section>

          <section className="creator-activity" aria-labelledby="activity-title">
            <div className="creator-section-title">
              <h2 id="activity-title">Activity</h2>
              <span><Flame size={14} fill="currentColor" /> {creatorDashboardSample.creator.streakDays} day streak</span>
              <button
                type="button"
                aria-expanded={supportPanel === "activity"}
                aria-controls="creator-support-panel"
                onClick={() => setSupportPanel((current) => current === "activity" ? null : "activity")}
              >
                How this works
              </button>
            </div>
            <div className="creator-activity__months" aria-hidden="true"><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span></div>
            <div className="creator-activity__grid" aria-label="Sample posting activity over fourteen weeks">
              {activityLevels.map((level, index) => (
                <button
                  type="button"
                  key={index}
                  data-level={level}
                  aria-pressed={selectedActivityDay === index}
                  aria-label={`Day ${index + 1}: ${level === 0 ? "no required post" : `${level} post${level > 1 ? "s" : ""}`}`}
                  title={level === 0 ? "No required post" : `${level} post${level > 1 ? "s" : ""}`}
                  onClick={() => setSelectedActivityDay(index)}
                />
              ))}
            </div>
            {selectedActivityDay != null ? (
              <div className="creator-activity-detail" role="status">
                <span>Sample day {selectedActivityDay + 1}</span>
                <strong>
                  {activityLevels[selectedActivityDay] === 0
                    ? "No required post"
                    : `${activityLevels[selectedActivityDay]} tracked post${activityLevels[selectedActivityDay] > 1 ? "s" : ""}`}
                </strong>
                <button type="button" onClick={() => setSelectedActivityDay(null)} aria-label="Close activity detail"><X size={14} /></button>
              </div>
            ) : null}
          </section>

          <section className="creator-actions" aria-label="Next actions">
            <Link href="/preview/onboarding" className="creator-action-row">
              <span className="creator-action-row__icon"><Clock3 size={18} /></span>
              <span className="creator-action-row__label">Next</span>
              <span className="creator-action-row__body"><strong>Signs you&apos;re a late bloomer</strong><em>due today</em></span>
              <span className="creator-action-row__go"><ArrowRight size={18} /></span>
            </Link>
            <button type="button" className="creator-action-row" onClick={openInbox}>
              <span className="creator-action-row__icon"><MessageCircle size={18} /></span>
              <span className="creator-action-row__label">Inbox</span>
              <span className="creator-action-row__body"><strong>Joseph: Great retention on yesterday&apos;s post</strong></span>
              <span className="creator-action-row__unread" aria-label="Unread" />
              <ChevronRight size={17} />
            </button>
          </section>

          <div className="tracking-freshness">
            <span className="tracking-freshness__dot" />
            <span>Tracking active</span>
            <span>Last complete check {creatorDashboardSample.metrics.verifiedViews.observedAt}</span>
            <button
              type="button"
              aria-expanded={supportPanel === "report"}
              aria-controls="creator-support-panel"
              onClick={() => setSupportPanel((current) => current === "report" ? null : "report")}
            >
              Report a missing post
            </button>
          </div>

          <details className="tracking-source-details">
            <summary>View sample source states</summary>
            <dl>
              <div><dt>Verified views</dt><dd data-state={creatorDashboardSample.metrics.verifiedViews.state}>{describePreviewMetric(creatorDashboardSample.metrics.verifiedViews)}</dd></div>
              <div><dt>Estimated earnings</dt><dd data-state={creatorDashboardSample.metrics.estimatedEarningsMinor.state}>{describePreviewMetric(creatorDashboardSample.metrics.estimatedEarningsMinor)}</dd></div>
              <div><dt>Seven-day baseline</dt><dd data-state={creatorDashboardSample.metrics.sevenDayBaseline.state}>{describePreviewMetric(creatorDashboardSample.metrics.sevenDayBaseline)}</dd></div>
              <div><dt>Instagram reach</dt><dd data-state={creatorDashboardSample.metrics.instagramReach.state}>{describePreviewMetric(creatorDashboardSample.metrics.instagramReach)}</dd></div>
            </dl>
          </details>

          {supportPanel ? (
            <section id="creator-support-panel" className="creator-support-panel" aria-live="polite">
              <div>
                <span>{supportPanel === "activity" ? "Calculation guide" : "Missing post report"}</span>
                <h2>{supportPanel === "activity" ? "What counts as activity" : "Reporting is preview-only"}</h2>
              </div>
              <p>
                {supportPanel === "activity"
                  ? "Each square represents one day. Only discovered, account-linked posts count; unavailable observations are never treated as zero."
                  : "No report was sent. Signed-in creator identity and connected tracking accounts must be live before this action can create a support case."}
              </p>
              <button type="button" onClick={() => setSupportPanel(null)} aria-label="Close preview information"><X size={15} /></button>
            </section>
          ) : null}
        </main>

        <nav className="creator-mobile-nav" aria-label="Mobile creator navigation">
          <Link className="is-active" href="/preview/creator"><Home size={19} /><span>Home</span></Link>
          <button type="button"><BookOpenText size={19} /><span>Scripts</span></button>
          <button type="button"><PlaySquare size={19} /><span>Posts</span></button>
          <button type="button" onClick={openInbox}><Inbox size={19} /><span>Inbox</span></button>
        </nav>
        </div>
      </div>

      {inboxOpen ? (
        <div className="inbox-layer">
          <button className="inbox-scrim" type="button" tabIndex={-1} onClick={closeInbox} aria-label="Dismiss inbox" />
          <aside ref={dialogRef} className="inbox-drawer" role="dialog" aria-modal="true" aria-labelledby="inbox-title" aria-describedby="inbox-description">
            <header>
              <div><span>Messages</span><h2 id="inbox-title">Inbox</h2></div>
              <button ref={closeButtonRef} className="icon-button" type="button" onClick={closeInbox} aria-label="Close inbox">
                <X size={19} />
              </button>
            </header>
            <p id="inbox-description" className="sr-only">Sample creator messages. No live messages are loaded.</p>
            <div className="inbox-tabs"><button className="is-active" type="button">All</button><button type="button">Unread <span /></button></div>
            <article className="inbox-message">
              <span className="inbox-message__dot" />
              <div><div><strong>Joseph</strong><time>2m</time></div><p>Great retention on yesterday&apos;s post. Keep the opening pause on the next one.</p></div>
              <ChevronRight size={17} />
            </article>
            <div className="inbox-compose">
              <button type="button" aria-label="Start a new message"><Send size={17} /> New message</button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
