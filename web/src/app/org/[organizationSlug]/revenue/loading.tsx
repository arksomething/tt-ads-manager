import type { ReactNode } from "react";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[0.8rem] bg-white/[0.055] ${className}`}
    />
  );
}

function SkeletonPanel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      {children}
    </section>
  );
}

export default function RevenueLoading() {
  return (
    <div className="space-y-4">
      <SkeletonPanel>
        <SkeletonBlock className="h-3 w-48" />
        <SkeletonBlock className="mt-4 h-8 w-full max-w-xl" />
        <SkeletonBlock className="mt-3 h-4 w-full max-w-3xl" />
        <SkeletonBlock className="mt-2 h-4 w-2/3 max-w-2xl" />
        <div className="mt-5 flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonBlock className="h-8 w-32 rounded-full" key={index} />
          ))}
        </div>
      </SkeletonPanel>

      <SkeletonPanel>
        <SkeletonBlock className="h-3 w-24" />
        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <SkeletonBlock className="h-11 w-full" />
          <SkeletonBlock className="h-11 w-full" />
          <SkeletonBlock className="h-11 w-28" />
        </div>
      </SkeletonPanel>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4"
            key={index}
          >
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-4 h-7 w-32" />
            <SkeletonBlock className="mt-3 h-3 w-full" />
          </div>
        ))}
      </section>

      {Array.from({ length: 3 }).map((_, index) => (
        <SkeletonPanel key={index}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-md">
              <SkeletonBlock className="h-3 w-36" />
              <SkeletonBlock className="mt-3 h-6 w-full" />
            </div>
            <SkeletonBlock className="h-4 w-48" />
          </div>
          <SkeletonBlock className="mt-5 h-56 w-full" />
        </SkeletonPanel>
      ))}
    </div>
  );
}
