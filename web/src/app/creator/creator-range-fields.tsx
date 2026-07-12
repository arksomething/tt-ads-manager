"use client";

import { useMemo, useState } from "react";

type CreatorRangeFieldsProps = {
  endDate: string;
  payMode: "gained" | "posted";
  startDate: string;
};

function addDateOnlyDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatDateLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function CreatorRangeFields({
  endDate: initialEndDate,
  payMode: initialPayMode,
  startDate: initialStartDate,
}: CreatorRangeFieldsProps) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [payMode, setPayMode] = useState(initialPayMode);
  const videoWindowStartDate = useMemo(
    () => addDateOnlyDays(startDate, -7),
    [startDate],
  );
  const includedVideoLabel =
    payMode === "posted"
      ? "Posted in selected range"
      : `Posted ${formatDateLabel(videoWindowStartDate)} to ${formatDateLabel(endDate)}`;
  const inputClassName =
    "mt-2 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground";

  return (
    <>
      <label>
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Start
        </span>
        <input
          className={inputClassName}
          name="startDate"
          onChange={(event) => setStartDate(event.target.value)}
          type="date"
          value={startDate}
        />
      </label>
      <label>
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          End
        </span>
        <input
          className={inputClassName}
          name="endDate"
          onChange={(event) => setEndDate(event.target.value)}
          type="date"
          value={endDate}
        />
      </label>
      <input name="viewWindowMode" type="hidden" value="all" />
      {payMode === "gained" ? (
        <input
          name="videoWindowStartDate"
          type="hidden"
          value={videoWindowStartDate}
        />
      ) : null}
      <label>
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Pay basis
        </span>
        <select
          className={inputClassName}
          name="payMode"
          onChange={(event) =>
            setPayMode(event.target.value === "gained" ? "gained" : "posted")
          }
          value={payMode}
        >
          <option value="gained">Period views</option>
          <option value="posted">Post date</option>
        </select>
      </label>
      <div>
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Included videos
        </span>
        <div className="mt-2 w-full truncate rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground">
          {includedVideoLabel}
        </div>
      </div>
    </>
  );
}
