import type { ReactNode } from "react";

import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";

import { publicEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

const authSerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  cardClassName?: string;
};

export function AuthShell({
  title,
  description,
  children,
  footer,
  cardClassName,
}: AuthShellProps) {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#060607] text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_16%_22%,rgba(255,255,255,0.05),transparent_18%),radial-gradient(circle_at_86%_28%,rgba(255,255,255,0.04),transparent_18%),linear-gradient(180deg,#09090b_0%,#040405_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-8rem] top-[-4rem] h-[40rem] w-[18rem] rounded-full bg-white/[0.13] blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[8%] top-[16%] h-[30rem] w-[12rem] rounded-full bg-white/[0.08] blur-[80px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[8%] top-[52%] h-[12rem] w-[12rem] rounded-full bg-white/[0.1] blur-[80px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-full bg-[radial-gradient(circle_at_18%_46%,rgba(255,255,255,0.08),transparent_18%),radial-gradient(circle_at_82%_52%,rgba(255,255,255,0.06),transparent_12%)]"
      />

      <header className="absolute left-0 right-0 top-0 z-20 px-6 py-8 sm:px-8 sm:py-10">
        <Link
          className="inline-flex text-xs font-medium uppercase tracking-[0.22em] text-foreground/88 transition hover:text-foreground"
          href="/"
        >
          {publicEnv.NEXT_PUBLIC_APP_NAME}
        </Link>
      </header>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24 sm:px-8">
        <section
          className={cn(
            "w-full max-w-[28rem] rounded-[2.05rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,18,21,0.8),rgba(10,10,12,0.94))] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-10",
            cardClassName,
          )}
        >
          <div className="flex flex-col items-center text-center">
            <AuthMark />
            <h1
              className={cn(
                authSerif.className,
                "mt-6 text-[2.2rem] font-medium leading-none tracking-[-0.04em] text-foreground sm:text-[2.5rem]",
              )}
            >
              {title}
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>

          <div className="mt-10">{children}</div>

          {footer ? (
            <div className="mt-6 text-center text-xs leading-5 text-muted-foreground">
              {footer}
            </div>
          ) : null}
        </section>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-5 left-1/2 h-1.5 w-11 -translate-x-1/2 rounded-full bg-white/[0.14]"
      />
    </main>
  );
}

export function AuthInfoRow({
  label,
  value,
  adornment,
}: {
  label: string;
  value: string;
  adornment?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-full border border-white/[0.06] bg-black/[0.28] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="min-w-0">
        <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground/90">
          {label}
        </p>
        <p className="mt-1 truncate text-sm text-foreground/84">{value}</p>
      </div>
      {adornment ? <div className="shrink-0">{adornment}</div> : null}
    </div>
  );
}

function AuthMark() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "h-2.5 w-2.5 rounded-full bg-white/90 shadow-[0_0_12px_rgba(255,255,255,0.14)]",
            index === 4 ? "opacity-0" : "",
          )}
        />
      ))}
    </div>
  );
}
