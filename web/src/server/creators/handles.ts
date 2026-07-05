export function normalizeTikTokHandleInput(value: string) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return "";
  }

  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const match = withoutQuery.match(
    /(?:tiktok\.com\/@|^@?)([A-Za-z0-9._]{2,24})\/?$/i,
  );
  const handle = match?.[1] ?? withoutQuery.replace(/^@/, "");

  return handle.trim().replace(/^@/, "");
}
