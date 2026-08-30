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
