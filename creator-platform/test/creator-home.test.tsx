import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreatorCommandCenter } from "@/components/creator-command-center";
import type { CreatorContentWorkspace } from "@/server/accounts/content";
import type { CreatorEarningsWorkspace } from "@/server/accounts/earnings";
import {
  buildCreatorHomeOverview,
  deriveCreatorNextAction,
} from "@/server/accounts/home";
import type { CreatorContentLibrary, CreatorScript } from "@/server/content/library";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

const now = new Date("2026-09-01T12:00:00.000Z");

const emptyContent: CreatorContentWorkspace = {
  canSubmit: false,
  platformAccounts: [],
  submissions: [],
  posts: [],
};

const emptyEarnings: CreatorEarningsWorkspace = { entries: [], settlements: [] };
const emptyLibrary: CreatorContentLibrary = { scripts: [], assets: [] };

function script(overrides: Partial<CreatorScript> = {}): CreatorScript {
  return {
    assignmentId: "assignment-1",
    title: "Recorded assignment",
    summary: "",
    bodyMarkdown: "Create from the recorded brief.",
    revision: 1,
    note: "",
    dueAt: null,
    state: "assigned",
    assignedAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("creator home model", () => {
  it("keeps onboarding ahead of active-work assignments", () => {
    const action = deriveCreatorNextAction({
      accountNextPath: "/application/status",
      accountStateAvailable: true,
      libraryAvailable: true,
      scripts: [script({ dueAt: "2026-09-01T18:00:00.000Z" })],
    });

    expect(action).toMatchObject({
      kind: "onboarding",
      title: "Application status",
      href: "/application/status",
      buttonLabel: "View application status",
    });
  });

  it("uses the earliest real unfinished assignment for an active account", () => {
    const action = deriveCreatorNextAction({
      accountNextPath: "/account",
      accountStateAvailable: true,
      libraryAvailable: true,
      scripts: [
        script({ assignmentId: "used", title: "Already used", state: "used", dueAt: "2026-09-01T10:00:00.000Z" }),
        script({ assignmentId: "later", title: "Later assignment", dueAt: "2026-09-04T10:00:00.000Z" }),
        script({ assignmentId: "earlier", title: "Earlier assignment", state: "viewed", dueAt: "2026-09-02T10:00:00.000Z" }),
      ],
    });

    expect(action).toMatchObject({
      kind: "script",
      title: "Earlier assignment",
      href: "/account/scripts",
      dueAt: "2026-09-02T10:00:00.000Z",
    });
    expect(deriveCreatorNextAction({
      accountNextPath: "/account",
      accountStateAvailable: true,
      libraryAvailable: true,
      scripts: [],
    })).toMatchObject({ kind: "none", title: "No task assigned", href: null });
  });

  it("fails closed when state or assignment data cannot be verified", () => {
    expect(deriveCreatorNextAction({
      accountNextPath: null,
      accountStateAvailable: false,
      libraryAvailable: true,
      scripts: [script()],
    })).toMatchObject({ kind: "unavailable", title: "Next action unavailable" });

    expect(deriveCreatorNextAction({
      accountNextPath: "/account",
      accountStateAvailable: true,
      libraryAvailable: false,
      scripts: [],
    })).toMatchObject({ kind: "unavailable", title: "Task data unavailable" });
  });

  it("separates unknown, partial, and known-zero view coverage", () => {
    const partial = buildCreatorHomeOverview({
      content: {
        ...emptyContent,
        posts: [
          {
            id: "known",
            platform: "TIKTOK",
            nativePostId: "1",
            canonicalUrl: null,
            publishedAt: "2026-08-31T11:00:00.000Z",
            attributionState: "verified",
            latestObservation: {
              observedAt: "2026-09-01T08:00:00.000Z",
              viewCount: "120",
              likeCount: null,
              commentCount: null,
              shareCount: null,
            },
          },
          {
            id: "counter-missing",
            platform: "INSTAGRAM_REELS",
            nativePostId: "2",
            canonicalUrl: null,
            publishedAt: "2026-08-30T11:00:00.000Z",
            attributionState: "verified",
            latestObservation: {
              observedAt: "2026-08-31T08:00:00.000Z",
              viewCount: null,
              likeCount: "4",
              commentCount: null,
              shareCount: null,
            },
          },
          {
            id: "unobserved",
            platform: "TIKTOK",
            nativePostId: "3",
            canonicalUrl: null,
            publishedAt: null,
            attributionState: "creator_claimed",
            latestObservation: null,
          },
        ],
      },
      earnings: emptyEarnings,
      library: emptyLibrary,
      updates: [],
      now,
    });

    expect(partial.viewCoverage).toEqual({
      state: "partial",
      knownViews: "120",
      totalPostCount: 3,
      postsWithKnownViews: 1,
      latestObservedAt: "2026-09-01T08:00:00.000Z",
    });
    expect(partial.postsLastSevenDays).toBe(2);
    expect(partial.undatedPostCount).toBe(1);

    const unknown = buildCreatorHomeOverview({
      content: {
        ...emptyContent,
        posts: [{
          id: "unknown",
          platform: "TIKTOK",
          nativePostId: null,
          canonicalUrl: null,
          publishedAt: "2026-08-31T11:00:00.000Z",
          attributionState: "unattributed",
          latestObservation: null,
        }],
      },
      earnings: emptyEarnings,
      library: emptyLibrary,
      updates: [],
      now,
    });
    expect(unknown.viewCoverage).toMatchObject({ state: "unknown", knownViews: null });

    const knownZero = buildCreatorHomeOverview({
      content: {
        ...emptyContent,
        posts: [{
          id: "known-zero",
          platform: "TIKTOK",
          nativePostId: "0",
          canonicalUrl: null,
          publishedAt: "2026-08-31T11:00:00.000Z",
          attributionState: "verified",
          latestObservation: {
            observedAt: "2026-09-01T08:00:00.000Z",
            viewCount: "0",
            likeCount: null,
            commentCount: null,
            shareCount: null,
          },
        }],
      },
      earnings: emptyEarnings,
      library: emptyLibrary,
      updates: [],
      now,
    });
    expect(knownZero.viewCoverage).toMatchObject({ state: "covered", knownViews: "0" });
  });

  it("keeps earning totals separated by state, currency, and exponent", () => {
    const overview = buildCreatorHomeOverview({
      content: emptyContent,
      earnings: {
        entries: [
          {
            id: "usd-estimated-1", postId: null, category: "base", currency: "USD",
            currencyExponent: 2, amountMinor: "100", state: "estimated", periodStart: null,
            periodEnd: null, earnedAt: "2026-08-29T00:00:00Z", approvedAt: null,
            paidAt: null, reconciledAt: null,
          },
          {
            id: "usd-estimated-2", postId: null, category: "base", currency: "USD",
            currencyExponent: 2, amountMinor: "250", state: "estimated", periodStart: null,
            periodEnd: null, earnedAt: "2026-08-30T00:00:00Z", approvedAt: null,
            paidAt: null, reconciledAt: null,
          },
          {
            id: "eur-estimated", postId: null, category: "base", currency: "EUR",
            currencyExponent: 2, amountMinor: "900", state: "estimated", periodStart: null,
            periodEnd: null, earnedAt: "2026-08-30T00:00:00Z", approvedAt: null,
            paidAt: null, reconciledAt: null,
          },
          {
            id: "usd-paid", postId: null, category: "base", currency: "USD",
            currencyExponent: 2, amountMinor: "500", state: "paid", periodStart: null,
            periodEnd: null, earnedAt: "2026-08-30T00:00:00Z",
            approvedAt: "2026-08-30T01:00:00Z", paidAt: "2026-08-31T00:00:00Z",
            reconciledAt: null,
          },
        ],
        settlements: [],
      },
      library: emptyLibrary,
      updates: [],
      now,
    });

    expect(overview.earningSummaries).toEqual([
      { state: "estimated", currency: "EUR", currencyExponent: 2, amountMinor: "900", entryCount: 1 },
      { state: "estimated", currency: "USD", currencyExponent: 2, amountMinor: "350", entryCount: 2 },
      { state: "paid", currency: "USD", currencyExponent: 2, amountMinor: "500", entryCount: 1 },
    ]);
  });

  it("renders the empty command center without inventing targets or streaks", () => {
    const overview = buildCreatorHomeOverview({
      content: emptyContent,
      earnings: emptyEarnings,
      library: emptyLibrary,
      updates: [],
      now,
    });
    render(<CreatorCommandCenter
      overview={overview}
      nextAction={deriveCreatorNextAction({
        accountNextPath: "/account",
        accountStateAvailable: true,
        libraryAvailable: true,
        scripts: [],
      })}
    />);

    expect(screen.getByRole("heading", { name: "No task assigned" })).toBeInTheDocument();
    const metrics = screen.getByRole("region", { name: "Creator account summary" });
    expect(within(metrics).getByText("Known views").nextElementSibling).toHaveTextContent("Unknown");
    expect(screen.queryByText(/streak|quota|posting goal|required posts|missed post/iu)).not.toBeInTheDocument();
    expect(screen.getByText("This does not establish a zero balance.")).toBeInTheDocument();
  });
});
