"use client";

import { useEffect, useRef, useState } from "react";

function addDateOnlyDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

// Follows the form's start-date input: whenever the user picks a new start
// date, this field resets to the default window (start - 7 days). Manual
// edits stick until the start date changes again.
export function VideoWindowStartField({
  className,
  defaultValue,
}: {
  className: string;
  defaultValue: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const form = inputRef.current?.form;
    const startDateInput = form?.elements.namedItem("startDate");

    if (!(startDateInput instanceof HTMLInputElement)) {
      return;
    }

    const handleStartDateChange = () => {
      if (startDateInput.value) {
        setValue(addDateOnlyDays(startDateInput.value, -7));
      }
    };

    startDateInput.addEventListener("input", handleStartDateChange);
    return () =>
      startDateInput.removeEventListener("input", handleStartDateChange);
  }, []);

  return (
    <input
      className={className}
      name="videoWindowStartDate"
      onChange={(event) => setValue(event.target.value)}
      ref={inputRef}
      type="date"
      value={value}
    />
  );
}
