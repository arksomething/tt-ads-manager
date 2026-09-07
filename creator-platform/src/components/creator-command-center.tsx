import Link from "next/link";

import styles from "@/components/creator-workspace.module.css";
import { formatMinorUnits } from "@/server/accounts/earnings";
import type {
  CreatorHomeNextAction,
  CreatorHomeOverview,
} from "@/server/accounts/home";

function stateLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function compactInteger(value: string) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(BigInt(value));
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(new Date(value));
}

function viewCoverageCopy(overview: CreatorHomeOverview) {
  const coverage = overview.viewCoverage;
  if (!overview.availability.content) return "Tracking coverage is unavailable.";
  if (coverage.state === "empty") return "No attributed posts are recorded.";
  if (coverage.postsWithKnownViews === 0) {
    return `${coverage.totalPostCount} recorded ${coverage.totalPostCount === 1 ? "post has" : "posts have"} no view count.`;
  }
  return `${coverage.postsWithKnownViews} of ${coverage.totalPostCount} recorded posts have a view count.`;
}

function NextAction({ action }: { action: CreatorHomeNextAction }) {
  return (
    <section className={styles.homeNext} aria-labelledby="creator-next-action-title">
      <div>
        <p className={styles.kicker}>Next action</p>
        <h2 id="creator-next-action-title">{action.title}</h2>
        <p>{action.description}</p>
        {action.dueAt ? (
          <span className={styles.homeDueDate}>Due {formatDate(action.dueAt, { year: "numeric" })} UTC</span>
        ) : null}
      </div>
      {action.href && action.buttonLabel ? (
        <Link className={styles.homePrimaryLink} href={action.href}>{action.buttonLabel}</Link>
      ) : (
        <span className={styles.truthBadge}>No unverified action</span>
      )}
    </section>
  );
}

function Activity({ overview }: { overview: CreatorHomeOverview }) {
  return (
    <section className={styles.panel} aria-labelledby="creator-activity-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>30 days · UTC</p>
          <h2 id="creator-activity-title">Recorded activity</h2>
        </div>
        <span className={styles.truthBadge}>No cadence inferred</span>
      </div>
      {!overview.availability.content ? (
        <div className={styles.errorState} role="alert">
          <h3>Activity is temporarily unavailable</h3>
          <p>No posting or submission claim is being made.</p>
        </div>
      ) : (
        <>
          <div className={styles.homeActivityScroll}>
            <div className={styles.homeActivityGrid} aria-label="Recorded posts and submissions over thirty UTC days">
              {overview.activity.map((day) => (
                <div
                  className={styles.homeActivityDay}
                  data-posts={Math.min(day.postCount, 3)}
                  data-submissions={day.submissionCount > 0 ? "true" : "false"}
                  key={day.date}
                  title={`${formatDate(`${day.date}T00:00:00Z`, { year: "numeric" })}: ${day.postCount} recorded posts, ${day.submissionCount} submissions`}
                >
                  <strong>{day.postCount}</strong>
                  <span>{formatDate(`${day.date}T00:00:00Z`)}</span>
                  {day.submissionCount > 0 ? <small>{day.submissionCount} submitted</small> : <small>&nbsp;</small>}
                </div>
              ))}
            </div>
          </div>
          <p className={styles.homePanelNote}>
            Cells count recorded publish timestamps. Submission counts stay separate, and neutral cells do not imply a posting requirement.
            {overview.undatedPostCount ? ` ${overview.undatedPostCount} ${overview.undatedPostCount === 1 ? "post has" : "posts have"} no recorded publish date.` : ""}
          </p>
        </>
      )}
    </section>
  );
}

