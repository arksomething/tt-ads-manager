type RateLimitErrorLike = {
  status?: unknown;
  message?: unknown;
  retryAfterSeconds?: unknown;
};

const retryAfterMessagePattern =
  /try again in\s+(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?)/i;

export function isProviderRateLimitError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as RateLimitErrorLike;
  return candidate.status === 429;
}

export function parseRetryAfterHeaderMs(
  retryAfter: string | null,
  now = Date.now(),
) {
  if (!retryAfter) {
    return null;
  }

  const numericDelaySeconds = Number(retryAfter);
  if (Number.isFinite(numericDelaySeconds) && numericDelaySeconds >= 0) {
    return Math.ceil(numericDelaySeconds * 1_000);
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - now);
  }

  return null;
}

export function getProviderRateLimitRetryDelayMs(
  error: unknown,
  options?: {
    defaultDelayMs?: number;
    maxDelayMs?: number;
    now?: number;
  },
) {
  const defaultDelayMs = options?.defaultDelayMs ?? 60_000;
  const maxDelayMs = options?.maxDelayMs ?? 30 * 60_000;

  if (!isProviderRateLimitError(error)) {
    return null;
  }

  const candidate = error as RateLimitErrorLike;
  const retryAfterSeconds = Number(candidate.retryAfterSeconds);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(maxDelayMs, Math.ceil(retryAfterSeconds * 1_000));
  }

  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  const match = message.match(retryAfterMessagePattern);

  if (!match) {
    return defaultDelayMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = unit.startsWith("hour")
    ? 60 * 60_000
    : unit.startsWith("minute")
      ? 60_000
      : 1_000;

  return Math.min(maxDelayMs, Math.ceil(amount * unitMs));
}

export function formatRetryDelay(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1_000));

  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
