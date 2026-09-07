import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type {
  AdminDealDetail,
  AdminDealEconomics,
  AdminDealVersion,
} from "@/server/admin/deals";

import styles from "./admin-deals.module.css";

export function dealState(deal: AdminDealVersion) {
  if (deal.status === "draft") {
    return { label: "Draft · Not ready to activate", tone: "warn" as const };
  }
  if (deal.status === "retired") {
    return { label: "Retired · Existing assignments remain valid", tone: "muted" as const };
  }
  if (deal.status === "active" && deal.isDefault) {
    return { label: "Default for new approvals", tone: "ok" as const };
  }
  if (deal.status === "active") {
    return { label: "Active · Not assigned by default", tone: "muted" as const };
  }
  if (deal.activationReady) {
    return { label: "Ready to activate", tone: "ok" as const };
  }
  if (deal.readinessBlockers.some((blocker) => blocker.toLowerCase().includes("template"))) {
    return {
      label: "Signing blocked · Template does not match this version",
      tone: "danger" as const,
    };
  }
  return { label: "Signing blocked · Readiness checks incomplete", tone: "warn" as const };
}

export function DealStateBadge({ deal }: { deal: AdminDealVersion }) {
  const state = dealState(deal);
  return <span className={styles.badge} data-tone={state.tone}>{state.label}</span>;
}

export function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function amount(value: number | null, currency: string | null) {
  if (value === null) return "Not decided";
  const major = value / 1_000_000;
  if (currency && /^[A-Z]{3}$/u.test(currency)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 6,
    }).format(major);
  }
  return `${major.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${currency ?? "units"}`;
}

function label(value: string | null) {
  if (!value) return "Not decided";
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function EconomicsSummary({ economics }: { economics: AdminDealEconomics | null }) {
  if (!economics) {
    return <p className={styles.emptyTerms}>No structured economics are recorded for this version.</p>;
  }
  const days = economics.measurementWindowSeconds === null
    ? "Not decided"
    : `${economics.measurementWindowSeconds / 86_400} days`;
  const fields = [
    ["Currency", economics.currency ?? "Not decided"],
    ["Measurement window", days],
    ["Baseline CPM", amount(economics.tiers.baseline.rateMicrosPerThousand, economics.currency)],
    ["Baseline post cap", amount(economics.tiers.baseline.perPostCapMicros, economics.currency)],
    ["Talking CPM", amount(economics.tiers.talking.rateMicrosPerThousand, economics.currency)],
    ["Talking post cap", amount(economics.tiers.talking.perPostCapMicros, economics.currency)],
    ["Paid impressions", label(economics.paidImpressionsPolicy)],
    ["Invalid traffic", label(economics.invalidTrafficPolicy)],
    ["Cross-post policy", label(economics.crossPostPolicy)],
    ["Payment due", economics.paymentDueDays === null ? "Not decided" : `${economics.paymentDueDays} days`],
    ["Minimum payout", amount(economics.minimumPayoutMicros, economics.currency)],
    [
      "Creator aggregate cap",
      economics.creatorAggregateCapMicros === null
        ? "No aggregate cap"
        : amount(economics.creatorAggregateCapMicros, economics.currency),
    ],
  ];

  return (
    <div className={styles.economicsGrid}>
      {fields.map(([name, value]) => (
        <div key={name}><span>{name}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
}

const releaseGateCoverage = [
  "Contracting entity and creator eligibility, including minors",
  "Payment timing, measurement cutoff, disputes, and missing-data treatment",
  "Ownership, paid-ad rights, termination, and governing law",
  "Structured economics reconciled against the exact legal prose",
  "No unresolved placeholders or drafting instructions",
  "Recorded legal-review approval and reference",
  "Exact provider-template hash bound to this version",
  "Webhook verification, signed-document archive, and send gates",
];

export function ReadinessPanel({ deal }: { deal: AdminDealDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="readiness-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="readiness-title">Release readiness</h2>
          <p>No control here activates or sends this deal.</p>
        </div>
        <DealStateBadge deal={deal} />
      </header>
      <div className={styles.panelBody}>
        <h3>{deal.readinessBlockers.length ? "Current blockers" : "Recorded checks pass"}</h3>
        {deal.readinessBlockers.length ? (
          <ul className={styles.checklist} aria-label="Current readiness blockers">
            {deal.readinessBlockers.map((blocker) => (
              <li key={blocker}><AlertTriangle aria-hidden="true" size={13} /><span>{blocker}</span></li>
            ))}
          </ul>
        ) : (
          <p className={styles.success}>No current readiness blocker was returned for this sealed version. Activation remains a separate, unavailable operation.</p>
        )}
        <h3>Gate coverage</h3>
        <ul className={styles.checklist} aria-label="Release gate coverage">
          {releaseGateCoverage.map((item) => (
            <li key={item}>
              <CheckCircle2 aria-hidden="true" data-clear={deal.activationReady} size={13} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
