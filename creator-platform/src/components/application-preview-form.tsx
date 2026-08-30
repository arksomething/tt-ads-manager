"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";

export function ApplicationPreviewForm() {
  const [saved, setSaved] = useState(false);

  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(true);
  };

  return (
    <form className="application-form" onSubmit={submitPreview}>
      {saved ? (
        <div className="application-saved" role="status">
          <Check size={17} />
          <div>
            <strong>Frontend flow complete</strong>
            <span>Nothing was submitted or stored. Application intake is the next backend slice.</span>
          </div>
        </div>
      ) : null}

      <fieldset>
        <legend>How would you prefer to earn?</legend>
        <p>Campaign terms can include either model. Your final offer will show the exact rules.</p>
        <div className="earning-options">
          <label><input type="radio" name="earning-model" value="cpm" required /><span><strong>CPM</strong><em>Earn from verified eligible views</em></span></label>
          <label><input type="radio" name="earning-model" value="bonus" required /><span><strong>View bonuses</strong><em>Earn when posts cross milestones</em></span></label>
        </div>
      </fieldset>

      <div className="application-fields">
        <label><span>First name</span><input name="firstName" autoComplete="given-name" placeholder="Dylan" required /></label>
        <label><span>Email address</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
        <label><span>Discord username</span><input name="discord" autoComplete="off" placeholder="yourusername" required /></label>
        <label><span>Best video</span><input name="bestVideo" type="url" inputMode="url" placeholder="https://tiktok.com/@you/video/…" required /></label>
        <label className="application-fields__wide"><span>How did you hear about us?</span><select name="source" required defaultValue=""><option value="" disabled>Select one</option><option>Joseph</option><option>Discord community</option><option>Creator referral</option><option>TikTok or Instagram</option><option>Other</option></select></label>
      </div>

      <div className="application-form__footer">
        <Link href="/"><ArrowLeft size={15} /> Back</Link>
        <span><LockKeyhole size={14} /> Preview mode · details stay in this browser</span>
        <button className="button button--ink button--large" type="submit">Review application <ArrowRight size={17} /></button>
      </div>
    </form>
  );
}
