"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { PreviewNote } from "@/components/preview-note";

const steps = ["Welcome", "Discord", "Profile", "Accounts", "Verify", "Agreement"];

function TikTokMark() {
  return <span className="tiktok-mark" aria-hidden="true">♪</span>;
}

function InstagramMark() {
  return (
    <svg className="instagram-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.4" cy="6.8" r="1" fill="currentColor" />
    </svg>
  );
}

export function AccountVerificationPreview() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const copyCode = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText("GT-DYLAN-482");
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopyState("idle"), 2200);
  };

  return (
    <div className="onboarding-preview">
      <div className="onboarding-preview__notice">
        <PreviewNote>Sample onboarding · account verification is not connected</PreviewNote>
        <Link href="/" className="preview-back-link"><ArrowLeft size={15} /> Back to program</Link>
      </div>

      <header className="onboarding-header">
        <Link href="/" aria-label="GoTall creator program"><BrandMark /></Link>
        <button type="button" className="workspace-switcher">GoTall <ChevronDown size={14} /></button>
        <div><span>Setup 5 of 6</span><button type="button">Save &amp; exit</button></div>
      </header>

      <main className="onboarding-main">
        <nav className="setup-steps" aria-label="Onboarding progress">
          {steps.map((step, index) => {
            const complete = index < 4;
            const current = index === 4;
            return (
              <div key={step} className={current ? "is-current" : complete ? "is-complete" : ""}>
                <span>{complete ? <Check size={13} strokeWidth={2.5} /> : index + 1}</span>
                <strong>{step}</strong>
              </div>
            );
          })}
        </nav>

        <div className="verification-layout">
          <section className="verification-content">
            <p className="eyebrow">Ownership check</p>
            <h1>Verify your campaign accounts</h1>
            <p className="verification-lede">Add this code to each bio. We&apos;ll confirm the accounts belong to you.</p>

            <div className="verification-code">
              <code>GT-DYLAN-482</code>
              <button type="button" onClick={copyCode}>
                {copyState === "copied" ? <Check size={18} /> : <Copy size={18} />}
                {copyState === "copied" ? "Copied" : "Copy code"}
              </button>
            </div>
            <p className={`copy-feedback${copyState === "error" ? " copy-feedback--error" : ""}`} role="status">
              {copyState === "copied"
                ? "Verification code copied."
                : copyState === "error"
                  ? "Could not copy automatically. Select the code and copy it manually."
                  : ""}
            </p>

            <div className="account-verification-list">
              <article className="account-row">
                <div className="account-row__platform"><TikTokMark /></div>
                <div className="account-row__avatar">D</div>
                <div className="account-row__identity"><span>TikTok</span><strong>@dylan.grows</strong></div>
                <span className="verification-status verification-status--success"><i /> Verified</span>
              </article>

              <article className="account-row account-row--pending">
                <div className="account-row__platform"><InstagramMark /></div>
                <div className="account-row__avatar">D</div>
                <div className="account-row__identity"><span>Instagram</span><strong>@dylan.builds</strong></div>
                <span className="verification-status">Waiting for code</span>
                <button className="check-button" type="button"><RefreshCw size={14} /> Check again</button>
                <div className="verification-instructions">
                  <span><b>1</b> Copy code</span>
                  <span><b>2</b> Paste in bio</span>
                  <span><b>3</b> Check account</span>
                </div>
              </article>
            </div>
          </section>

          <aside className="verification-help">
            <div><CircleHelp size={20} /><h2>Why this matters</h2></div>
            <p>This confirms ownership and keeps another creator&apos;s posts out of your workspace.</p>
            <p>Remove the code after verification.</p>
          </aside>
        </div>
      </main>

      <footer className="onboarding-footer">
        <Link className="button button--ghost button--large" href="/preview/creator"><ArrowLeft size={17} /> Back</Link>
        <span aria-label="1 of 2 verified"><strong>1</strong> of 2 verified</span>
        <button className="button button--large" type="button" disabled>Continue</button>
      </footer>
    </div>
  );
}
