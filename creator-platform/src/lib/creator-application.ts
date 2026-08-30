export const CREATOR_APPLICATION_PLATFORMS = [
  { value: "TIKTOK", label: "TikTok" },
  { value: "INSTAGRAM_REELS", label: "Instagram" },
] as const;

export type CreatorApplicationPlatform =
  (typeof CREATOR_APPLICATION_PLATFORMS)[number]["value"];

export type CreatorApplicationAccount = {
  platform: CreatorApplicationPlatform;
  handle: string;
};

export type CreatorApplicationInput = {
  name: string;
  phoneNumber: string;
  discordUsername: string;
  accounts: CreatorApplicationAccount[];
};

export type CreatorApplicationValidationResult =
  | { ok: true; value: CreatorApplicationInput }
  | { ok: false; error: string };

export const PROGRAM_DEFAULT_DEAL = {
  label: "Standard creator deal",
  assignment: "server-on-acceptance",
} as const;

export function normalizeCreatorHandle(handle: string) {
  return handle.trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}

export function findDuplicateCreatorAccountIndex(
  accounts: readonly CreatorApplicationAccount[],
) {
  const seen = new Set<string>();

  for (const [index, account] of accounts.entries()) {
    const normalizedHandle = normalizeCreatorHandle(account.handle);
    const key = `${account.platform}:${normalizedHandle}`;

    if (normalizedHandle && seen.has(key)) {
      return index;
    }

    seen.add(key);
  }

  return -1;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeApplicationPhone(value: string) {
  const trimmed = value.trim();

  if (!/^\+[0-9\s().-]+$/u.test(trimmed)) {
    return null;
  }

  const normalized = trimmed.replace(/[\s().-]/gu, "");
  return /^\+[1-9][0-9]{7,14}$/u.test(normalized) ? normalized : null;
}

export function validateCreatorApplicationInput(
  input: unknown,
): CreatorApplicationValidationResult {
  const record = recordValue(input);

  if (!record) {
    return { ok: false, error: "Application details are required." };
  }

  const name = trimmedString(record.name);
  const phoneNumber = normalizeApplicationPhone(trimmedString(record.phoneNumber));
  const discordUsername = trimmedString(record.discordUsername);

  if (name.length < 2 || name.length > 100) {
    return { ok: false, error: "Enter your name." };
  }

  if (!phoneNumber) {
    return { ok: false, error: "Enter a valid phone number." };
  }

  if (discordUsername.length < 2 || discordUsername.length > 64) {
    return { ok: false, error: "Enter your Discord username." };
  }

  if (!Array.isArray(record.accounts) || record.accounts.length < 1) {
    return { ok: false, error: "Add at least one creator account." };
  }

  if (record.accounts.length > 10) {
    return { ok: false, error: "You can add up to 10 creator accounts." };
  }

  const accounts: CreatorApplicationAccount[] = [];

  for (const value of record.accounts) {
    const account = recordValue(value);
    const platform = account?.platform;
    const handle = trimmedString(account?.handle);
    const supported = CREATOR_APPLICATION_PLATFORMS.some(
      (candidate) => candidate.value === platform,
    );

    if (!supported) {
      return { ok: false, error: "Choose TikTok or Instagram for every account." };
    }

    const normalizedHandle = normalizeCreatorHandle(handle);
    if (
      handle.length > 80 ||
      normalizedHandle.length > 64 ||
      !/^[a-z0-9._-]+$/u.test(normalizedHandle)
    ) {
      return { ok: false, error: "Enter a valid handle for every creator account." };
    }

    accounts.push({
      platform: platform as CreatorApplicationPlatform,
      handle,
    });
  }

  if (findDuplicateCreatorAccountIndex(accounts) >= 0) {
    return { ok: false, error: "Each platform and handle may be listed only once." };
  }

  return {
    ok: true,
    value: {
      name,
      phoneNumber,
      discordUsername,
      accounts,
    },
  };
}
