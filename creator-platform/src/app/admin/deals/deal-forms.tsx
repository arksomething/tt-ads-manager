"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type {
  AdminDealDetail,
  AdminDealEconomics,
} from "@/server/admin/deals";

import styles from "./admin-deals.module.css";

type ApiResult = {
  deal?: { id?: string };
  error?: string;
};

const proposedEconomics: AdminDealEconomics = {
  schemaVersion: 1,
  currency: "USD",
  currencyExponent: 2,
  measurementWindowSeconds: 7 * 24 * 60 * 60,
  measurementWindowAnchor: "published_at",
  paidImpressionsPolicy: "exclude_verified",
  invalidTrafficPolicy: "exclude_verified",
  fixedFeeMicros: 0,
  creatorAggregateCapMicros: null,
  minimumQualifiedViews: null,
  crossPostPolicy: null,
  paymentDueDays: null,
  minimumPayoutMicros: null,
  tiers: {
    baseline: {
      rateMicrosPerThousand: 500_000,
      perPostCapMicros: 100_000_000,
      qualification: "Accepted non-talking post",
    },
    talking: {
      rateMicrosPerThousand: 1_000_000,
      perPostCapMicros: 300_000_000,
      qualification: null,
    },
  },
};

function inputValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function nullableInteger(form: FormData, name: string) {
  const value = inputValue(form, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullableMicros(form: FormData, name: string) {
  const value = inputValue(form, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1_000_000);
}

function nullableSecondsFromDays(form: FormData, name: string) {
  const value = inputValue(form, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 24 * 60 * 60);
}

function nullableString(form: FormData, name: string) {
  return inputValue(form, name) || null;
}

function economicsFromForm(form: FormData): AdminDealEconomics {
  return {
    schemaVersion: 1,
    currency: nullableString(form, "currency"),
    currencyExponent: nullableInteger(form, "currencyExponent"),
    measurementWindowSeconds: nullableSecondsFromDays(form, "measurementWindowDays"),
    measurementWindowAnchor: nullableString(form, "measurementWindowAnchor") as AdminDealEconomics["measurementWindowAnchor"],
    paidImpressionsPolicy: nullableString(form, "paidImpressionsPolicy") as AdminDealEconomics["paidImpressionsPolicy"],
    invalidTrafficPolicy: nullableString(form, "invalidTrafficPolicy") as AdminDealEconomics["invalidTrafficPolicy"],
    fixedFeeMicros: nullableMicros(form, "fixedFee"),
    creatorAggregateCapMicros: nullableMicros(form, "creatorAggregateCap"),
    minimumQualifiedViews: nullableInteger(form, "minimumQualifiedViews"),
    crossPostPolicy: nullableString(form, "crossPostPolicy") as AdminDealEconomics["crossPostPolicy"],
    paymentDueDays: nullableInteger(form, "paymentDueDays"),
    minimumPayoutMicros: nullableMicros(form, "minimumPayout"),
    tiers: {
      baseline: {
        rateMicrosPerThousand: nullableMicros(form, "baselineRate"),
        perPostCapMicros: nullableMicros(form, "baselineCap"),
        qualification: nullableString(form, "baselineQualification"),
      },
      talking: {
        rateMicrosPerThousand: nullableMicros(form, "talkingRate"),
        perPostCapMicros: nullableMicros(form, "talkingCap"),
        qualification: nullableString(form, "talkingQualification"),
      },
    },
  };
}

function majorUnits(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value / 1_000_000);
}

function days(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value / (24 * 60 * 60));
}

