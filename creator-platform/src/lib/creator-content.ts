export const creatorContentPlatforms = ["TIKTOK", "INSTAGRAM_REELS"] as const;

export type CreatorContentPlatform = (typeof creatorContentPlatforms)[number];

export type CreatorContentSubmissionInput = {
  platform: CreatorContentPlatform;
  url: string;
  nativePostId?: string;
  platformAccountId?: string;
  note?: string;
};

export type CreatorContentValidationResult =
  | { ok: true; value: CreatorContentSubmissionInput }
  | { ok: false; error: string };

const nativePostIdPattern = /^[A-Za-z0-9._:-]{1,191}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function validateCreatorContentInput(
  value: unknown,
): CreatorContentValidationResult {
  const input = recordValue(value);
  if (!input) return { ok: false, error: "Enter the post details." };

  const platform = trimmedString(input.platform).toUpperCase();
  if (platform !== "TIKTOK" && platform !== "INSTAGRAM_REELS") {
    return { ok: false, error: "Choose TikTok or Instagram." };
  }

  const enteredUrl = trimmedString(input.url);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(enteredUrl);
  } catch {
    return { ok: false, error: "Enter a valid post URL." };
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.href.length > 2048
  ) {
    return { ok: false, error: "Enter a valid HTTPS post URL." };
  }

  const expectedDomain = platform === "TIKTOK" ? "tiktok.com" : "instagram.com";
  if (!hostMatches(parsedUrl.hostname.toLowerCase(), expectedDomain)) {
    return {
      ok: false,
      error: platform === "TIKTOK"
        ? "Enter a TikTok URL for this submission."
        : "Enter an Instagram URL for this submission.",
    };
  }

  parsedUrl.hash = "";

  const nativePostId = trimmedString(input.nativePostId);
  if (nativePostId && !nativePostIdPattern.test(nativePostId)) {
    return { ok: false, error: "Check the optional native post ID." };
  }

  const platformAccountId = trimmedString(input.platformAccountId);
  if (platformAccountId && !uuidPattern.test(platformAccountId)) {
    return { ok: false, error: "Choose a valid connected creator account." };
  }

  const note = trimmedString(input.note);
  if (note.length > 1000) {
    return { ok: false, error: "Keep the note under 1,000 characters." };
  }

  return {
    ok: true,
    value: {
      platform,
      url: parsedUrl.href,
      ...(nativePostId ? { nativePostId } : {}),
      ...(platformAccountId ? { platformAccountId } : {}),
      ...(note ? { note } : {}),
    },
  };
}
