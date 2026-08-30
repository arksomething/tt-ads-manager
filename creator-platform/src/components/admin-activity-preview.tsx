"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Flame,
  Home,
  LogOut,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { PreviewNote } from "@/components/preview-note";

const creators = [
  { name: "Dylan", initials: "DY", streak: 18, offset: 2 },
  { name: "Marcus", initials: "MC", streak: 14, offset: 5 },
  { name: "Noah", initials: "NO", streak: 11, offset: 8 },
  { name: "Jay", initials: "JA", streak: 9, offset: 12 },
  { name: "Abdul", initials: "AB", streak: 7, offset: 17 },
  { name: "Brady", initials: "BR", streak: 5, offset: 23 },
] as const;

type ActivityLevel = "missed" | "0" | "1" | "2" | "3";

interface ActivitySelection {
  creator: string;
  date: string;
  level: ActivityLevel;
}

function levelFor(offset: number, day: number): ActivityLevel {
  const value = (day * 7 + offset * 11 + (day % 5) * offset) % 17;
  if (value === 0) return "missed";
  if (value < 5) return "0";
  if (value < 10) return "1";
  if (value < 15) return "2";
  return "3";
}

function sampleDateFor(day: number) {
  const date = new Date(Date.UTC(2026, 5, 2 + day));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function describeActivityLevel(level: ActivityLevel) {
  if (level === "missed") return "Required post missed";
  if (level === "0") return "Off day · no post required";
  return `${level} tracked post${level === "1" ? "" : "s"}`;
}

export function AdminActivityPreview() {
  const [selection, setSelection] = useState<ActivitySelection | null>(null);
  const [calculationOpen, setCalculationOpen] = useState(false);

  return (
    <div className="admin-preview">
      <div className="creator-preview__topbar">
        <PreviewNote>Sample admin workspace · no live creator data</PreviewNote>
        <Link href="/" className="preview-back-link"><ArrowLeft size={15} /> Back to program</Link>
      </div>
      <div className="admin-shell">
        <aside className="admin-rail" aria-label="Admin navigation">
          <BrandMark />
          <nav>
            <button type="button" aria-label="Home"><Home size={19} /></button>
            <button type="button" aria-label="Creators"><Users size={19} /></button>
            <Link className="is-active" href="/preview/admin" aria-label="Activity"><BarChart3 size={19} /></Link>
            <button type="button" aria-label="Campaigns"><Megaphone size={19} /></button>
            <button type="button" aria-label="Settings"><Settings size={19} /></button>
          </nav>
          <button type="button" aria-label="Help"><CircleHelp size={19} /></button>
          <button type="button" aria-label="Sign out"><LogOut size={19} /></button>
        </aside>

        <main className="admin-main">
          <header className="admin-header">
            <button type="button" className="workspace-switcher">GoTall <ChevronDown size={14} /></button>
            <span className="sample-label">Creator success</span>
          </header>

          <section className="admin-activity-heading">
            <div>
              <p className="eyebrow">Program pulse</p>
              <h1>Activity</h1>
            </div>
            <div className="admin-filters">
              <button type="button">12 weeks <ChevronDown size={14} /></button>
              <button type="button">All campaigns <ChevronDown size={14} /></button>
              <button type="button" aria-label="Search creators"><Search size={18} /></button>
              <button type="button" className="admin-followups">6 follow-ups</button>
            </div>
          </section>

          <section className="admin-summary" aria-label="Sample activity summary">
            <div><strong>31 / 38</strong><span>posted</span></div>
            <div><strong>4.8M</strong><span>verified views</span></div>
            <div><strong>$12.6K</strong><span>estimated</span></div>
            <div><Flame size={18} fill="currentColor" /><strong>18</strong><span>day streak</span></div>
          </section>

          <section className="activity-table" aria-labelledby="activity-table-title">
            <h2 id="activity-table-title" className="sr-only">Creator posting activity by day</h2>
            <p id="activity-table-instructions" className="sr-only">Select a day to show its activity details below the creator rows.</p>
            <div className="activity-table__months" aria-hidden="true"><span>Jun</span><span>Jul</span><span>Aug</span></div>
            <div className="activity-table__mobile-label" aria-hidden="true">Latest 14 sample days</div>
            {creators.map((creator, creatorIndex) => (
              <article className="admin-creator-row" key={creator.name}>
                <div className="admin-creator-identity">
                  <span>{creator.initials}</span>
                  <strong>{creator.name}</strong>
                </div>
                <div className="admin-heatmap" aria-label={`${creator.name} sample activity over twelve weeks`}>
                  {Array.from({ length: 84 }, (_, day) => {
                    const level = levelFor(creator.offset, day);
                    const date = sampleDateFor(day);
                    const selected = selection?.creator === creator.name && selection.date === date;
                    return (
                      <button
                        key={day}
                        type="button"
                        data-level={level}
                        data-day={day + 1}
                        aria-pressed={selected}
                        aria-describedby="activity-table-instructions"
                        aria-controls="admin-activity-detail"
                        aria-label={`${creator.name}, ${date}: ${describeActivityLevel(level)}`}
                        title={`${creator.name} · ${date} · ${describeActivityLevel(level)}`}
                        onClick={() => setSelection({ creator: creator.name, date, level })}
                      >
                        {level === "missed" ? "×" : ""}
                      </button>
                    );
                  })}
                </div>
                <div className="admin-row-actions">
                  <button type="button" disabled title="Messaging is not connected in this preview" aria-label={`Message ${creator.name} (preview only)`}><MessageCircle size={16} /></button>
                  <button type="button" disabled title="Creator actions are not connected in this preview" aria-label={`More actions for ${creator.name} (preview only)`}><MoreHorizontal size={17} /></button>
                </div>
                <span className="admin-streak"><Flame size={15} fill="currentColor" /> {creator.streak}</span>
                <span className={creatorIndex < 2 ? "admin-status admin-status--attention" : "admin-status"} aria-label={creatorIndex < 2 ? "Needs follow-up" : "On track"} />
              </article>
            ))}

            {selection ? (
              <aside id="admin-activity-detail" className="admin-activity-detail" aria-live="polite" aria-label="Activity detail">
                <div>
                  <span>Sample activity detail</span>
                  <h2>{selection.creator} · {selection.date}</h2>
                </div>
                <strong>{describeActivityLevel(selection.level)}</strong>
                <p>This is generated preview data. A live detail will link the post, source observation, and freshness.</p>
                <button type="button" onClick={() => setSelection(null)} aria-label="Close activity detail"><X size={15} /></button>
              </aside>
            ) : null}
          </section>

          <footer className="activity-legend">
            <div><span data-level="0" /> 0</div>
            <div><span data-level="1" /> 1</div>
            <div><span data-level="2" /> 2</div>
            <div><span data-level="3" /> 3+</div>
            <div><span data-level="missed">×</span> missed</div>
            <button
              type="button"
              aria-expanded={calculationOpen}
              aria-controls="activity-calculation-detail"
              onClick={() => setCalculationOpen((open) => !open)}
            >
              How activity is calculated
            </button>
          </footer>

          {calculationOpen ? (
            <section id="activity-calculation-detail" className="activity-calculation-detail" aria-live="polite">
              <div><span>Calculation guide</span><h2>Observed posts, not guessed zeros</h2></div>
              <p>A day is counted only after a discovered post is linked to the creator&apos;s verified account. Missing, stale, or source-restricted observations remain explicit.</p>
              <button type="button" onClick={() => setCalculationOpen(false)} aria-label="Close calculation guide"><X size={15} /></button>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
