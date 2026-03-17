import {
  placeholderSectionData,
  type DashboardSectionKey,
} from "./mock-data";

type PlaceholderPageKey = Exclude<DashboardSectionKey, "overview">;

export function createOrgPlaceholderPage(sectionKey: PlaceholderPageKey) {
  return function OrgPlaceholderPage() {
    const section = placeholderSectionData[sectionKey];

    return (
      <div className="space-y-4">
        <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              {section.eyebrow}
            </p>
            <h2 className="mt-3 max-w-2xl text-2xl font-medium tracking-[-0.045em] text-foreground">
              {section.spotlightTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-[0.92rem] leading-6 text-muted-foreground">
              {section.spotlightDescription}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {section.highlights.map((highlight) => (
                <span
                  key={highlight}
                  className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1.5 text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground"
                >
                  {highlight}
                </span>
              ))}
            </div>
          </article>

          <aside className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Build state
            </p>
            <div className="mt-4 space-y-2.5">
              {section.rows.map((row) => (
                <div
                  key={row.label}
                  className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.92rem] font-medium text-foreground">
                        {row.label}
                      </p>
                      <p className="mt-1.5 text-[0.86rem] leading-6 text-muted-foreground">
                        {row.value}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-3 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#B8FF86]">
                      {row.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {section.statCards.map((card) => (
            <article
              key={card.label}
              className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
            >
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-3 text-[1.7rem] font-medium tracking-[-0.05em] text-foreground">
                {card.value}
              </p>
            </article>
          ))}
        </section>
      </div>
    );
  };
}
