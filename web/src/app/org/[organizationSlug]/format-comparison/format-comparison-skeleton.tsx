"use client";

import type { ReactNode } from "react";

type LoadingStep = {
  detail: string;
  label: string;
  status: "active" | "waiting";
};

export type FormatComparisonLoadingTraceEvent = {
  detail: string;
  elapsedMs?: number;
  key: string;
  label: string;
  progress: number;
  status: "completed" | "failed" | "info" | "started";
};

const defaultLoadingSteps: LoadingStep[] = [
  {
    detail: "Date range, cohort model, and creator filters",
    label: "Preparing request",
    status: "active",
  },
  {
    detail: "Cohorted all organic proceeds by day",
    label: "Revenue proceeds",
    status: "waiting",
  },
  {
    detail: "Paid-deducted UGC views and video cards",
    label: "UGC video rows",
    status: "waiting",
  },
  {
    detail: "Saved tags, repeated videos, and rankings",
    label: "Format tags",
    status: "waiting",
  },
];

type FormatComparisonSkeletonProps = {
  detail?: string;
  steps?: LoadingStep[];
  title?: string;
  traceEvents?: FormatComparisonLoadingTraceEvent[];
};

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[0.8rem] bg-white/[0.055] ${className}`}
    />
  );
}

function SkeletonPanel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[1.35rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] sm:p-5">
      {children}
    </section>
  );
}

function VideoSkeletonCard() {
  return (
    <article className="min-w-0 rounded-[0.85rem] border border-white/[0.08] bg-white/[0.035] p-2.5">
      <SkeletonBlock className="aspect-[4/5] w-full rounded-[0.6rem]" />
      <SkeletonBlock className="mt-3 h-4 w-full" />
      <SkeletonBlock className="mt-2 h-4 w-4/5" />
      <SkeletonBlock className="mt-2 h-3 w-2/3" />
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={index % 2 === 1 ? "flex justify-end" : ""}>
            <SkeletonBlock className="h-9 w-16" />
          </div>
        ))}
      </div>
      <SkeletonBlock className="mt-3 h-9 w-full rounded-[0.55rem]" />
    </article>
  );
}

function LoadingStatusPanel({
  detail,
  steps,
  title,
  traceEvents,
}: Required<FormatComparisonSkeletonProps>) {
  const latestEvent = traceEvents.at(-1);
  const progress = Math.max(Math.min(latestEvent?.progress ?? 1, 100), 0);
  const elapsedMs = latestEvent?.elapsedMs ?? 0;
  const visibleEvents = traceEvents.slice(-6);

  return (
    <section className="rounded-[1rem] border border-[#8AF064]/20 bg-[#8AF064]/[0.055] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-[#B8FF95]">
            Load status
          </p>
          <h2 className="mt-2 text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <p className="max-w-xl text-xs leading-5 text-muted-foreground sm:text-right">
          {detail}
        </p>
      </div>

      <div className="mt-4 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22] p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
              Current operation
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {latestEvent?.label ?? "Starting server trace"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {Math.floor(elapsedMs / 1_000)}s elapsed
          </p>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {latestEvent?.detail ?? detail}
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-[#8AF064] shadow-[0_0_18px_rgba(138,240,100,0.42)] transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
          <span>{Math.round(progress)}%</span>
          <span>{latestEvent ? "Server trace" : "Connecting"}</span>
        </div>
      </div>

      {visibleEvents.length > 0 ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {visibleEvents.map((event, index) => {
            const isLatest = index === visibleEvents.length - 1;

            return (
              <div
                className={`rounded-[0.85rem] border px-3 py-2.5 ${
                  isLatest
                    ? "border-[#8AF064]/35 bg-[#8AF064]/[0.07]"
                    : "border-white/[0.08] bg-black/[0.14]"
                }`}
                key={`${event.key}-${event.status}-${index}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      event.status === "failed"
                        ? "bg-red-300"
                        : event.status === "started" && isLatest
                          ? "animate-pulse bg-[#8AF064] shadow-[0_0_14px_rgba(138,240,100,0.75)]"
                          : event.status === "completed"
                            ? "bg-[#8AF064]/70"
                            : "bg-white/35"
                    }`}
                  />
                  <p className="truncate text-xs font-medium text-foreground">
                    {event.label}
                  </p>
                </div>
                <p className="mt-1 line-clamp-2 text-[0.68rem] leading-4 text-muted-foreground">
                  {event.detail}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <div
            className="rounded-[0.85rem] border border-white/[0.08] bg-black/[0.18] px-3 py-3"
            key={step.label}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  step.status === "active"
                    ? "animate-pulse bg-[#8AF064] shadow-[0_0_14px_rgba(138,240,100,0.75)]"
                    : "bg-white/25"
                }`}
              />
              <p className="text-xs font-medium text-foreground">{step.label}</p>
            </div>
            <p className="mt-2 text-[0.7rem] leading-4 text-muted-foreground">
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FormatComparisonSkeleton({
  detail = "Loading the full report before showing metrics, rankings, or editable video cards.",
  steps = defaultLoadingSteps,
  title = "Loading format comparison",
  traceEvents = [],
}: FormatComparisonSkeletonProps) {
  return (
    <main className="space-y-6">
      <SkeletonPanel>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-3xl">
              <SkeletonBlock className="h-3 w-40" />
              <SkeletonBlock className="mt-4 h-8 w-full max-w-2xl" />
            </div>
            <SkeletonBlock className="h-5 w-48" />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <SkeletonBlock className="h-12 w-full" />
            <SkeletonBlock className="h-12 w-full" />
            <SkeletonBlock className="h-12 w-32" />
          </div>
        </div>
      </SkeletonPanel>

      <LoadingStatusPanel
        detail={detail}
        steps={steps}
        title={title}
        traceEvents={traceEvents}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <article
            className="rounded-[1rem] border border-white/[0.08] bg-white/[0.035] p-4"
            key={index}
          >
            <SkeletonBlock className="h-3 w-28" />
            <SkeletonBlock className="mt-4 h-7 w-36" />
            <SkeletonBlock className="mt-3 h-3 w-full" />
          </article>
        ))}
      </section>

      <SkeletonPanel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-md">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-3 h-6 w-full" />
          </div>
          <SkeletonBlock className="h-4 w-48" />
        </div>

        <div className="mt-5 overflow-x-auto rounded-[0.9rem] border border-white/[0.06]">
          <div className="min-w-[48rem]">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                className="grid grid-cols-[minmax(10rem,1fr)_repeat(5,minmax(5rem,0.45fr))] gap-4 border-b border-white/[0.06] px-4 py-3 last:border-b-0"
                key={index}
              >
                {Array.from({ length: 6 }).map((__, columnIndex) => (
                  <SkeletonBlock
                    className={columnIndex === 0 ? "h-4 w-40" : "ml-auto h-4 w-20"}
                    key={columnIndex}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </SkeletonPanel>

      <section className="space-y-5">
        <div>
          <SkeletonBlock className="h-3 w-28" />
          <SkeletonBlock className="mt-3 h-6 w-32" />
        </div>

        {Array.from({ length: 2 }).map((_, dayIndex) => (
          <article
            className="rounded-[1.25rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.014))] p-4 sm:p-5"
            key={dayIndex}
          >
            <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <SkeletonBlock className="h-3 w-28" />
                <SkeletonBlock className="mt-3 h-7 w-24" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((__, index) => (
                  <SkeletonBlock className="h-9 w-20" key={index} />
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {Array.from({ length: 7 }).map((__, index) => (
                <VideoSkeletonCard key={index} />
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
