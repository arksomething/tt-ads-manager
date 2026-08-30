import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Camera,
  Check,
  FileText,
  MessageCircle,
  Smartphone,
} from "lucide-react";

import { LandingDashboard } from "@/components/landing-dashboard";
import { PreviewNote } from "@/components/preview-note";
import { SiteHeader } from "@/components/site-header";

const steps = [
  ["01", "Apply", "Tell us what you make and share one video you are proud of."],
  ["02", "Join the community", "Meet the team, get feedback, and know exactly what happens next."],
  ["03", "Pick a script", "Choose a ready-to-film idea with a proven hook and clear direction."],
  ["04", "Film and post", "Create on your phone, then publish to your campaign accounts."],
  ["05", "Track everything", "See posting progress, verified views, and every earnings stage."],
] as const;

const benefits = [
  [FileText, "Scripts are ready", "Start with the hook, structure, and examples already worked out."],
  [Smartphone, "Your phone is enough", "No studio, production crew, or large following is required."],
  [BarChart3, "Performance is visible", "TikTok and Instagram activity appears in one clear workspace."],
  [BadgeCheck, "Earnings stay legible", "Estimated, under review, approved, and paid never blur together."],
] as const;

export default function Home() {
  return (
    <main className="marketing-page">
      <SiteHeader />

      <section className="hero">
        <div className="hero__inner">
          <div className="hero__copy">
            <PreviewNote>Frontend preview · applications are not live yet</PreviewNote>
            <p className="eyebrow">GoTall creator program</p>
            <h1>Make the content. Know what happens next.</h1>
            <p className="hero__lede">
              Proven scripts, direct feedback, transparent tracking, and one place to understand your
              posts and earnings.
            </p>
            <div className="hero__actions">
              <Link className="button button--ink button--large" href="/apply">
                Apply to create
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link className="text-link" href="/preview/creator">
                Explore the creator dashboard
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </div>
            <div className="hero__trust">
              <span><Check size={14} aria-hidden="true" /> No large following required</span>
              <span><Check size={14} aria-hidden="true" /> TikTok + Instagram</span>
            </div>
          </div>

          <div className="hero__visual">
            <div className="hero__visual-label">What your workspace will feel like</div>
            <LandingDashboard />
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Program benefits">
        <div><FileText aria-hidden="true" size={18} /><span>Ready-to-film scripts</span></div>
        <div><Camera aria-hidden="true" size={18} /><span>Face-to-camera formats</span></div>
        <div><MessageCircle aria-hidden="true" size={18} /><span>Direct creator feedback</span></div>
        <div><BarChart3 aria-hidden="true" size={18} /><span>Clear view and earnings tracking</span></div>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">How it works</p>
            <h2>A simple path from idea to paid work.</h2>
          </div>
          <p>
            You always know the next action. The detailed guidance appears when you need it—not as a wall
            of instructions.
          </p>
        </div>

        <ol className="steps">
          {steps.map(([number, title, body]) => (
            <li key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section offer" id="offer">
        <div className="offer__intro">
          <p className="eyebrow eyebrow--light">The program</p>
          <h2>Everything around the content gets easier.</h2>
          <p>
            The exact deal can change by campaign. The workspace keeps the brief, requirements, tracking,
            and payment state precise either way.
          </p>
          <Link className="button button--paper" href="/preview/onboarding">
            See onboarding
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
        <div className="offer__benefits">
          {benefits.map(([Icon, title, body]) => (
            <article key={title}>
              <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section dashboard-story">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">Creator home</p>
            <h2>The signal, without the dashboard clutter.</h2>
          </div>
          <p>
            One performance surface, a compact activity history, and a clear next task. Unknown or stale
            tracking is shown honestly instead of becoming zero.
          </p>
        </div>
        <div className="dashboard-story__frame">
          <LandingDashboard />
          <div className="dashboard-story__notes">
            <span>Views and earnings share one chart</span>
            <span>Posting streak respects scheduled off-days</span>
            <span>Messages stay in a focused drawer</span>
          </div>
        </div>
      </section>

      <section className="section faq" id="questions">
        <div className="section-heading">
          <p className="eyebrow">Questions</p>
          <h2>The useful answers first.</h2>
        </div>
        <div className="faq__list">
          <details>
            <summary>Do I need a large following?</summary>
            <p>No. The program is built around strong delivery, consistency, and learning the format.</p>
          </details>
          <details>
            <summary>Where do I post?</summary>
            <p>Campaigns can include TikTok and Instagram. Your onboarding will show the exact account setup.</p>
          </details>
          <details>
            <summary>How are earnings calculated?</summary>
            <p>Your deal terms define the calculation. The dashboard separates estimates, review, approval, and payment.</p>
          </details>
          <details>
            <summary>What happens after I apply?</summary>
            <p>The team reviews your work, follows up in Discord, and opens onboarding if there is a fit.</p>
          </details>
        </div>
      </section>

      <section className="final-cta">
        <div>
          <p className="eyebrow">Start here</p>
          <h2>Your next strong post should not start with a blank page.</h2>
        </div>
        <Link className="button button--ink button--large" href="/apply">
          Preview the application
          <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </section>

      <footer className="site-footer">
        <div>
          <span className="mini-mark">G</span>
          <span>GoTall creator program</span>
        </div>
        <p>Frontend preview. Tracking, applications, and payouts are not connected yet.</p>
      </footer>
    </main>
  );
}
