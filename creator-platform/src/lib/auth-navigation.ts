export function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export function sanitizeNextPath(
  value: string | null | undefined,
  fallback = "/account",
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    value.includes("\0")
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, "https://creator-account.invalid");

    if (url.origin !== "https://creator-account.invalid") {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function addAuthMessage(
  path: string,
  key: "error" | "notice",
  message: string,
) {
  const url = new URL(path, "https://creator-account.invalid");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}
