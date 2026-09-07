import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AgreementTerms } from "@/components/agreement-terms";
import { BrandMark } from "@/components/brand-mark";
import { CreatorOnboardingProgress } from "@/components/creator-onboarding";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { getSignWellReadiness } from "@/lib/agreements/signwell";
import { deriveCreatorOnboardingViewModel } from "@/lib/creator-onboarding";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  getOwnAgreementSigningContext,
  getOwnAssignedDealVersion,
  isAgreementProvisioningLeaseExpired,
} from "@/server/accounts/agreement";
import { getCreatorAccountState } from "@/server/accounts/state";
import { getCurrentAccount } from "@/server/auth/session";

import styles from "./agreement.module.css";

export const metadata: Metadata = {
  title: "Creator agreement",
};

export const dynamic = "force-dynamic";

type AgreementPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function statusLabel(value: string | null | undefined) {
  if (!value) return "Preparing";
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export default async function AgreementPage({ searchParams }: AgreementPageProps) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");

  const account = await getCurrentAccount();
  if (!account) redirect("/auth/sign-in?next=%2Fonboarding%2Fagreement");

  const state = await getCreatorAccountState();
  if (state.nextPath === "/apply") redirect("/apply");
  if (state.nextPath === "/application/status") redirect("/application/status");
  if (state.nextPath === "/onboarding/accounts") redirect("/onboarding/accounts");

  const complete = state.agreementState === "completed";
  const [contextResult, params] = await Promise.all([
    getOwnAgreementSigningContext().then(
      (value) => ({ value, error: false as const }),
      () => ({ value: null, error: true as const }),
    ),
    searchParams,
  ]);
  const agreement = contextResult.value;
  const dealResult = agreement
    ? await getOwnAssignedDealVersion(agreement.dealVersionId).then(
        (value) => ({ value, error: false as const }),
        () => ({ value: null, error: true as const }),
      )
    : { value: null, error: false as const };
  const deal = dealResult.value;
  const readiness = getSignWellReadiness();
  const verifiedBindingReady = Boolean(
    agreement?.verifiedProviderTemplateId
    && agreement.verifiedDealSnapshotSha256,
  );
  const notice = getSearchParamValue(params, "notice");
  const error = getSearchParamValue(params, "error");
  const onboarding = deriveCreatorOnboardingViewModel({
    nextPath: state.nextPath,
    stateAvailable: Boolean(state.nextPath),
    applicationStatus: state.applicationState,
    agreementStatus: state.agreementState ?? agreement?.status,
    agreementReadyToSend: readiness.readyToSend && verifiedBindingReady,
  });
  const agreementStatus = complete
    ? "completed"
    : agreement?.status ?? state.agreementState ?? null;
  const expiredPreparation = agreementStatus === "preparing"
    && isAgreementProvisioningLeaseExpired(agreement?.provisioningStartedAt);
  const canPrepare = Boolean(
    agreement
    && deal
    && readiness.readyToSend
    && verifiedBindingReady
    && (
      ["assigned", "pending", "error"].includes(agreementStatus ?? "")
      || expiredPreparation
    ),
  );
  const canContinue = Boolean(
    agreement
    && deal
    && readiness.readyToSend
    && agreement.externalAgreementId
    && agreement.providerTemplateId
    && agreement.dealSnapshotSha256
    && agreement.verifiedProviderTemplateId
    && agreement.verifiedDealSnapshotSha256
    && agreement.providerTemplateId === agreement.verifiedProviderTemplateId
    && agreement.dealSnapshotSha256 === agreement.verifiedDealSnapshotSha256
    && ["sent", "viewed"].includes(agreementStatus ?? ""),
  );
  const confirmationPending = agreementStatus === "creator_accepted";
  const preparationPending = agreementStatus === "preparing" && !expiredPreparation;
  const cannotComplete = agreementStatus === "declined" || agreementStatus === "voided";

  return (
    <main className="account-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link href="/account">Your account</Link>
      </header>

      <section className={styles.shell}>
        <CreatorOnboardingProgress steps={onboarding.steps} />

        <header className={styles.intro}>
          <span>Step 4 of 4 · Creator agreement</span>
          <h1>{complete ? "Your agreement is complete" : "Review your creator agreement"}</h1>
          <p>
            {complete
              ? "Your creator workspace is active because verified completion evidence is attached to this account."
              : "Read the exact assigned terms here, then continue to SignWell to complete the signature."}
          </p>
        </header>

        <article className={styles.review} aria-labelledby="agreement-status-title">
          <header className={styles.reviewHeader}>
            <div>
              <span>Assigned document</span>
              <h2 id="agreement-status-title">
                {deal ? `${deal.label} · Version ${deal.version}` : "Creator agreement"}
              </h2>
              <p>{complete ? "Completed and verified" : "Prepared specifically for this creator account"}</p>
            </div>
            <span className={styles.status}>{complete ? "Completed" : statusLabel(agreementStatus)}</span>
          </header>

          {notice || error || contextResult.error || dealResult.error ? (
            <div className={styles.messages}>
              {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}
              {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}
              {contextResult.error ? <p className="auth-message auth-message--error" role="alert">Your agreement assignment is temporarily unavailable.</p> : null}
              {dealResult.error ? <p className="auth-message auth-message--error" role="alert">The assigned deal terms could not be loaded. Do not sign until they are visible.</p> : null}
            </div>
          ) : null}

          <dl className={styles.meta}>
            <div><dt>Prepared for</dt><dd>{agreement?.signerName ?? "Not assigned"}</dd></div>
            <div><dt>Signing email</dt><dd>{agreement?.signerEmail ?? account.email ?? "Unavailable"}</dd></div>
            <div>
              <dt>Signing mode</dt>
              <dd>
                {!readiness.readyToSend || !verifiedBindingReady
                  ? "Not released"
                  : readiness.testMode
                    ? "Test document"
                    : "Approved live document"}
              </dd>
            </div>
          </dl>

          <section className={styles.assignedTerms} aria-labelledby="assigned-terms-title">
            <div className={styles.sectionHeading}>
              <span>Exact assigned version</span>
              <h3 id="assigned-terms-title">Agreement terms</h3>
              <p>These are the immutable terms assigned to this account. Generic sample economics are intentionally kept off this signing screen.</p>
            </div>
            {deal ? (
              <div className={styles.assignedTermsBody}>
                <AgreementTerms headingOffset={3} markdown={deal.termsMarkdown} />
              </div>
            ) : (
              <p className={styles.lockedTerms}>
                No assigned terms are available to display. Signing stays locked until an approved deal version is assigned and visible.
              </p>
            )}
          </section>

          <section className={styles.signing} aria-labelledby="signing-title">
            <div className={styles.sectionHeading}>
              <span>Secure signature</span>
              <h3 id="signing-title">Finish with SignWell</h3>
            </div>
            <p>
              {confirmationPending
                ? "Your signing step has been submitted. The workspace remains locked until the completed document and its archived evidence are confirmed."
                : cannotComplete
                  ? "This document can’t be completed from its current state. Use the program contact who sent your invitation for assistance."
                  : expiredPreparation
                    ? "The previous preparation attempt did not finish within ten minutes. Retry safely to resume the known document or start a new leased attempt."
                  : preparationPending
                    ? "The provider document is being prepared. Refresh this page for the latest state; a second document will not be created."
                    : "Nothing is signed until you complete the signature step. Your workspace unlocks only after SignWell completion and the signed artifact are independently confirmed."}
            </p>
            <div className={styles.actions}>
              {complete ? (
                <Link className="button button--ink button--large" href="/account">Open creator workspace</Link>
              ) : canPrepare || canContinue ? (
                <form action="/api/agreements/signwell/open" method="post">
                  <button className="button button--ink button--large" type="submit">
                    {canContinue
                      ? "Continue to signature"
                      : agreementStatus === "error" || expiredPreparation
                        ? "Retry agreement preparation"
                        : "Prepare and review agreement"}
                  </button>
                </form>
              ) : confirmationPending || preparationPending ? (
                <Link className="button button--ghost button--large" href="/onboarding/agreement">Refresh status</Link>
              ) : cannotComplete ? (
                <Link className="button button--ghost button--large" href="/account">Back to account</Link>
              ) : (
                <span className={styles.waiting}>Signature access is locked until the assigned terms and approved provider template are ready.</span>
              )}
              <Link className={styles.buttonLink} href="/standard-agreement">Read the non-binding sample</Link>
              {!complete && !cannotComplete ? <Link className={styles.buttonLink} href="/account">Back to account</Link> : null}
            </div>
          </section>
        </article>
      </section>
    </main>
  );
}
