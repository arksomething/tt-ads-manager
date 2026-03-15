import Link from "next/link";

const manifesto = [
  "Short-form moves fast. Your operating layer should feel calm.",
  "Less spreadsheet drag. Less screenshot proof. Less dashboard theater.",
  "One campaign context. A clearer read on what is actually working.",
];

const valueProps = [
  {
    eyebrow: "Campaign-first workspace",
    title: "Start from the initiative, not a giant database.",
    description:
      "Organizations hold campaigns. Campaigns hold creators, videos, notes, statuses, due dates, and payouts so the context stays intact.",
  },
  {
    eyebrow: "Performance with workflow",
    title: "Analytics live next to the actual work.",
    description:
      "Review top videos, creator trends, delivery progress, and spend without bouncing between dashboards and execution tools.",
  },
  {
    eyebrow: "Built for operators",
    title: "Move from outreach to payout without losing the signal.",
    description:
      "Track deliverables, approvals, posting, and payment inside the same quiet surface your team already uses to make decisions.",
  },
];

const workflow = [
  {
    step: "01",
    title: "Sync creator data from your source stack",
    description:
      "Pull creator, platform, video, and performance data into a local system shaped around your team.",
  },
  {
    step: "02",
    title: "Organize by campaign",
    description:
      "Attach creators to live initiatives, set statuses, add notes, and manage deal flow from one place.",
  },
  {
    step: "03",
    title: "Read the signal clearly",
    description:
      "Compare recent content, posting momentum, creator quality, and spend in the same campaign view.",
  },
  {
    step: "04",
    title: "Close the loop",
    description:
      "Track deliverables, payout status, and next actions with enough precision to move faster next round.",
  },
];

const stats = [
  { label: "Creators in flight", value: "18" },
  { label: "Videos tracked", value: "62" },
  { label: "Campaign spend", value: "$28K" },
  { label: "Views this cycle", value: "4.7M" },
];

const creatorRows = [
  {
    name: "@lyra.vibes",
    platform: "TikTok",
    status: "Content received",
    avgViews: "412K",
    payout: "$1,800",
  },
  {
    name: "@marc.and.co",
    platform: "Reels",
    status: "Negotiating",
    avgViews: "205K",
    payout: "$950",
  },
  {
    name: "@sami.tests",
    platform: "Shorts",
    status: "Posted",
    avgViews: "688K",
    payout: "$2,400",
  },
  {
    name: "@ninaframe",
    platform: "TikTok",
    status: "Paid",
    avgViews: "331K",
    payout: "$1,200",
  },
];

const signals = [
  {
    label: "Top hook",
    value: "Problem / solution demos are leading this cycle.",
  },
  {
    label: "Best platform",
    value: "TikTok is driving the highest view velocity.",
  },
  {
    label: "Next move",
    value: "Rebook creators with repeatable demo formats this week.",
  },
];

const painPoints = [
  "Spreadsheets for creator lists and campaign tracking",
  "Separate notes, screenshots, and payout trackers",
  "Dashboards that do not match the actual operator workflow",
  "Too much manual movement between analytics and execution",
];

const primaryActionClass =
  "inline-flex items-center justify-center rounded-full border border-white/[0.14] bg-black/[0.52] font-semibold text-white shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur transition hover:border-[#90FF4D]/40 hover:bg-black/[0.68]";

const compactPrimaryActionClass = `${primaryActionClass} px-5 py-2.5 text-sm`;
const largePrimaryActionClass = `${primaryActionClass} px-6 py-3 text-sm`;

