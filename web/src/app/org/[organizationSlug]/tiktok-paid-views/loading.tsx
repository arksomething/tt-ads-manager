function LoadingStatCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}

export default function TikTokPaidViewsLoading() {
  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Ad profitability
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              Loading your TikTok ad dashboard...
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The app is checking the saved advertiser connection and loading the
              live paid ranking.
            </p>
          </div>

          <div className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground">
            Loading...
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <LoadingStatCard
            label="Connection"
            meta="Checking the saved advertiser for this workspace."
            value="Loading"
          />
          <LoadingStatCard
            label="Status"
            meta="Validating the latest TikTok account state."
            value="Loading"
          />
          <LoadingStatCard
            label="Metric"
            meta="Preparing the default paid-performance view."
            value="Loading"
          />
          <LoadingStatCard
            label="Date window"
            meta="Resolving the report range before the API call runs."
            value="Loading"
          />
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Dashboard
          </p>
          <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
            Pulling live ad performance now.
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            TikTok reporting and revenue matching can take a few seconds on a cold
            load.
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22]"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
