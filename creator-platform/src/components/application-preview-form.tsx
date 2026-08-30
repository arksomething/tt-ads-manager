"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import {
  CREATOR_APPLICATION_PLATFORMS,
  findDuplicateCreatorAccountIndex,
  PROGRAM_DEFAULT_DEAL,
  type CreatorApplicationPlatform,
} from "@/lib/creator-application";

type AccountRow = {
  id: number;
  platform: CreatorApplicationPlatform;
  handle: string;
};

export function ApplicationPreviewForm() {
  const [saved, setSaved] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([
    { id: 1, platform: "TIKTOK", handle: "" },
  ]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [invalidAccountId, setInvalidAccountId] = useState<number | null>(null);
  const [accountAnnouncement, setAccountAnnouncement] = useState("");
  const nextAccountId = useRef(2);
  const pendingFocusId = useRef<number | null>(null);
  const handleRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const resetSubmissionState = () => {
    setSaved(false);
    setAccountError(null);
    setInvalidAccountId(null);
  };

  const addAccount = () => {
    const id = nextAccountId.current;
    nextAccountId.current += 1;
    pendingFocusId.current = id;
    setAccounts((current) => [
      ...current,
      { id, platform: "TIKTOK", handle: "" },
    ]);
    setAccountAnnouncement("Creator account added.");
    resetSubmissionState();
  };

  const removeAccount = (id: number) => {
    if (accounts.length === 1) return;

    const removedIndex = accounts.findIndex((account) => account.id === id);
    const nextAccounts = accounts.filter((account) => account.id !== id);
    const nextFocusIndex = Math.max(0, Math.min(removedIndex - 1, nextAccounts.length - 1));

    setAccounts(nextAccounts);
    setAccountAnnouncement("Creator account removed.");
    handleRefs.current[nextAccounts[nextFocusIndex].id]?.focus();
    resetSubmissionState();
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
    resetSubmissionState();
  };

  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const duplicateIndex = findDuplicateCreatorAccountIndex(accounts);
    if (duplicateIndex >= 0) {
      const duplicate = accounts[duplicateIndex];
      setAccountError("That platform and handle are already listed.");
      setInvalidAccountId(duplicate.id);
      setSaved(false);
      handleRefs.current[duplicate.id]?.focus();
      return;
    }

    setAccountError(null);
    setInvalidAccountId(null);
    setSaved(true);
  };

  return (
    <form className="application-form" onSubmit={submitPreview}>
      {saved ? (
        <div className="application-saved" role="status">
          <Check size={17} />
          <div>
            <strong>Frontend flow complete</strong>
            <span>
              The {PROGRAM_DEFAULT_DEAL.label.toLocaleLowerCase("en-US")} would be assigned automatically.
              Nothing was submitted or stored.
            </span>
          </div>
        </div>
      ) : null}

      <section className="application-default-deal" aria-labelledby="default-deal-title">
        <LockKeyhole aria-hidden="true" size={18} />
        <div>
          <span>Assigned automatically</span>
          <strong id="default-deal-title">{PROGRAM_DEFAULT_DEAL.label}</strong>
          <p>Every accepted creator starts on the program default. You will review the exact terms before onboarding.</p>
        </div>
      </section>

      <div className="application-fields">
        <label>
          <span>Name</span>
          <input name="name" autoComplete="name" placeholder="Your name" required onChange={resetSubmissionState} />
        </label>
        <label>
          <span>Phone number</span>
          <input name="phoneNumber" type="tel" autoComplete="tel" inputMode="tel" placeholder="+1 555 555 0123" required onChange={resetSubmissionState} />
        </label>
        <label className="application-fields__wide">
          <span>Discord username</span>
          <input name="discordUsername" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="yourusername" required onChange={resetSubmissionState} />
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
                        if (node && pendingFocusId.current === account.id) {
                          node.focus();
                          pendingFocusId.current = null;
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
        <Link href="/"><ArrowLeft size={15} /> Back</Link>
        <span><LockKeyhole size={14} /> Preview mode · details stay in this browser</span>
        <button className="button button--ink button--large" type="submit">Review application <ArrowRight size={17} /></button>
      </div>
    </form>
  );
}
