import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  Check,
  CircleAlert,
  Clock3,
  Link2,
  ShieldCheck,
  Unplug,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { getDiscordGuildInviteUrl } from "@/lib/discord/config";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getOwnCreatorApplication } from "@/server/accounts/application";
import {
  DEFAULT_DISCORD_PREFERENCES,
  getCreatorDiscordOverview,
  type CreatorDiscordConnection,
  type CreatorDiscordConnectionState,
  type CreatorDiscordOverview,
  type CreatorDiscordReminder,
  type CreatorDiscordReminderState,
} from "@/server/accounts/discord";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Discord settings",
};

export const dynamic = "force-dynamic";

type DiscordAccountPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Australia/Sydney",
  "UTC",
] as const;

const TOPICS = [
  {
    key: "account",
    field: "topicAccount",
    title: "Account",
    description: "Security, connection, and material account-state changes.",
    gated: false,
  },
  {
    key: "onboarding",
    field: "topicOnboarding",
    title: "Onboarding",
    description: "Application, agreement, and creator-program next steps.",
    gated: false,
  },
  {
    key: "posting",
    field: "topicPosting",
    title: "Posting",
    description: "Unavailable until creator-account tracking is authoritative.",
    gated: true,
  },
  {
    key: "performance",
    field: "topicPerformance",
    title: "Performance",
    description: "Unavailable until tracking and deal attribution gates are authoritative.",
    gated: true,
  },
  {
    key: "payments",
    field: "topicPayments",
    title: "Payments",
    description: "Payout status and actions that require your attention.",
    gated: false,
  },
] as const;

function connectionCopy(state: CreatorDiscordConnectionState) {
  switch (state) {
    case "connected":
      return {
        label: "Connected",
        title: "Discord is verified",
        body: "This Discord identity was verified in GoTall Creators. Membership is checked again immediately before every direct message.",
      };
    case "linked_not_member":
      return {
        label: "Not in server",
        title: "Discord is linked, but not in GoTall Creators",
        body: "Join GoTall Creators, then reconnect here so membership can be verified.",
      };
    case "needs_attention":
      return {
        label: "Needs attention",
        title: "Discord needs to be reconnected",
        body: "The saved identity could not be fully verified. Reconnect to refresh it safely.",
      };
    case "disconnected":
      return {
        label: "Disconnected",
        title: "Discord is disconnected",
        body: "The old identity snapshot is retained for audit history, but reminders cannot be sent.",
      };
    case "unavailable":
      return {
        label: "Unavailable",
        title: "Discord status is temporarily unavailable",
        body: "No connection claim is being made. Refresh this page before changing the connection.",
      };
    default:
      return {
        label: "Not connected",
        title: "Connect your Discord account",
        body: "Verify the Discord identity the creator team should use. This is separate from the username typed into your application.",
      };
  }
}

function formatTimestamp(value: string | null, timezone: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  }
}

function DiscordIdentity({
  connection,
  timezone,
}: {
  connection: CreatorDiscordConnection;
  timezone: string;
}) {
  if (!connection.discordUserId) return null;
  const identity = connection.username
    ? `@${connection.username.replace(/^@/u, "")}`
    : "Username unavailable";

  return (
    <dl className="discord-identity" aria-label="Verified Discord identity snapshot">
      <div>
        <dt>Verified identity</dt>
        <dd>
          <strong>{connection.displayName ?? identity}</strong>
          {connection.displayName && connection.username ? <span>{identity}</span> : null}
        </dd>
      </div>
      <div><dt>Discord user ID</dt><dd>{connection.discordUserId}</dd></div>
      <div>
        <dt>GoTall Creators</dt>
        <dd>{connection.guildMember === true ? "Member at last check" : connection.guildMember === false ? "Not a member" : "Not verified"}</dd>
      </div>
      <div><dt>Last verified</dt><dd>{formatTimestamp(connection.verifiedAt, timezone)}</dd></div>
    </dl>
  );
}

function ConnectionActions({
  connection,
  inviteUrl,
}: {
  connection: CreatorDiscordConnection;
  inviteUrl: string | null;
}) {
  if (connection.state === "unavailable") return null;

  if (
    connection.state === "unlinked"
    || connection.state === "needs_attention"
    || connection.state === "disconnected"
    || connection.state === "linked_not_member"
  ) {
    return (
      <div className="discord-connection-actions">
        {connection.state === "linked_not_member" && inviteUrl ? (
          <a className="button button--ink" href={inviteUrl} rel="noreferrer" target="_blank">
            Join GoTall Creators
          </a>
        ) : null}
        <a
          className={connection.state === "linked_not_member" && inviteUrl ? "button button--ghost" : "button button--ink"}
          href="/api/integrations/discord/start?returnTo=%2Faccount%2Fdiscord"
        >
          <Link2 aria-hidden="true" size={15} />
          {connection.state === "unlinked" ? "Connect Discord" : "Reconnect Discord"}
        </a>
      </div>
    );
  }

  return (
    <form action="/api/integrations/discord/disconnect" method="post">
      <button className="button button--ghost" type="submit">
        <Unplug aria-hidden="true" size={15} />
        Disconnect
      </button>
    </form>
  );
}