function EconomicsFields({ economics }: { economics: AdminDealEconomics }) {
  return (
    <fieldset className={styles.form}>
      <legend>Structured economics · Internal draft</legend>
      <p className={styles.helper}>
        These proposed values are editable business inputs, not legal terms and not an active offer. Confirm that the signed prose matches them before sealing.
      </p>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Currency</span>
          <input name="currency" defaultValue={economics.currency ?? ""} maxLength={3} placeholder="USD" />
        </label>
        <label className={styles.field}>
          <span>Currency exponent</span>
          <input name="currencyExponent" type="number" min="0" max="6" step="1" defaultValue={economics.currencyExponent ?? ""} />
        </label>
        <label className={styles.field}>
          <span>Measurement window (days)</span>
          <input name="measurementWindowDays" type="number" min="0" step="0.5" defaultValue={days(economics.measurementWindowSeconds)} />
        </label>
        <label className={styles.field}>
          <span>Window anchor</span>
          <select name="measurementWindowAnchor" defaultValue={economics.measurementWindowAnchor ?? ""}>
            <option value="">Not decided</option>
            <option value="published_at">Published at</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Baseline CPM</span>
          <input name="baselineRate" type="number" min="0" step="0.000001" defaultValue={majorUnits(economics.tiers.baseline.rateMicrosPerThousand)} />
          <small>Major currency units per 1,000 qualified views.</small>
        </label>
        <label className={styles.field}>
          <span>Baseline per-post cap</span>
          <input name="baselineCap" type="number" min="0" step="0.01" defaultValue={majorUnits(economics.tiers.baseline.perPostCapMicros)} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>Baseline qualification</span>
          <input name="baselineQualification" defaultValue={economics.tiers.baseline.qualification ?? ""} maxLength={500} />
        </label>
        <label className={styles.field}>
          <span>Talking CPM</span>
          <input name="talkingRate" type="number" min="0" step="0.000001" defaultValue={majorUnits(economics.tiers.talking.rateMicrosPerThousand)} />
        </label>
        <label className={styles.field}>
          <span>Talking per-post cap</span>
          <input name="talkingCap" type="number" min="0" step="0.01" defaultValue={majorUnits(economics.tiers.talking.perPostCapMicros)} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>Talking qualification</span>
          <input name="talkingQualification" defaultValue={economics.tiers.talking.qualification ?? ""} maxLength={500} />
        </label>
        <label className={styles.field}>
          <span>Paid impressions</span>
          <select name="paidImpressionsPolicy" defaultValue={economics.paidImpressionsPolicy ?? ""}>
            <option value="">Not decided</option>
            <option value="include">Include</option>
            <option value="exclude_verified">Exclude verified paid impressions</option>
            <option value="exclude_all">Exclude all paid impressions</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Invalid traffic</span>
          <select name="invalidTrafficPolicy" defaultValue={economics.invalidTrafficPolicy ?? ""}>
            <option value="">Not decided</option>
            <option value="exclude_verified">Exclude verified invalid traffic</option>
            <option value="exclude_all">Exclude all suspected invalid traffic</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Fixed fee</span>
          <input name="fixedFee" type="number" min="0" step="0.01" defaultValue={majorUnits(economics.fixedFeeMicros)} />
        </label>
        <label className={styles.field}>
          <span>Creator aggregate cap</span>
          <input name="creatorAggregateCap" type="number" min="0" step="0.01" defaultValue={majorUnits(economics.creatorAggregateCapMicros)} placeholder="No aggregate cap" />
          <small>Leave blank only when this deal intentionally has no creator-level aggregate cap.</small>
        </label>
        <label className={styles.field}>
          <span>Minimum qualified views</span>
          <input name="minimumQualifiedViews" type="number" min="0" step="1" defaultValue={economics.minimumQualifiedViews ?? ""} placeholder="Not decided" />
        </label>
        <label className={styles.field}>
          <span>Cross-post policy</span>
          <select name="crossPostPolicy" defaultValue={economics.crossPostPolicy ?? ""}>
            <option value="">Not decided</option>
            <option value="separate_eligible_post">Each eligible post measured separately</option>
            <option value="single_deliverable">Cross-posts are one deliverable</option>
            <option value="campaign_brief">Set by campaign brief</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Payment due (days)</span>
          <input name="paymentDueDays" type="number" min="0" step="1" defaultValue={economics.paymentDueDays ?? ""} placeholder="Not decided" />
        </label>
        <label className={styles.field}>
          <span>Minimum payout</span>
          <input name="minimumPayout" type="number" min="0" step="0.01" defaultValue={majorUnits(economics.minimumPayoutMicros)} placeholder="Not decided" />
        </label>
      </div>
    </fieldset>
  );
}

async function jsonResult(response: Response) {
  return (await response.json().catch(() => null)) as ApiResult | null;
}

