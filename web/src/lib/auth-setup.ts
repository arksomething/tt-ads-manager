export function isGoogleAuthConfigured() {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_SECRET.length >= 32 &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function isLocalDevAuthBypassEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DISABLE_DEV_AUTH_BYPASS !== "true"
  );
}