export default async function Home() {
  const primaryHref = "/login";
  const navActionLabel = "Login";
  const headerPrimaryLabel = "Get access";
  const heroPrimaryLabel = "Continue with Google";

  return (
    <main className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),transparent_30%),radial-gradient(circle_at_18%_20%,rgba(144,255,77,0.09),transparent_20%),radial-gradient(circle_at_80%_18%,rgba(255,255,255,0.05),transparent_22%),linear-gradient(180deg,#090a0d_0%,#050607_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-10rem] top-10 -z-10 h-[40rem] w-[22rem] rounded-full bg-white/[0.12] blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-6rem] top-[30rem] -z-10 h-[24rem] w-[24rem] rounded-full bg-white/[0.08] blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[92rem] -z-10 h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-[#90FF4D]/[0.08] blur-[120px]"
      />

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link
          className="text-sm font-medium uppercase tracking-[0.26em] text-foreground/92"
          href="/"
        >
          Billion Views
        </Link>
        <nav className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            className="hidden transition hover:text-foreground sm:inline-flex"
            href="#approach"
          >
            Approach
          </Link>
          <Link
            className="hidden transition hover:text-foreground sm:inline-flex"
            href="#system"
          >
            System
          </Link>
          <Link className="transition hover:text-foreground" href={primaryHref}>
            {navActionLabel}
          </Link>
          <Link className={compactPrimaryActionClass} href={primaryHref}>
            {headerPrimaryLabel}
          </Link>
        </nav>
      </header>

      <section className="px-6 pb-24 pt-10 lg:px-10 lg:pb-32 lg:pt-16">
        <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col items-center justify-center text-center">
          <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
            <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[0.68rem] uppercase tracking-[0.24em] text-muted-foreground backdrop-blur">
              Campaign-first operator system
            </span>
            <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[0.68rem] uppercase tracking-[0.24em] text-muted-foreground backdrop-blur">
              Synced performance analytics
            </span>
          </div>

          <h1 className="max-w-5xl text-[clamp(3.4rem,9vw,7.35rem)] font-medium leading-[0.92] tracking-[-0.055em] text-foreground">
            Run creator campaigns with taste.
            <span className="block text-foreground/70">
              Operate them with clarity.
            </span>
          </h1>

          <p className="mt-8 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Billion Views turns creator, video, and performance data into a
            quieter operating system for brands, app marketers, agencies, and
            growth teams managing short-form creator programs.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link className={largePrimaryActionClass} href={primaryHref}>
              {heroPrimaryLabel}
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] px-6 py-3 text-sm font-medium text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.06]"
              href="#artifact"
            >
              See the workspace
            </Link>
          </div>
        </div>
      </section>

      <section
        aria-label="Manifesto"
        className="px-6 py-12 lg:px-10 lg:py-20"
      >
        <div className="mx-auto max-w-3xl space-y-24 text-center">
          {manifesto.map((statement) => (
            <p
              key={statement}
              className="text-3xl font-medium leading-tight tracking-[-0.04em] text-foreground/92 sm:text-5xl"
            >
              {statement}
            </p>
          ))}
        </div>
      </section>

      <section
        id="approach"
        className="px-6 py-24 lg:px-10 lg:py-32"
      >
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col justify-between rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-8 backdrop-blur md:p-10">
            <div className="space-y-5">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                What existing tools get wrong
              </p>
              <h2 className="max-w-md text-3xl font-medium leading-tight tracking-[-0.04em] text-foreground sm:text-4xl">
                Creator ops still gets pushed through disconnected surfaces.
              </h2>
              <p className="max-w-lg text-sm leading-7 text-muted-foreground sm:text-base">
                Most teams are still gluing together creator data, notes,
                screenshots, deliverables, and payout state by hand. The signal
                is there, but the operating layer is not.
              </p>
            </div>
            <div className="mt-10 flex flex-wrap gap-2 text-[0.68rem] uppercase tracking-[0.24em] text-muted-foreground">
              <span className="rounded-full border border-white/[0.08] px-3 py-2">
                App marketers
              </span>
              <span className="rounded-full border border-white/[0.08] px-3 py-2">
                DTC brands
              </span>
              <span className="rounded-full border border-white/[0.08] px-3 py-2">
                Agencies
              </span>
              <span className="rounded-full border border-white/[0.08] px-3 py-2">
                Growth teams
              </span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/[0.08] bg-black/[0.32] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur md:p-6">
            <div className="rounded-[1.6rem] border border-white/[0.06] bg-white/[0.03] p-6 md:p-8">
              <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                    The old stack
                  </p>
                  <p className="mt-2 text-sm text-foreground/88">
                    Fragmented tools create more motion, not more clarity.
                  </p>
                </div>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.65rem] uppercase tracking-[0.24em] text-muted-foreground">
                  Replace the sprawl
                </span>
              </div>

              <div className="mt-6 space-y-3">
                {painPoints.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] px-4 py-4"
                  >
                    <span className="mt-1 h-2 w-2 rounded-full bg-[#90FF4D]" />
                    <p className="text-sm leading-6 text-foreground/82">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  The Billion Views layer
                </p>
                <p className="mt-3 text-xl font-medium leading-8 tracking-[-0.03em] text-foreground sm:text-2xl">
                  One calm surface for campaign context, creator quality,
                  recent performance, team notes, deliverables, and payout
                  state.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="artifact"
        className="px-6 py-24 lg:px-10 lg:py-32"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Strong visual interruption
            </p>
            <h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-0.045em] text-foreground sm:text-5xl">
              A campaign workspace that feels composed under pressure.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              Premium in tone, precise in structure. Enough room to think,
              enough detail to operate.
            </p>
          </div>

          <div className="mt-14 rounded-[2.7rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-4 shadow-[0_45px_120px_rgba(0,0,0,0.4)] backdrop-blur md:p-6">
            <div className="rounded-[2.2rem] border border-white/[0.06] bg-black/[0.42] p-5 md:p-7">
              <div className="flex flex-col gap-5 border-b border-white/[0.06] pb-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[0.64rem] uppercase tracking-[0.24em] text-muted-foreground">
                      Organization / North Star Labs
                    </span>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[0.64rem] uppercase tracking-[0.24em] text-muted-foreground">
                      Campaign / Spring launch
                    </span>
                    <span className="rounded-full bg-linear-to-r from-[#90FF4D] to-[#13CA2D] px-3 py-2 text-[0.64rem] font-medium uppercase tracking-[0.24em] text-black">
                      Data sync live
                    </span>
                  </div>
                  <h3 className="mt-4 text-2xl font-medium tracking-[-0.035em] text-foreground sm:text-3xl">
                    Campaign health, creator status, recent video signal,
                    payouts, and notes in one frame.
                  </h3>
                </div>

                <div className="w-full max-w-sm rounded-full border border-white/[0.08] bg-white/[0.04] px-5 py-3 text-sm text-muted-foreground">
                  Search creators, videos, status, notes
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {stats.map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-[1.5rem] border border-white/[0.08] bg-white/[0.03] p-4"
                      >
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                          {stat.label}
                        </p>
                        <p className="mt-3 text-3xl font-medium tracking-[-0.045em] text-foreground">
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-[1.8rem] border border-white/[0.08] bg-white/[0.03] p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                          Creator roster
                        </p>
                        <p className="mt-2 text-sm text-foreground/82">
                          Review the people, the status, and the money without
                          leaving campaign context.
                        </p>
                      </div>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.64rem] uppercase tracking-[0.24em] text-muted-foreground">
                        18 active creators
                      </span>
                    </div>

                    <div className="mt-5 space-y-3">
                      {creatorRows.map((row) => (
                        <div
                          key={row.name}
                          className="grid gap-3 rounded-[1.25rem] border border-white/[0.06] bg-black/[0.18] px-4 py-4 sm:grid-cols-[1.2fr_0.85fr_1fr_0.9fr]"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {row.name}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                              {row.platform}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                              Status
                            </p>
                            <p className="mt-1 text-sm text-foreground/88">
                              {row.status}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                              Avg. views
                            </p>
                            <p className="mt-1 text-sm text-foreground/88">
                              {row.avgViews}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                              Agreed payout
                            </p>
                            <p className="mt-1 text-sm text-foreground/88">
                              {row.payout}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[1.8rem] border border-white/[0.08] bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                      Performance read
                    </p>
                    <div className="mt-5 space-y-4">
                      {signals.map((signal) => (
                        <div
                          key={signal.label}
                          className="rounded-[1.25rem] border border-white/[0.06] bg-black/[0.18] p-4"
                        >
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {signal.label}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-foreground/88">
                            {signal.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.8rem] border border-white/[0.08] bg-white/[0.03] p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                        Payout state
                      </p>
                      <span className="rounded-full bg-linear-to-r from-[#90FF4D] to-[#13CA2D] px-3 py-1.5 text-[0.64rem] font-medium uppercase tracking-[0.24em] text-black">
                        74% complete
                      </span>
                    </div>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full w-[74%] rounded-full bg-linear-to-r from-[#90FF4D] to-[#13CA2D]" />
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[1.25rem] border border-white/[0.06] bg-black/[0.18] p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                          Pending
                        </p>
                        <p className="mt-2 text-2xl font-medium tracking-[-0.04em] text-foreground">
                          $7.2K
                        </p>
                      </div>
                      <div className="rounded-[1.25rem] border border-white/[0.06] bg-black/[0.18] p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                          Paid
                        </p>
                        <p className="mt-2 text-2xl font-medium tracking-[-0.04em] text-foreground">
                          $20.8K
                        </p>
                      </div>
                      <div className="rounded-[1.25rem] border border-white/[0.06] bg-black/[0.18] p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                          Due next
                        </p>
                        <p className="mt-2 text-2xl font-medium tracking-[-0.04em] text-foreground">
                          Mar 21
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.8rem] border border-white/[0.08] bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                      Operator note
                    </p>
                    <p className="mt-4 text-sm leading-7 text-foreground/84">
                      The clearest wins are coming from creators who already
                      know how to land the opening problem in the first three
                      seconds. Prioritize the next outreach wave around demo-led
                      formats, not broad lifestyle cuts.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="system"
        className="px-6 py-24 lg:px-10 lg:py-32"
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Core value
          </p>
          <h2 className="mt-4 text-3xl font-medium leading-tight tracking-[-0.045em] text-foreground sm:text-5xl">
            Built around the real operator flow.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            From fit to payout, the product stays anchored in the workflow teams
            actually run every day.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
          {valueProps.map((item) => (
            <article
              key={item.title}
              className="rounded-[1.9rem] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur md:p-7"
            >
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                {item.eyebrow}
              </p>
              <h3 className="mt-5 text-2xl font-medium leading-tight tracking-[-0.035em] text-foreground">
                {item.title}
              </h3>
              <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
                {item.description}
              </p>
            </article>
          ))}
        </div>

        <div className="mx-auto mt-20 max-w-6xl">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((item) => (
              <article
                key={item.step}
                className="rounded-[1.7rem] border border-white/[0.08] bg-black/[0.24] p-5"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  {item.step}
                </p>
                <h3 className="mt-4 text-xl font-medium leading-tight tracking-[-0.03em] text-foreground">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-28 pt-10 lg:px-10 lg:pb-36">
        <div className="mx-auto max-w-5xl rounded-[2.8rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-5 shadow-[0_36px_110px_rgba(0,0,0,0.38)] backdrop-blur md:p-7">
          <div className="relative overflow-hidden rounded-[2.25rem] border border-white/[0.06] bg-black/[0.42] px-6 py-16 text-center md:px-10 md:py-20">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.12] blur-[120px]"
            />
            <div className="relative mx-auto max-w-xl">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Quiet invitation
              </p>
              <h2 className="mt-5 text-3xl font-medium leading-tight tracking-[-0.045em] text-foreground sm:text-5xl">
                Start with one campaign. See everything more clearly.
              </h2>
              <p className="mt-5 text-sm leading-7 text-muted-foreground sm:text-base">
                Continue with Google, create your organization, connect your
                data source, and land in a workspace that feels calm enough to
                run at speed.
              </p>
              <div className="mt-8 flex justify-center">
                <Link className={largePrimaryActionClass} href={primaryHref}>
                  {heroPrimaryLabel}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-3 border-t border-white/[0.06] px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <p>Billion Views</p>
        <div className="flex items-center gap-4">
          <Link className="transition hover:text-foreground" href="#approach">
            Approach
          </Link>
          <Link className="transition hover:text-foreground" href="#system">
            System
          </Link>
          <Link className="transition hover:text-foreground" href={primaryHref}>
            {navActionLabel}
          </Link>
        </div>
      </footer>
    </main>
  );
}
