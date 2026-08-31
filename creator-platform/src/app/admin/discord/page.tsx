import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Link2,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  getCurrentDiscordStaffMembership,
  getDiscordOperationsConfiguration,
  getDiscordOperationsOverview,
  type DiscordDeliveryFailure,
  type DiscordOperationsOverview,
  type DiscordWorkerHealth,
} from "@/server/admin/discord";
import { getCurrentAccount } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Discord operations",
  description: "Read-only health and delivery status for creator Discord operations.",
};

export const dynamic = "force-dynamic";

function number(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function duration(seconds: number | null) {
  if (seconds === null) return "Not recorded";
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr`;
  return `${Math.floor(seconds / 86_400)} day`;
}

function timestamp(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function StatusMark({
  ok,
  label: statusLabel,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span className={`discord-admin-status ${ok ? "discord-admin-status--ok" : "discord-admin-status--warn"}`}>
      {ok ? <CheckCircle2 aria-hidden="true" size={13} /> : <CircleAlert aria-hidden="true" size={13} />}
      {statusLabel}
    </span>
  );
}

function WorkerPanel({ worker }: { worker: DiscordWorkerHealth }) {
  const healthy = worker.state === "healthy";
  const title = worker.state === "unavailable"
    ? "No heartbeat recorded"
    : worker.state === "stale"
      ? "Worker heartbeat is stale"
      : worker.state === "draining"
        ? "Worker is draining"
        : worker.state === "degraded"
          ? "Worker reports degraded"
          : "Worker heartbeat is fresh";

  return (
    <section className="discord-admin-panel discord-admin-worker" aria-labelledby="discord-worker-title">
      <div className="discord-admin-panel__header">
        <div>
          <p className="eyebrow">Delivery worker</p>
          <h2 id="discord-worker-title">{title}</h2>
        </div>
        <StatusMark ok={healthy} label={label(worker.state)} />
      </div>

      <dl className="discord-admin-detail-grid">
        <div>
          <dt>Heartbeat age</dt>
          <dd>{duration(worker.ageSeconds)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{timestamp(worker.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{worker.version ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Reported queue depth</dt>
          <dd>{worker.queueDepth === null ? "Not reported" : number(worker.queueDepth)}</dd>
        </div>
      </dl>

      <p className="discord-admin-note">
        A fresh heartbeat proves the deterministic delivery worker recently reached the account system. It does not prove that Discord accepted every message.
      </p>
    </section>
  );
}

function QueuePanel({ overview }: { overview: DiscordOperationsOverview }) {
  const { queue } = overview;
  const metrics = [
    ["Actionable", queue.actionable],
    ["Scheduled", queue.scheduled],
    ["Leased", queue.leased],
    ["Sending", queue.sending],
    ["Retry", queue.retry],
    ["Unknown delivery", queue.deliveryUnknown],
    ["Blocked", queue.blocked],
    ["Dead", queue.dead],
    ["Sent", queue.sent],
  ] as const;

  return (
    <section className="discord-admin-panel" aria-labelledby="discord-queue-title">
      <div className="discord-admin-panel__header">
        <div>
          <p className="eyebrow">Reminder queue</p>
          <h2 id="discord-queue-title">Durable delivery states</h2>
        </div>
        <span className="discord-admin-age">
          <Clock3 aria-hidden="true" size={13} />
          {queue.actionable
            ? `Oldest actionable ${duration(queue.oldestAgeSeconds)} ago`
            : "No actionable delivery"}
        </span>
      </div>

      <dl className="discord-admin-metric-grid">
        {metrics.map(([metricLabel, value]) => (
          <div key={metricLabel}>
            <dt>{metricLabel}</dt>
            <dd>{number(value)}</dd>
          </div>
        ))}
      </dl>
      {queue.actionable ? (
        <p className="discord-admin-note">Oldest available time: {timestamp(queue.oldestActionableAt)}.</p>
      ) : null}
    </section>
  );
}

function ConnectionAndRolePanels({ overview }: { overview: DiscordOperationsOverview }) {
  const { connections, roleSync } = overview;
  return (
    <div className="discord-admin-two-column">
      <section className="discord-admin-panel" aria-labelledby="discord-connections-title">
        <div className="discord-admin-panel__header discord-admin-panel__header--compact">
          <div>
            <p className="eyebrow">Connections</p>
            <h2 id="discord-connections-title">Creator identity coverage</h2>
          </div>
          <Users aria-hidden="true" size={18} />
        </div>
        <dl className="discord-admin-list">
          <div><dt>Active links</dt><dd>{number(connections.linked)}</dd></div>
          <div><dt>Members at last check</dt><dd>{number(connections.members)}</dd></div>
          <div><dt>DM blocked</dt><dd>{number(connections.dmBlocked)}</dd></div>
          <div><dt>DM channel not established</dt><dd>{number(connections.dmChannelPending)}</dd></div>
        </dl>
        <p className="discord-admin-note">Guild membership is rechecked immediately before every direct message. A missing DM channel is not labeled blocked until Discord returns the dedicated DM-blocked result.</p>
      </section>

      <section className="discord-admin-panel" aria-labelledby="discord-role-sync-title">
        <div className="discord-admin-panel__header discord-admin-panel__header--compact">
          <div>
            <p className="eyebrow">Managed roles</p>
            <h2 id="discord-role-sync-title">Role reconciliation</h2>
          </div>
          <ShieldCheck aria-hidden="true" size={18} />
        </div>
        <dl className="discord-admin-list">
          <div><dt>Queued</dt><dd>{number(roleSync.queued)}</dd></div>
          <div><dt>Scheduled / leased / retry</dt><dd>{number(roleSync.scheduled)} / {number(roleSync.leased)} / {number(roleSync.retry)}</dd></div>
          <div><dt>Completed</dt><dd>{number(roleSync.completed)}</dd></div>
          <div><dt>Failures</dt><dd>{number(roleSync.failures)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function FailureRow({ failure }: { failure: DiscordDeliveryFailure }) {
  return (
    <tr>
      <td><span className={`discord-admin-failure-state discord-admin-failure-state--${failure.deliveryState}`}>{label(failure.deliveryState)}</span></td>
      <td>{failure.errorCode}</td>
      <td>{failure.providerStatus ?? "—"}</td>
      <td>{failure.attemptNumber ?? "—"}</td>
      <td><time dateTime={failure.attemptedAt ?? undefined}>{timestamp(failure.attemptedAt)}</time></td>
    </tr>
  );
}

function FailuresPanel({ failures }: { failures: DiscordDeliveryFailure[] }) {
  return (
    <section className="discord-admin-panel" aria-labelledby="discord-failures-title">
      <div className="discord-admin-panel__header">
        <div>
          <p className="eyebrow">Diagnostics</p>
          <h2 id="discord-failures-title">Recent sanitized delivery failures</h2>
          <p>Error classes and provider statuses only. Message contents, creator identities, credentials, and raw provider responses are never exposed here.</p>
        </div>
        <Activity aria-hidden="true" size={18} />
      </div>

      {failures.length ? (
        <div className="discord-admin-table-scroll">
          <table className="discord-admin-table">
            <thead><tr><th>State</th><th>Error class</th><th>HTTP</th><th>Attempt</th><th>Recorded</th></tr></thead>
            <tbody>{failures.map((failure, index) => <FailureRow key={`${failure.attemptedAt ?? "unknown"}-${index}`} failure={failure} />)}</tbody>
          </table>
        </div>
      ) : (
        <p className="discord-admin-empty">No recent retry, blocked, unknown-delivery, or dead attempts were returned.</p>
      )}
    </section>
  );
}

export default async function DiscordAdminPage() {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fadmin%2Fdiscord");

  const staff = await getCurrentDiscordStaffMembership().catch(() => null);
  if (!staff) redirect("/account");

  const configuration = getDiscordOperationsConfiguration();
  const overview = await getDiscordOperationsOverview().catch(() => null);

  return (
    <main className="discord-admin-page">
      <header className="discord-admin-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator operations</span></Link>
        <div>
          <span className="discord-admin-readonly"><LockKeyhole aria-hidden="true" size={12} />Read only</span>
          <Link className="discord-admin-back" href="/account"><ArrowLeft aria-hidden="true" size={14} />Account</Link>
        </div>
      </header>

      <div className="discord-admin-shell">
        <section className="discord-admin-title">
          <div>
            <p className="eyebrow">Discord operations</p>
            <h1>Identity, reminders, and worker health.</h1>
            <p>Operational truth from the creator account database. This first staff view cannot send messages, change roles, or mutate the queue.</p>
          </div>
          <span>{label(staff.role)} access</span>
        </section>

        <section className="discord-admin-config" aria-label="Discord integration configuration">
          <article>
            <Link2 aria-hidden="true" size={18} />
            <div><strong>OAuth configuration</strong><span>Required server-side settings</span></div>
            <StatusMark ok={configuration.oauthConfigured} label={configuration.oauthConfigured ? "Configured" : "Unavailable"} />
          </article>
          <article>
            <Bot aria-hidden="true" size={18} />
            <div><strong>Callback path</strong><span>Supported redirect endpoint</span></div>
            <StatusMark ok={configuration.callbackConfigured} label={configuration.callbackConfigured ? "Configured" : "Unavailable"} />
          </article>
        </section>

        {overview ? (
          <div className="discord-admin-stack">
            <WorkerPanel worker={overview.worker} />
            <QueuePanel overview={overview} />
            <ConnectionAndRolePanels overview={overview} />
            <FailuresPanel failures={overview.recentFailures} />
          </div>
        ) : (
          <section className="discord-admin-panel discord-admin-unavailable" role="alert">
            <CircleAlert aria-hidden="true" size={20} />
            <div>
              <h2>Operations data is unavailable</h2>
              <p>The staff access check passed, but the read-only operations snapshot could not be loaded. No queue, worker, connection, or delivery-health claim is being made.</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
