"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import {
  CREATOR_APPLICATION_PLATFORMS,
  findDuplicateCreatorAccountIndex,
  PROGRAM_DEFAULT_DEAL,
  type CreatorApplicationInput,
  type CreatorApplicationPlatform,
} from "@/lib/creator-application";

type ApplicationStep = "details" | "review" | "complete";

type AccountRow = {
  id: number;
  platform: CreatorApplicationPlatform;
  handle: string;
};

type IdentityFields = Pick<
  CreatorApplicationInput,
  "name" | "phoneNumber" | "discordUsername"
>;

function platformLabel(value: CreatorApplicationPlatform) {
  return CREATOR_APPLICATION_PLATFORMS.find((platform) => platform.value === value)?.label ?? value;
}

function DefaultDealCard({ titleId }: { titleId: string }) {
  return (
    <section className="application-default-deal" aria-labelledby={titleId}>
      <LockKeyhole aria-hidden="true" size={18} />
      <div>
        <span>Assigned automatically</span>
        <strong id={titleId}>{PROGRAM_DEFAULT_DEAL.label}</strong>
        <p>If accepted, you will review the exact standard-deal version assigned before onboarding. No agreement is active until those terms are available to you.</p>
      </div>
    </section>
  );
}

export function ApplicationPreviewForm({ accountEmail }: { accountEmail?: string | null }) {
  const [step, setStep] = useState<ApplicationStep>("details");
  const [identity, setIdentity] = useState<IdentityFields>({
    name: "",
    phoneNumber: "",
    discordUsername: "",
  });
  const [accounts, setAccounts] = useState<AccountRow[]>([
    { id: 1, platform: "TIKTOK", handle: "" },
  ]);
  const [reviewDraft, setReviewDraft] = useState<CreatorApplicationInput | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [invalidAccountId, setInvalidAccountId] = useState<number | null>(null);
  const [accountAnnouncement, setAccountAnnouncement] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nextAccountId = useRef(2);
  const pendingFocus = useRef<ApplicationStep | number | null>(null);
  const handleRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const resetValidation = () => {
    setAccountError(null);
    setInvalidAccountId(null);
  };

  const transitionTo = (nextStep: ApplicationStep) => {
    pendingFocus.current = nextStep;
    setStep(nextStep);
  };

  const focusStepHeading = (targetStep: ApplicationStep) => (node: HTMLHeadingElement | null) => {
    if (node && pendingFocus.current === targetStep) {
      node.focus();
      pendingFocus.current = null;
    }
  };

  const updateIdentity = (field: keyof IdentityFields, value: string) => {
    setIdentity((current) => ({ ...current, [field]: value }));
    resetValidation();
  };

  const addAccount = () => {
    const id = nextAccountId.current;
    nextAccountId.current += 1;
    pendingFocus.current = id;
    setAccounts((current) => [
      ...current,
      { id, platform: "TIKTOK", handle: "" },
    ]);
    setAccountAnnouncement("Creator account added.");
    resetValidation();
  };

  const removeAccount = (id: number) => {
    if (accounts.length === 1) return;

    const removedIndex = accounts.findIndex((account) => account.id === id);
    const nextAccounts = accounts.filter((account) => account.id !== id);
    const nextFocusIndex = Math.max(0, Math.min(removedIndex - 1, nextAccounts.length - 1));

    setAccounts(nextAccounts);
    setAccountAnnouncement("Creator account removed.");
    handleRefs.current[nextAccounts[nextFocusIndex].id]?.focus();
    resetValidation();
  };

  const updateAccount = (
    id: number,
    field: "platform" | "handle",
    value: string,
  ) => {
    setAccounts((current) =>
      current.map((account) =>
        account.id === id
          ? {
              ...account,
              [field]: value,
            }
          : account,
      ) as AccountRow[],
    );
    resetValidation();
  };

  const reviewApplication = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const duplicateIndex = findDuplicateCreatorAccountIndex(accounts);
    if (duplicateIndex >= 0) {
      const duplicate = accounts[duplicateIndex];
      setAccountError("That platform and handle are already listed.");
      setInvalidAccountId(duplicate.id);
      handleRefs.current[duplicate.id]?.focus();
      return;
    }

    const draft: CreatorApplicationInput = {
      name: identity.name.trim(),
      phoneNumber: identity.phoneNumber.trim(),
      discordUsername: identity.discordUsername.trim(),
      accounts: accounts.map(({ platform, handle }) => ({
        platform,
        handle: handle.trim(),
      })),
    };

    resetValidation();
    setReviewDraft(draft);
    transitionTo("review");
  };

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!reviewDraft || submitting) return;

    setSubmissionError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reviewDraft),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setSubmissionError(
          result?.error ?? "We could not submit the application. Please try again.",
        );
        return;
      }

      transitionTo("complete");
    } catch {
      setSubmissionError("We could not reach the application service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const editDetails = () => {
    transitionTo("details");
  };

  if (step === "complete") {
    return (
      <section className="application-form application-complete" role="status" aria-labelledby="application-complete-title">
        <div className="application-complete__icon"><Check aria-hidden="true" size={22} /></div>
        <p className="eyebrow">Application submitted</p>
        <h2 id="application-complete-title" ref={focusStepHeading("complete")} tabIndex={-1}>Your application is with the creator team.</h2>
        <p>
          You can return to your account at any time to see the current review and onboarding state.
        </p>
        <div className="application-complete__next">
          <ClipboardCheck aria-hidden="true" size={18} />
          <div>
            <strong>Agreement comes after approval</strong>
            <span>If accepted, you will review and sign the standard creator agreement during onboarding.</span>
          </div>
        </div>
        <div className="application-complete__actions">
          <Link className="button button--ghost" href="/">Return to creator program</Link>
          <Link className="button button--ink" href="/account">Open account <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
      </section>
    );
  }

  return (
    <form
      className="application-form"
      onSubmit={step === "details" ? reviewApplication : submitApplication}
    >
      <ol className="application-progress" aria-label="Application progress">
        <li data-state={step === "details" ? "current" : "complete"}><span>1</span> Details</li>
        <li data-state={step === "review" ? "current" : "upcoming"}><span>2</span> Review</li>
      </ol>

      {step === "details" ? (
        <>
          <DefaultDealCard titleId="default-deal-title" />

          {accountEmail ? (
            <div className="application-account-email">
              <span>Signed in as</span>
              <strong>{accountEmail}</strong>
            </div>
          ) : null}

          <div className="application-fields">
            <label>
              <span>Name</span>
              <input
                ref={(node) => {
                  if (node && pendingFocus.current === "details") {
                    node.focus();
                    pendingFocus.current = null;
                  }
                }}
                name="name"
                autoComplete="name"
                placeholder="Your name"
                value={identity.name}
                required
                onChange={(event) => updateIdentity("name", event.target.value)}
              />
            </label>
            <label>
              <span>Phone number</span>
              <input
                name="phoneNumber"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+1 555 555 0123"
                value={identity.phoneNumber}
                required
                onChange={(event) => updateIdentity("phoneNumber", event.target.value)}
              />
            </label>
            <label className="application-fields__wide">
              <span>Discord username</span>
              <input
                name="discordUsername"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="yourusername"
                value={identity.discordUsername}
                required
                onChange={(event) => updateIdentity("discordUsername", event.target.value)}
              />
            </label>
          </div>

          <fieldset className="creator-accounts">
            <legend>Creator accounts</legend>
            <p>Add every TikTok and Instagram handle you want connected to your creator profile.</p>

            <div className="creator-account-list">
              {accounts.map((account, index) => {
                const accountNumber = index + 1;
                const labelId = `creator-account-${account.id}-label`;
                const errorId = `creator-account-${account.id}-error`;
                const isInvalid = invalidAccountId === account.id;

                return (
                  <div className="creator-account-row" role="group" aria-labelledby={labelId} key={account.id}>
                    <div className="creator-account-row__header">
                      <strong id={labelId}>Account {accountNumber}</strong>
                      {accounts.length > 1 ? (
                        <button type="button" onClick={() => removeAccount(account.id)} aria-label={`Remove account ${accountNumber}`}>
                          <Trash2 aria-hidden="true" size={14} /> Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="creator-account-row__fields">
                      <label htmlFor={`creator-account-${account.id}-platform`}>
                        <span>Platform</span>
                        <select
                          id={`creator-account-${account.id}-platform`}
                          name={`accounts[${index}][platform]`}
                          aria-label={`Platform ${accountNumber}`}
                          value={account.platform}
                          onChange={(event) => updateAccount(account.id, "platform", event.target.value)}
                          required
                        >
                          {CREATOR_APPLICATION_PLATFORMS.map((platform) => (
                            <option value={platform.value} key={platform.value}>{platform.label}</option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={`creator-account-${account.id}-handle`}>
                        <span>Creator handle</span>
                        <input
                          ref={(node) => {
                            handleRefs.current[account.id] = node;
                            if (node && pendingFocus.current === account.id) {
                              node.focus();
                              pendingFocus.current = null;
                            }
                          }}
                          id={`creator-account-${account.id}-handle`}
                          name={`accounts[${index}][handle]`}
                          aria-label={`Creator handle ${accountNumber}`}
                          aria-invalid={isInvalid || undefined}
                          aria-describedby={isInvalid ? errorId : undefined}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder="@yourhandle"
                          value={account.handle}
                          onChange={(event) => updateAccount(account.id, "handle", event.target.value)}
                          required
                        />
                        {isInvalid && accountError ? <span className="application-field-error" id={errorId}>{accountError}</span> : null}
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <button className="button button--ghost creator-account-add" type="button" onClick={addAccount}>
              <Plus aria-hidden="true" size={16} /> Add another handle
            </button>
            <span className="sr-only" aria-live="polite">{accountAnnouncement}</span>
          </fieldset>

          <div className="application-form__footer">
            <Link href="/"><ArrowLeft aria-hidden="true" size={15} /> Back</Link>
            <span><LockKeyhole aria-hidden="true" size={14} /> Your account protects this application</span>
            <button className="button button--ink button--large" type="submit">Review application <ArrowRight aria-hidden="true" size={17} /></button>
          </div>
        </>
      ) : reviewDraft ? (
        <section className="application-review" aria-labelledby="application-review-title">
          <div className="application-review__header">
            <p className="eyebrow">Final check</p>
            <h2 id="application-review-title" ref={focusStepHeading("review")} tabIndex={-1}>Review your application</h2>
            <p>Make sure these are the creator accounts you want us to connect.</p>
          </div>

          <dl className="application-review__identity">
            <div><dt>Name</dt><dd>{reviewDraft.name}</dd></div>
            <div><dt>Phone number</dt><dd>{reviewDraft.phoneNumber}</dd></div>
            <div className="application-review__wide"><dt>Discord username</dt><dd>{reviewDraft.discordUsername}</dd></div>
          </dl>

          <div className="application-review__accounts">
            <div className="application-review__section-heading">
              <h3>Creator accounts</h3>
              <span>{reviewDraft.accounts.length} {reviewDraft.accounts.length === 1 ? "account" : "accounts"}</span>
            </div>
            <ul>
              {reviewDraft.accounts.map((account, index) => (
                <li key={`${account.platform}:${account.handle}:${index}`}>
                  <span>{platformLabel(account.platform)}</span>
                  <strong>{account.handle.startsWith("@") ? account.handle : `@${account.handle}`}</strong>
                </li>
              ))}
            </ul>
          </div>

          <DefaultDealCard titleId="review-default-deal-title" />

          <div className="application-review__next">
            <ClipboardCheck aria-hidden="true" size={18} />
            <div>
              <strong>Signing is a separate onboarding step</strong>
              <span>If approved, you will receive the exact standard agreement to review and sign.</span>
            </div>
          </div>

          <div className="application-form__footer application-form__footer--review">
            <button className="application-edit-button" type="button" onClick={editDetails}><ArrowLeft aria-hidden="true" size={15} /> Edit details</button>
            <span><LockKeyhole aria-hidden="true" size={14} /> Submitted to your verified account</span>
            <button className="button button--ink button--large" disabled={submitting} type="submit">
              {submitting ? "Submitting…" : "Submit application"} <ArrowRight aria-hidden="true" size={17} />
            </button>
          </div>
          {submissionError ? <p className="application-submit-error" role="alert">{submissionError}</p> : null}
        </section>
      ) : null}
    </form>
  );
}
