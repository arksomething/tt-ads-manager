import { DashboardIcon } from "@/components/org-dashboard/org-icons";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[0.9rem] bg-white/[0.07] ${className}`}
    />
  );
}

export default function UgcPayLoading() {
  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">UGC Pay</p>
            <h1 className="mt-2 text-xl font-semibold tracking-normal text-foreground">
              Loading creator pay.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Pulling View Tally, TikTok paid delivery, and campaign deals.
            </p>
          </div>

          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.2] px-4 py-3">
            <p className="text-[0.62rem] uppercase text-muted-foreground">
              Selected range
            </p>
            <SkeletonBlock className="mt-2 h-4 w-44" />
            <SkeletonBlock className="mt-2 h-3 w-24" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]">
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16 lg:w-28" />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {["payouts", "videos", "creators", "overview"].map((iconName) => (
          <article
            className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] p-4"
            key={iconName}
          >
            <div className="flex items-start justify-between gap-3">
              <SkeletonBlock className="h-3 w-20" />
              <DashboardIcon
                className="h-4 w-4 text-muted-foreground"
                name={iconName as "payouts" | "videos" | "creators" | "overview"}
              />
            </div>
            <SkeletonBlock className="mt-4 h-8 w-28" />
            <SkeletonBlock className="mt-3 h-4 w-full" />
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03]">
        <div className="border-b border-white/[0.08] px-4 py-3">
          <SkeletonBlock className="h-4 w-36" />
        </div>
        <div className="divide-y divide-white/[0.06]">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="grid gap-3 px-4 py-4 md:grid-cols-5" key={index}>
              <SkeletonBlock className="h-5 md:col-span-2" />
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
              <SkeletonBlock className="h-5" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
