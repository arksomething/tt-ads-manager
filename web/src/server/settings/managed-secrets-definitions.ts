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
    key: "ADAPTY_API_KEY",
    label: "Adapty API key",
    shortLabel: "Adapty API",
    description:
      "Used by Revenue to load Adapty proceeds and attribution analytics.",
    placeholder: "Paste the Adapty Admin API key",
    regenerateInstructions:
      "In Adapty, open the app dashboard, go to App settings/API credentials, create or reveal the Admin API key, and paste the key here.",
  },
  {
    key: "ADAPTY_DASHBOARD_TOKEN",
    label: "Adapty dashboard bearer token",
    shortLabel: "Adapty dashboard",
    description:
      "Used by Revenue to load Apple Search Ads spend and dashboard proceeds from Adapty.",
    placeholder: "Paste the dashboard bearer token",
    regenerateInstructions:
      "Open Adapty Ads Manager in the browser, sign in, inspect a network request to api-asa-admin.adapty.io, copy the Authorization bearer token without the Bearer prefix, and paste it here.",
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
