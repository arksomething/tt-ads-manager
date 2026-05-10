type TimingMetadataValue = string | number | boolean | null | undefined;
type TimingMetadata = Record<string, TimingMetadataValue>;

function getDurationMs(startedAt: number) {
  return Math.round((Date.now() - startedAt) * 10) / 10;
}

function getCleanMetadata(metadata: TimingMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, Exclude<TimingMetadataValue, undefined>] => {
      return entry[1] !== undefined;
    }),
  );
}

export function logServerTiming(
  name: string,
  durationMs: number,
  metadata: TimingMetadata = {},
) {
  if (process.env.SERVER_TIMING_LOGS === "0") {
    return;
  }

  console.info(
    JSON.stringify({
      event: "server_timing",
      name,
      durationMs,
      ...getCleanMetadata(metadata),
    }),
  );
}

export async function timeAsync<T>(
  name: string,
  metadata: TimingMetadata,
  callback: () => Promise<T>,
) {
  const startedAt = Date.now();

  try {
    const result = await callback();
    logServerTiming(name, getDurationMs(startedAt), {
      ...metadata,
      status: "ok",
    });
    return result;
  } catch (error) {
    logServerTiming(name, getDurationMs(startedAt), {
      ...metadata,
      status: "error",
      error:
        error instanceof Error
          ? error.name || error.constructor.name
          : "UnknownError",
    });
    throw error;
  }
}

export function timeSync<T>(
  name: string,
  metadata: TimingMetadata,
  callback: () => T,
) {
  const startedAt = Date.now();

  try {
    const result = callback();
    logServerTiming(name, getDurationMs(startedAt), {
      ...metadata,
      status: "ok",
    });
    return result;
  } catch (error) {
    logServerTiming(name, getDurationMs(startedAt), {
      ...metadata,
      status: "error",
      error:
        error instanceof Error
          ? error.name || error.constructor.name
          : "UnknownError",
    });
    throw error;
  }
}
