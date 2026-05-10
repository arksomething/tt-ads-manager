import { DashboardIcon } from "@/components/org-dashboard/org-icons";

function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-full bg-white/[0.07] ${className}`}
    />
  );
}

function PanelSkeleton({ title }: { title: string }) {
  return (
    <section className="overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <header className="flex min-h-[5.35rem] items-center justify-between gap-3 border-b border-white/[0.08] px-5">
        <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">
          {title}
        </h2>
        <SkeletonBar className="h-10 w-24 rounded-[0.95rem]" />
      </header>
      <div className="divide-y divide-white/[0.06]">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="flex items-center gap-3 px-5 py-4" key={index}>
            <SkeletonBar className="h-12 w-12 rounded-[1rem]" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-2/3" />
              <SkeletonBar className="h-3 w-1/3" />
            </div>
            <SkeletonBar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ViewTallyLoading() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_auto_auto_auto]">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            className="flex min-h-12 items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4"
            key={index}
          >
            <SkeletonBar className="h-5 w-5" />
            <SkeletonBar className="h-4 flex-1" />
          </div>
        ))}
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        {["videos", "integrations", "viralVideos"].map((iconName) => (
          <article
            className="relative min-h-[6.5rem] overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0C0D10] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
            key={iconName}
          >
            <div className="relative flex items-center gap-4">
              <div className="flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center rounded-[1.15rem] border border-white/[0.08] bg-black">
                <DashboardIcon
                  className="h-7 w-7 text-muted-foreground/55"
                  name={iconName as "videos" | "integrations" | "viralVideos"}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <SkeletonBar className="h-4 w-28" />
                <SkeletonBar className="h-8 w-24" />
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <PanelSkeleton title="Top Videos" />
        <PanelSkeleton title="Top Accounts" />
      </section>
    </div>
  );
}
