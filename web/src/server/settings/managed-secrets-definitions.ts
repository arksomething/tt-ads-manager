export const managedSecretDefinitions = [
  {
    key: "VIEWSBASE_SESSION_COOKIE_VALUE",
    label: "ViewsBase session cookie",
    shortLabel: "ViewsBase",
    description:
      "Used by Faceless and Revenue to load ViewsBase spend. Paste the full auth cookie value.",
    placeholder: "Paste the ViewsBase auth-token cookie value",
    regenerateInstructions:
      "Log in to ViewsBase in the browser, open DevTools > Application > Cookies, select viewsbase.com, copy the sb-euxaarvxbpiaipzmlesu-auth-token cookie value, and paste it here.",
  },
  {
    key: "SUPERWALL_API_KEY",
    label: "Superwall API key",
    shortLabel: "Superwall",
    description:
      "Used by Revenue to load Superwall proceeds and attribution analytics.",
    placeholder: "Paste the Superwall organization API key",
    regenerateInstructions:
      "In Superwall, open Settings > API Keys, create an organization API key with data:read access, and paste the token here.",
  },
] as const;

export type ManagedSecretKey = (typeof managedSecretDefinitions)[number]["key"];

const managedSecretKeys = new Set<string>(
  managedSecretDefinitions.map((definition) => definition.key),
);

export function isManagedSecretKey(value: string): value is ManagedSecretKey {
  return managedSecretKeys.has(value);
}

export function getManagedSecretDefinition(key: ManagedSecretKey) {
  return managedSecretDefinitions.find((definition) => definition.key === key);
}
