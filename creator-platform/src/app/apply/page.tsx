import type { Metadata } from "next";
import Link from "next/link";

import { ApplicationPreviewForm } from "@/components/application-preview-form";
import { BrandMark } from "@/components/brand-mark";
import { PreviewNote } from "@/components/preview-note";

export const metadata: Metadata = {
  title: "Application preview",
  description: "Preview the GoTall creator program application experience.",
};

export default function ApplyPage() {
  return (
    <main className="application-page">
      <header className="application-header">
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <span>Application 1 of 1</span>
      </header>
      <section className="application-layout">
        <div className="application-intro">
          <PreviewNote>Frontend preview · nothing is submitted</PreviewNote>
          <p className="eyebrow">Creator application</p>
          <h1>Show us how you create.</h1>
          <p>One strong example is enough. We care about delivery, consistency, and whether the format fits—not follower count.</p>
          <div className="application-intro__facts"><span>About 3 minutes</span><span>No large audience required</span><span>Reviewed by the creator team</span></div>
        </div>
        <ApplicationPreviewForm />
      </section>
    </main>
  );
}
