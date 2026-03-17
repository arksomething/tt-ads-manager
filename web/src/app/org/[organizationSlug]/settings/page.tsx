import Link from "next/link";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

export default async function OrganizationSettingsPage({
  params,
}: SettingsPageProps) {
  const { organizationSlug } = await params;
  const usefulDestinations = [
    {
      label: "Team",
      description: "Org roles, invites, and member cleanup.",
      href: `/org/${organizationSlug}/team`,
    },
    {
      label: "Campaigns",
      description: "Campaign-level managers live with each campaign.",
      href: `/org/${organizationSlug}/campaigns`,
    },
    {
      label: "Login",
      description: "Google sign-in still starts from the usual place.",
      href: "/login",
    },
  ];
  const jokeSettings = [
    {
      label: "Mute spreadsheet drama",
      description: "Prevents metrics from sighing loudly during meetings.",
      enabled: true,
    },
    {
      label: "Founder mode",
      description: "Adds 12% more conviction to every ambitious sentence.",
      enabled: false,
    },
    {
      label: "Mercury retrograde shield",
      description: "Best-effort protection against weirdly timed bugs.",
      enabled: true,
    },
    {
      label: "Tasteful chaos",
      description: "Keeps the team fast, curious, and just a little dangerous.",
      enabled: true,
    },
  ];
  const statusRows = [
    {
      label: "Dashboard vibes",
      value: "Immaculate",
    },
    {
      label: "Unexpected pivots",
      value: "Contained for now",
    },
    {
      label: "Coffee-powered decisions",
      value: "Operational",
    },
    {
      label: "Mysterious button count",
      value: "0",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.9rem] border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
              Settings
            </p>
            <h1 className="mt-4 max-w-3xl text-3xl font-medium tracking-[-0.05em] text-foreground sm:text-[2.6rem]">
              We moved the real controls somewhere useful.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-[0.95rem]">
              Team already handles org access, Campaigns handles campaign-only
              managers, and sign-in lives exactly where people expect it. So the
              settings page has been reassigned to morale.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {usefulDestinations.map((destination) => (
                <Link
                  key={destination.label}
                  className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.08]"
                  href={destination.href}
                >
                  {destination.label}
                </Link>
              ))}
            </div>
          </div>

          <article className="rounded-[1.55rem] border border-white/[0.08] bg-black/[0.2] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
              Today&apos;s official setting
            </p>
            <p className="mt-4 text-2xl font-medium tracking-[-0.04em] text-foreground">
              Do not press mysterious buttons after 6 p.m.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Good news: there are no mysterious buttons left here, only useful
              shortcuts and emotional support.
            </p>
            <div className="mt-5 space-y-2.5">
              {usefulDestinations.map((destination) => (
                <div
                  key={destination.label}
                  className="rounded-[1rem] border border-white/[0.08] bg-white/[0.03] px-4 py-3"
                >
                  <p className="text-sm font-medium text-foreground">
                    {destination.label}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {destination.description}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Totally real controls
          </p>
          <div className="mt-5 space-y-3">
            {jokeSettings.map((setting) => (
              <div
                key={setting.label}
                className="flex items-start justify-between gap-4 rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {setting.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {setting.description}
                  </p>
                </div>
                <div
                  aria-hidden="true"
                  className={`flex h-7 w-12 shrink-0 rounded-full p-1 transition ${
                    setting.enabled ? "bg-[#90FF4D]/18" : "bg-white/[0.08]"
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full transition ${
                      setting.enabled
                        ? "translate-x-5 bg-[#B8FF86]"
                        : "translate-x-0 bg-white/[0.42]"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Status report
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            Everything important is elsewhere. Everything funny is stable.
          </h2>
          <div className="mt-5 space-y-3">
            {statusRows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3.5"
              >
                <p className="text-sm text-foreground">{row.label}</p>
                <span className="rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-3 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#B8FF86]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            Nothing in this panel touches production. It only improves morale by
            an estimated, completely unverified amount.
          </p>
        </article>
      </section>
    </div>
  );
}
