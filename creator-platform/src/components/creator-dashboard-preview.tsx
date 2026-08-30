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
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { PreviewNote } from "@/components/preview-note";
import { formatObservedCount, formatObservedMoney } from "@/lib/display-values";
import {
  creatorDashboardSample,
  describeEarningsStage,
  describePreviewMetric,
  getPreviewMetricValue,
} from "@/lib/preview-models";

const activityLevelSeed = [
  0, 1, 0, 2, 1, 0, 1, 2, 0, 3, 1, 0, 2, 1, 2, 2, 0, 1, 3, 2, 1, 0, 1, 2,
  3, 1, 1, 2, 0, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0, 1, 2, 3, 3,
  2, 1, 0, 2, 3, 1, 2, 2, 0, 1, 3, 2, 1, 0, 2, 3, 2, 1, 0, 1, 2, 3,
  1, 2, 0, 1, 3, 2, 2, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2,
  1, 0, 2, 1, 3, 2,
];

const activityWeekCount = 52;
const activityDayCount = activityWeekCount * 7;
const latestActivityDayIndex = activityDayCount - 1;
const activityLevels = Array.from({ length: activityDayCount }, (_, index) => {
  const seedOffset = Math.floor(index / 49) * 13;
  return activityLevelSeed[(index + seedOffset) % activityLevelSeed.length];
});
const activityStartDate = Date.UTC(2025, 5, 2);
const activityDayMilliseconds = 24 * 60 * 60 * 1000;
const activityDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const activityShortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const activityMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

const activityDays = activityLevels.map((level, index) => {
  const date = new Date(activityStartDate + (index * activityDayMilliseconds));

  return {
    dateLabel: activityDateFormatter.format(date),
    level,
    monthLabel: activityMonthFormatter.format(date),
    shortDateLabel: activityShortDateFormatter.format(date),
  };
});

const activityMonths = activityDays.reduce<Array<{ label: string; week: number }>>((months, day, index) => {
  if (months.at(-1)?.label !== day.monthLabel) {
    months.push({ label: day.monthLabel, week: Math.floor(index / 7) });
  }

  return months;
}, []);

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
  const activityButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activityScrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const scroller = activityScrollRef.current;
    if (!scroller || window.innerWidth > 650) return;

    const frame = window.requestAnimationFrame(() => {
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const openInbox = (event: MouseEvent<HTMLButtonElement>) => {
    lastFocusedRef.current = event.currentTarget;
    setInboxOpen(true);
  };

  const closeInbox = () => setInboxOpen(false);

  const moveActivityFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = index + 1;
        break;
      case "ArrowUp":
        nextIndex = index - 1;
        break;
      case "ArrowRight":
        nextIndex = index + 7;
        break;
      case "ArrowLeft":
        nextIndex = index - 7;
        break;
      case "Home":
        nextIndex = index - (index % 7);
        break;
      case "End":
        nextIndex = index + (6 - (index % 7));
        break;
      default:
        return;
    }

    event.preventDefault();
    const boundedIndex = Math.max(0, Math.min(activityDays.length - 1, nextIndex));
    setSelectedActivityDay(boundedIndex);
    activityButtonRefs.current[boundedIndex]?.focus();
  };

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
              <div>
                <h2 id="activity-title">Activity</h2>
                <span className="creator-activity__sample-label">Sample calendar</span>
              </div>
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
            <p id="activity-calendar-description" className="sr-only">
              Sample calendar. Columns are weeks starting Monday and rows are Monday through Sunday. Use arrow keys to move between days.
            </p>
            <div ref={activityScrollRef} className="creator-activity__calendar-scroll">
              <div className="creator-activity__calendar-frame">
                <div
                  className="creator-activity__calendar"
                  role="group"
                  aria-label="Sample posting activity over fifty-two weeks"
                  aria-describedby="activity-calendar-description"
                >
                  <div className="creator-activity__weekdays" aria-hidden="true">
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                  </div>
                  <div className="creator-activity__plot">
                    <div
                      className="creator-activity__months"
                      aria-hidden="true"
                      style={{ gridTemplateColumns: `repeat(${activityWeekCount}, var(--activity-cell-size))` }}
                    >
                      {activityMonths.map((month) => (
                        <span key={month.label} style={{ gridColumnStart: month.week + 1 }}>{month.label}</span>
                      ))}
                    </div>
                    <div
                      className="creator-activity__grid"
                      style={{ gridTemplateColumns: `repeat(${activityWeekCount}, var(--activity-cell-size))` }}
                    >
                      {activityDays.map((day, index) => {
                        const activityDescription = day.level === 0
                          ? "no required post"
                          : `${day.level} tracked post${day.level > 1 ? "s" : ""}`;

                        return (
                          <button
                            type="button"
                            key={day.dateLabel}
                            ref={(node) => { activityButtonRefs.current[index] = node; }}
                            data-level={day.level}
                            aria-pressed={selectedActivityDay === index}
                            aria-label={`${day.dateLabel}: ${activityDescription} (sample)`}
                            title={`${day.shortDateLabel} · ${activityDescription}`}
                            tabIndex={selectedActivityDay === index || (selectedActivityDay == null && index === latestActivityDayIndex) ? 0 : -1}
                            onClick={() => setSelectedActivityDay(index)}
                            onKeyDown={(event) => moveActivityFocus(event, index)}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="creator-activity__footer">
                  <span>Jun 2, 2025 – May 31, 2026 · sample data</span>
                  <div className="creator-activity__legend" aria-label="Scheduled off-day followed by increasing numbers of tracked posts">
                    <span aria-hidden="true">Off day</span>
                    {[0, 1, 2, 3].map((level) => <i key={level} data-level={level} aria-hidden="true" />)}
                    <span aria-hidden="true">More posts</span>
                  </div>
                </div>
                {selectedActivityDay != null ? (
                  <div className="creator-activity-detail" role="status">
                    <span>Sample day {selectedActivityDay + 1} · {activityDays[selectedActivityDay].shortDateLabel}</span>
                    <strong>
                      {activityDays[selectedActivityDay].level === 0
                        ? "No required post"
                        : `${activityDays[selectedActivityDay].level} tracked post${activityDays[selectedActivityDay].level > 1 ? "s" : ""}`}
                    </strong>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedActivityDay(null);
                        activityButtonRefs.current[latestActivityDayIndex]?.focus();
                      }}
                      aria-label="Close activity detail"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
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