function ReminderStateBadge({ state }: { state: CreatorDiscordReminderState }) {
  const label: Record<CreatorDiscordReminderState, string> = {
    scheduled: "Scheduled",
    sent: "Accepted by Discord",
    retry: "Retry scheduled",
    blocked: "Blocked",
    cancelled: "Cancelled",
    dead: "Delivery failed",
  };

  return <span className={`reminder-state reminder-state--${state}`}>{label[state]}</span>;
}

function ReminderHistory({
  reminders,
  available,
  timezone,
}: {
  reminders: CreatorDiscordReminder[];
  available: boolean;
  timezone: string;
}) {
  if (!available) {
    return (
      <p className="discord-empty" role="status">
        Reminder history is temporarily unavailable. No delivery claim is being made.
      </p>
    );
  }

  if (!reminders.length) {
    return <p className="discord-empty">No Discord reminders have been queued for this account.</p>;
  }

  return (
    <div className="reminder-history">
      <ol aria-label="Recent Discord reminders">
        {reminders.map((reminder) => (
          <li key={reminder.id}>
            <span className="reminder-history__icon" aria-hidden="true"><Bell size={15} /></span>
            <div>
              <strong>{reminder.label}</strong>
              <span>{formatTimestamp(reminder.occurredAt, timezone)}</span>
            </div>
            <ReminderStateBadge state={reminder.state} />
          </li>
        ))}
      </ol>
      <p className="discord-fine-print">
        “Accepted by Discord” means Discord accepted the message for delivery. It does not mean the message was opened or read.
      </p>
    </div>
  );
}

