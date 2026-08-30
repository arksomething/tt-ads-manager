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
        <span>Application preview</span>
      </header>
      <section className="application-layout">
        <div className="application-intro">
          <PreviewNote>Frontend preview · nothing is submitted</PreviewNote>
          <p className="eyebrow">Creator application</p>
          <h1>Tell us where you create.</h1>
          <p>Share your name, phone number, Discord username, and every TikTok or Instagram handle you use. That is all we need to start.</p>
          <div className="application-intro__facts"><span>About 1 minute</span><span>TikTok + Instagram</span><span>One standard deal</span></div>
        </div>
        <ApplicationPreviewForm />
      </section>
    </main>
  );
}