export function NewDealDraftForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/admin/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealKey: inputValue(form, "dealKey"),
          label: inputValue(form, "label"),
          termsMarkdown: inputValue(form, "termsMarkdown"),
          economics: economicsFromForm(form),
          changeNote: nullableString(form, "changeNote"),
        }),
      });
      const result = await jsonResult(response);
      if (!response.ok || !result?.deal?.id) {
        setError(result?.error ?? "The draft could not be created.");
        return;
      }
      router.push(`/admin/deals/${result.deal.id}`);
      router.refresh();
    } catch {
      setError("The deal service could not be reached. No draft creation is being claimed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.warning}>
        <strong>Draft · Not ready to activate</strong>
        Drafts are internal and non-binding. Saving does not activate or assign this version.
      </p>
      <label className={styles.field}>
        <span>Deal key</span>
        <input name="dealKey" minLength={2} maxLength={80} placeholder="standard-creator" required />
        <small>Stable internal family name. A new draft receives the next version.</small>
      </label>
      <label className={styles.field}>
        <span>Internal label</span>
        <input name="label" minLength={2} maxLength={120} placeholder="Standard creator agreement" required />
      </label>
      <label className={styles.field}>
        <span>Legal terms</span>
        <textarea className={styles.termsInput} name="termsMarkdown" defaultValue="" placeholder="Start with blank terms. Draft the reviewed agreement here; the public sample cannot be imported." required />
      </label>
      <EconomicsFields economics={proposedEconomics} />
      <label className={styles.field}>
        <span>Change note</span>
        <textarea name="changeNote" maxLength={2_000} placeholder="Why is this draft being created?" />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.formActions}>
        <button className={styles.button} disabled={saving} type="submit">
          {saving ? "Creating…" : "Create internal draft"}
        </button>
      </div>
    </form>
  );
}

export function EditDealDraftForm({ deal }: { deal: AdminDealDetail }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/admin/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: deal.draftRevision,
          label: inputValue(form, "label"),
          termsMarkdown: inputValue(form, "termsMarkdown"),
          economics: economicsFromForm(form),
          changeNote: nullableString(form, "changeNote"),
        }),
      });
      const result = await jsonResult(response);
      if (!response.ok) {
        setError(result?.error ?? "The draft could not be saved.");
        return;
      }
      setNotice("Draft revision saved. It remains internal, non-binding, and unassigned.");
      router.refresh();
    } catch {
      setError("The deal service could not be reached. No saved revision is being claimed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.warning}>
        <strong>Draft · Not ready to activate</strong>
        Drafts are internal and non-binding. Saving does not activate or assign this version.
      </p>
      <label className={styles.field}>
        <span>Internal label</span>
        <input name="label" defaultValue={deal.label} minLength={2} maxLength={120} required />
      </label>
      <label className={styles.field}>
        <span>Exact legal terms</span>
        <textarea className={styles.termsInput} name="termsMarkdown" defaultValue={deal.termsMarkdown} placeholder="No legal terms recorded." required />
      </label>
      <EconomicsFields economics={deal.economics ?? proposedEconomics} />
      <label className={styles.field}>
        <span>Change note</span>
        <textarea name="changeNote" defaultValue={deal.changeNote ?? ""} maxLength={2_000} placeholder="Describe this revision for the audit trail." />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
      <div className={styles.formActions}>
        <button className={styles.button} disabled={saving} type="submit">
          {saving ? "Saving…" : "Save draft revision"}
        </button>
      </div>
    </form>
  );
}

export function SealDealDraftForm({ deal }: { deal: AdminDealDetail }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/deals/${deal.id}/seal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: deal.draftRevision }),
      });
      const result = await jsonResult(response);
      if (!response.ok) {
        setError(result?.error ?? "The draft could not be sealed.");
        return;
      }
      setNotice("Version sealed. It is immutable, but it is not active, assigned, or available for signing.");
      router.refresh();
    } catch {
      setError("The deal service could not be reached. No sealed state is being claimed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.sealBox} onSubmit={submit}>
      <h3>Seal this exact version</h3>
      <p>
        Sealing freezes the legal terms and structured economics at their current hashes. It does not activate, assign, or send the deal.
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
      <button className={styles.buttonSecondary} disabled={saving} type="submit">
        {saving ? "Sealing…" : "Seal immutable version"}
      </button>
    </form>
  );
}
