export function CreatorPortalSkeleton() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="h-3 w-16 animate-pulse rounded-full bg-white/[0.09]" />
            <div className="mt-4 h-9 w-44 animate-pulse rounded-[0.65rem] bg-white/[0.1]" />
            <div className="mt-3 h-4 w-36 animate-pulse rounded-full bg-white/[0.08]" />
          </div>
          <div className="h-10 w-20 animate-pulse rounded-[0.9rem] border border-white/[0.08] bg-white/[0.04]" />
        </header>

        <section className="grid gap-3 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              <div className="h-3 w-20 animate-pulse rounded-full bg-white/[0.08]" />
              <div className="mt-2 h-10 animate-pulse rounded-[0.85rem] border border-white/[0.08] bg-black/25" />
            </div>
          ))}
          <div className="h-10 w-full animate-pulse rounded-[0.85rem] bg-white sm:w-20" />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.035] p-4"
              key={index}
            >
              <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.08]" />
              <div className="mt-3 h-7 w-20 animate-pulse rounded-[0.55rem] bg-white/[0.1]" />
              <div className="mt-3 h-3 w-28 animate-pulse rounded-full bg-white/[0.08]" />
            </div>
          ))}
        </section>

        <section className="grid gap-4 rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] p-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div>
            <div className="h-3 w-20 animate-pulse rounded-full bg-white/[0.08]" />
            <div className="mt-3 h-7 w-32 animate-pulse rounded-[0.55rem] bg-white/[0.1]" />
            <div className="mt-4 space-y-3 rounded-[1rem] border border-white/[0.08] bg-black/30 p-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  className="h-3 animate-pulse rounded-full bg-white/[0.08]"
                  key={index}
                  style={{ width: `${index % 2 === 0 ? 72 : 54}%` }}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.035] p-4"
                key={index}
              >
                <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.08]" />
                <div className="mt-3 h-7 w-20 animate-pulse rounded-[0.55rem] bg-white/[0.1]" />
              </div>
            ))}
          </div>
        </section>

        <section className="h-20 animate-pulse rounded-[1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08]" />

        <section className="overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
          <div className="border-b border-white/[0.08] px-5 py-4">
            <div className="h-5 w-20 animate-pulse rounded-[0.5rem] bg-white/[0.1]" />
          </div>
          <div className="overflow-hidden">
            <div className="grid grid-cols-[minmax(14rem,1.4fr)_8rem_8rem_8rem_minmax(18rem,1.4fr)_7rem] gap-4 border-b border-white/[0.08] bg-white/[0.03] px-4 py-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  className="h-3 animate-pulse rounded-full bg-white/[0.08]"
                  key={index}
                />
              ))}
            </div>
            {Array.from({ length: 5 }, (_, rowIndex) => (
              <div
                className="grid grid-cols-[minmax(14rem,1.4fr)_8rem_8rem_8rem_minmax(18rem,1.4fr)_7rem] gap-4 border-b border-white/[0.06] px-4 py-4 last:border-b-0"
                key={rowIndex}
              >
                {Array.from({ length: 6 }, (_, columnIndex) => (
                  <div
                    className="h-4 animate-pulse rounded-full bg-white/[0.07]"
                    key={columnIndex}
                    style={{
                      width:
                        columnIndex === 0
                          ? "82%"
                          : columnIndex === 4
                            ? "92%"
                            : "64%",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
