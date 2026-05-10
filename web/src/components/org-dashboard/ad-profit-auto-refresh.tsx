"use client";

import { useEffect, useState } from "react";

type AdProfitAutoRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
  label?: string;
  message?: string;
};

export function AdProfitAutoRefresh({
  enabled,
  intervalMs = 10_000,
  label = "Preparing report",
  message = "Singular is preparing this export.",
}: AdProfitAutoRefreshProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.ceil(intervalMs / 1_000),
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setSecondsRemaining(Math.ceil(intervalMs / 1_000));

    const tickId = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(1, current - 1));
    }, 1_000);
    const refreshId = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.location.reload();
      }
    }, intervalMs);

    return () => {
      window.clearInterval(tickId);
      window.clearTimeout(refreshId);
    };
  }, [enabled, intervalMs]);

  if (!enabled) {
    return null;
  }

  return (
    <section className="rounded-[1.35rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] p-4 text-sm text-[#D8FFC8]">
      <p className="text-xs uppercase tracking-[0.2em] text-[#D8FFC8]/80">
        {label}
      </p>
      <p className="mt-2 leading-6">
        {message} This page will reload in {secondsRemaining} second
        {secondsRemaining === 1 ? "" : "s"}.
      </p>
    </section>
  );
}
