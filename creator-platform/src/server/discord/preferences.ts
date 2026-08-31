export const discordReminderTopics = [
  "account",
  "onboarding",
  "posting",
  "performance",
  "payments",
] as const;

export type DiscordReminderTopic = (typeof discordReminderTopics)[number];

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function isSupportedTimeZone(value: string) {
  if (!value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseDiscordPreferenceForm(formData: FormData) {
  const timezone = formString(formData, "timezone");
  const quietHoursStart = formString(formData, "quietHoursStart");
  const quietHoursEnd = formString(formData, "quietHoursEnd");
  if (!isSupportedTimeZone(timezone)) {
    return { ok: false as const, error: "Choose a valid timezone." };
  }
  if (!timePattern.test(quietHoursStart) || !timePattern.test(quietHoursEnd)) {
    return { ok: false as const, error: "Choose valid quiet hours." };
  }

  return {
    ok: true as const,
    value: {
      discord_opt_in: formData.get("dmOptIn") === "on",
      timezone,
      quiet_start: quietHoursStart,
      quiet_end: quietHoursEnd,
      topics: Object.fromEntries(discordReminderTopics.map((topic) => [
        topic,
        // Posting and performance reminders stay fail-closed until canonical
        // tracking coverage and an actual posting obligation both exist.
        topic !== "posting" &&
          topic !== "performance" &&
          formData.get(`topic${topic[0].toUpperCase()}${topic.slice(1)}`) === "on",
      ])),
    },
  };
}
