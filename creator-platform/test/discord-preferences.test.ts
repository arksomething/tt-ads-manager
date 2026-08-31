import { describe, expect, it } from "vitest";

import {
  isSupportedTimeZone,
  parseDiscordPreferenceForm,
} from "@/server/discord/preferences";

function validForm() {
  const form = new FormData();
  form.set("dmOptIn", "on");
  form.set("timezone", "America/New_York");
  form.set("quietHoursStart", "21:00");
  form.set("quietHoursEnd", "09:00");
  form.set("topicAccount", "on");
  form.set("topicOnboarding", "on");
  form.set("topicPosting", "on");
  form.set("topicPerformance", "on");
  form.set("topicPayments", "on");
  return form;
}

describe("Discord reminder preferences", () => {
  it("accepts IANA timezones and keeps unproven tracking reminders off", () => {
    const result = parseDiscordPreferenceForm(validForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discord_opt_in).toBe(true);
    expect(result.value.topics).toEqual({
      account: true,
      onboarding: true,
      posting: false,
      performance: false,
      payments: true,
    });
  });

  it("rejects invalid timezones and clock values", () => {
    expect(isSupportedTimeZone("Mars/Olympus")).toBe(false);
    const form = validForm();
    form.set("quietHoursStart", "25:00");
    expect(parseDiscordPreferenceForm(form)).toEqual({
      ok: false,
      error: "Choose valid quiet hours.",
    });
  });
});