function Earnings({ overview }: { overview: CreatorHomeOverview }) {
  return (
    <section className={styles.panel} aria-labelledby="creator-home-earnings-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Ledger</p>
          <h2 id="creator-home-earnings-title">Earnings by state</h2>
        </div>
        <Link className={styles.homeHeaderLink} href="/account/earnings">Open earnings</Link>
      </div>
      {!overview.availability.earnings ? (
        <div className={styles.errorState} role="alert">
          <h3>Earnings are temporarily unavailable</h3>
          <p>No balance is being inferred.</p>
        </div>
      ) : overview.earningSummaries.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No earning entries recorded</h3>
          <p>This does not establish a zero balance.</p>
        </div>
      ) : (
        <div className={styles.homeMoneyList}>
          {overview.earningSummaries.map((summary) => (
            <div className={styles.homeMoneyRow} key={`${summary.state}:${summary.currency}:${summary.currencyExponent}`}>
              <div>
                <strong>{stateLabel(summary.state)}</strong>
                <span>{summary.entryCount} {summary.entryCount === 1 ? "entry" : "entries"} · {summary.currency}</span>
              </div>
              <b>{formatMinorUnits(summary.amountMinor, summary.currency, summary.currencyExponent)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Updates({ overview }: { overview: CreatorHomeOverview }) {
  return (
    <section className={styles.panel} aria-labelledby="creator-home-updates-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Account</p>
          <h2 id="creator-home-updates-title">Recent updates</h2>
        </div>
        <Link className={styles.homeHeaderLink} href="/account/discord">Delivery settings</Link>
      </div>
      {!overview.availability.updates ? (
        <div className={styles.errorState} role="alert">
          <h3>Updates are temporarily unavailable</h3>
          <p>No message or delivery claim is being made.</p>
        </div>
      ) : overview.updates.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No account updates recorded</h3>
          <p>Application and onboarding updates will appear here when recorded.</p>
        </div>
      ) : (
        <ol className={styles.homeUpdateList}>
          {overview.updates.map((update) => (
            <li key={update.id}>
              <span className={styles.homeUpdateDot} aria-hidden="true" />
              <div><strong>{update.title}</strong><span>{stateLabel(update.topic)}</span></div>
              <time dateTime={update.occurredAt}>{formatDate(update.occurredAt, { year: "numeric" })} UTC</time>
            </li>
          ))}
        </ol>
      )}
      <p className={styles.homePanelNote}>These are logical account updates. Discord delivery and message-read status are separate.</p>
    </section>
  );
}

export function CreatorCommandCenter({
  overview,
  nextAction,
}: {
  overview: CreatorHomeOverview;
  nextAction: CreatorHomeNextAction;
}) {
  const knownViews = overview.viewCoverage.knownViews;

  return (
    <section className={styles.commandCenter} aria-labelledby="creator-command-center-title">
      <header className={styles.homeHeading}>
        <div>
          <p className={styles.kicker}>Creator command center</p>
          <h2 id="creator-command-center-title">What is recorded right now</h2>
          <p>One view of your next action, content activity, tracking evidence, and earning states.</p>
        </div>
        <span className={styles.truthBadge}>Recorded data only</span>
      </header>

      <NextAction action={nextAction} />

      <section className={styles.homeMetricGrid} aria-label="Creator account summary">
        <article>
          <span>Known views</span>
          <strong>{knownViews === null ? "Unknown" : compactInteger(knownViews)}</strong>
          <small>{viewCoverageCopy(overview)}</small>
        </article>
        <article>
          <span>Recorded posts · 7 days</span>
          <strong>{overview.postsLastSevenDays ?? "Unknown"}</strong>
          <small>UTC publish dates only.</small>
        </article>
        <article>
          <span>Open submissions</span>
          <strong>{overview.openSubmissionCount ?? "Unknown"}</strong>
          <small>Submitted, matching, or needing review.</small>
        </article>
        <article>
          <span>Earning entries</span>
          <strong>{overview.earningEntryCount ?? "Unknown"}</strong>
          <small>Amounts remain separated below by currency and state.</small>
        </article>
      </section>

      <Activity overview={overview} />

      <div className={styles.homeTwoColumn}>
        <Earnings overview={overview} />
        <Updates overview={overview} />
      </div>

      <nav className={styles.homeLinks} aria-label="Creator workspace shortcuts">
        <Link href="/account/content"><strong>Content</strong><span>Submit and inspect attributed posts</span></Link>
        <Link href="/account/scripts"><strong>Scripts</strong><span>Open current assignments</span></Link>
        <Link href="/account/assets"><strong>Assets</strong><span>Use approved campaign files</span></Link>
        <Link href="/account/earnings"><strong>Earnings</strong><span>Inspect every ledger state</span></Link>
      </nav>
    </section>
  );
}