export default async function DiscordAccountPage({ searchParams }: DiscordAccountPageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Faccount%2Fdiscord");

  const params = await searchParams;
  const [overviewResult, applicationResult] = await Promise.allSettled([
    getCreatorDiscordOverview(account.id),
    getOwnCreatorApplication(),
  ]);
  const overview: CreatorDiscordOverview = overviewResult.status === "fulfilled"
    ? overviewResult.value
    : {
        connection: {
          state: "unavailable",
          discordUserId: null,
          username: null,
          displayName: null,
          guildMember: null,
          verifiedAt: null,
          disconnectedAt: null,
        },
        preferences: DEFAULT_DISCORD_PREFERENCES,
        reminders: [],
        connectionAvailable: false,
        preferencesAvailable: false,
        historyAvailable: false,
      };
  const application = applicationResult.status === "fulfilled"
    ? applicationResult.value
    : null;
  const copy = connectionCopy(overview.connection.state);
  const notice = getSearchParamValue(params, "notice");
  const error = getSearchParamValue(params, "error");
  const timezoneOptions = TIMEZONES.includes(
    overview.preferences.timezone as (typeof TIMEZONES)[number],
  )
    ? TIMEZONES
    : [overview.preferences.timezone, ...TIMEZONES];
  const canTest = overview.connection.state === "connected" &&
    overview.preferences.dmOptIn &&
    overview.preferences.topics.account;
  let inviteUrl: string | null = null;
  try {
    inviteUrl = getDiscordGuildInviteUrl();
  } catch {
    // A malformed optional invite must not prevent creators from reconnecting.
  }

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link className="application-edit-button" href="/account">Back to account</Link>
      </header>

      <section className="discord-settings-layout">
        <aside className="discord-settings-intro">
          <p className="eyebrow">Account settings</p>
          <h1>Discord and reminders</h1>
          <p>
            Verify who you are on Discord, choose which direct messages are useful,
            and see the actual delivery record.
          </p>

          <section className="application-identity-note" aria-labelledby="application-discord-title">
            <span>Application entry</span>
            <h2 id="application-discord-title">
              {application?.discordUsername ?? "No username available"}
            </h2>
            <p>
              This is the free-text username supplied with your application. It is not a verified Discord identity.
            </p>
          </section>
        </aside>

        <div className="discord-settings-stack">
          {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}
          {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}

          <section className="settings-panel" aria-labelledby="discord-connection-title">
            <div className="settings-panel__header">
              <div>
                <p className="eyebrow">Connection</p>
                <h2 id="discord-connection-title">{copy.title}</h2>
                <p>{copy.body}</p>
              </div>
              <span className={`connection-state connection-state--${overview.connection.state}`} role="status">
                {overview.connection.state === "connected" ? <Check aria-hidden="true" size={13} /> : <CircleAlert aria-hidden="true" size={13} />}
                {copy.label}
              </span>
            </div>

            <DiscordIdentity
              connection={overview.connection}
              timezone={overview.preferences.timezone}
            />

            <div className="settings-panel__actions">
              <ConnectionActions connection={overview.connection} inviteUrl={inviteUrl} />
              <span><ShieldCheck aria-hidden="true" size={14} /> GoTall stores the verified identity snapshot, not your Discord password.</span>
            </div>
          </section>

          <section className="settings-panel" aria-labelledby="discord-preferences-title">
            <div className="settings-panel__header">
              <div>
                <p className="eyebrow">Preferences</p>
                <h2 id="discord-preferences-title">Direct-message controls</h2>
                <p>Discord DMs are off until you explicitly opt in. Quiet hours apply in your selected timezone.</p>
              </div>
            </div>

            {!overview.preferencesAvailable ? (
              <p className="auth-message auth-message--error" role="alert">
                Reminder preferences are temporarily unavailable. Existing settings have not been changed.
              </p>
            ) : null}

            <form className="discord-preferences-form" action="/api/integrations/discord/preferences" method="post">
              <fieldset disabled={!overview.preferencesAvailable}>
                <legend className="sr-only">Discord reminder preferences</legend>
                <label className="preference-switch preference-switch--primary">
                  <span>
                    <strong>Allow Discord direct messages</strong>
                    <small>GoTall can send only the selected reminder topics below.</small>
                  </span>
                  <input
                    defaultChecked={overview.preferences.dmOptIn}
                    name="dmOptIn"
                    type="checkbox"
                  />
                </label>

                <div className="quiet-hours-grid">
                  <label>
                    <span>Timezone</span>
                    <select defaultValue={overview.preferences.timezone} name="timezone">
                      {timezoneOptions.map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Quiet hours start</span>
                    <input defaultValue={overview.preferences.quietHoursStart} name="quietHoursStart" type="time" />
                  </label>
                  <label>
                    <span>Quiet hours end</span>
                    <input defaultValue={overview.preferences.quietHoursEnd} name="quietHoursEnd" type="time" />
                  </label>
                </div>

                <fieldset className="topic-preferences">
                  <legend>Reminder topics</legend>
                  {TOPICS.map((topic) => {
                    const descriptionId = `discord-topic-${topic.key}-description`;
                    return (
                      <label className={topic.gated ? "preference-switch preference-switch--gated" : "preference-switch"} key={topic.key}>
                        <span>
                          <strong>{topic.title}</strong>
                          <small id={descriptionId}>{topic.description}</small>
                        </span>
                        <input
                          aria-describedby={descriptionId}
                          defaultChecked={overview.preferences.topics[topic.key]}
                          disabled={topic.gated}
                          name={topic.field}
                          type="checkbox"
                        />
                      </label>
                    );
                  })}
                </fieldset>

                <div className="settings-panel__actions settings-panel__actions--save">
                  <button className="button button--ink" type="submit">Save reminder settings</button>
                  <span><Clock3 aria-hidden="true" size={14} /> Default quiet hours are 9:00 PM–9:00 AM. A message already being sent cannot be recalled.</span>
                </div>
              </fieldset>
            </form>
          </section>

          <section className="settings-panel" aria-labelledby="discord-test-title">
            <div className="settings-panel__header settings-panel__header--compact">
              <div>
                <p className="eyebrow">Delivery check</p>
                <h2 id="discord-test-title">Send one test reminder</h2>
                <p>A test is available only for a verified server member who has opted into Discord DMs. Because you request it directly, it sends even during quiet hours.</p>
              </div>
              <form action="/api/integrations/discord/test" method="post">
                <button className="button button--ghost" disabled={!canTest} type="submit">Send test</button>
              </form>
            </div>
          </section>

          <section className="settings-panel" aria-labelledby="discord-history-title">
            <div className="settings-panel__header settings-panel__header--compact">
              <div>
                <p className="eyebrow">History</p>
                <h2 id="discord-history-title">Recent reminders</h2>
                <p>Scheduled work, retries, blocks, and Discord acceptance are recorded here.</p>
              </div>
            </div>
            <ReminderHistory
              available={overview.historyAvailable}
              reminders={overview.reminders}
              timezone={overview.preferences.timezone}
            />
          </section>
        </div>
      </section>
    </main>
  );
}
