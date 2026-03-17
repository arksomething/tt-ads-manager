import { createHash } from "node:crypto";

const REQUEST_TOKEN_REGEX = /\bBV-[A-Z0-9]{4,8}\b/i;
const LABELLED_CODE_REGEXES = [
  /spark\s*code\s*[:\-]?\s*([A-Za-z0-9+/=._-]{6,256})/gi,
  /auth\s*code\s*[:\-]?\s*([A-Za-z0-9+/=._-]{6,256})/gi,
  /code\s*[:\-]?\s*([A-Za-z0-9+/=._-]{6,256})/gi,
];
const GENERIC_TOKEN_REGEX = /\b[A-Za-z0-9+/=._-]{6,256}\b/g;

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isLikelySparkCode(candidate: string) {
  const trimmed = candidate.trim();

  if (trimmed.length < 6 || trimmed.length > 256) {
    return false;
  }

  if (!/^[A-Za-z0-9+/=._-]+$/.test(trimmed)) {
    return false;
  }

  if (!/[A-Za-z0-9]/.test(trimmed)) {
    return false;
  }

  return true;
}

function dedupeCandidates(candidates: string[]) {
  const unique = new Set<string>();
  const ordered: string[] = [];

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    const lookupKey = normalized.toLowerCase();

    if (unique.has(lookupKey)) {
      continue;
    }

    unique.add(lookupKey);
    ordered.push(normalized);
  }

  return ordered;
}

export function extractRequestToken(messageBody: string) {
  const normalized = normalizeWhitespace(messageBody);
  const match = normalized.match(REQUEST_TOKEN_REGEX);

  return match?.[0]?.toUpperCase() ?? null;
}

export function extractSparkCodeCandidates(messageBody: string) {
  const normalized = normalizeWhitespace(messageBody);
  const candidates: string[] = [];

  for (const expression of LABELLED_CODE_REGEXES) {
    for (const match of normalized.matchAll(expression)) {
      const candidate = match[1]?.trim();

      if (!candidate || !isLikelySparkCode(candidate)) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  for (const match of normalized.matchAll(GENERIC_TOKEN_REGEX)) {
    const candidate = match[0]?.trim();

    if (!candidate || !isLikelySparkCode(candidate)) {
      continue;
    }

    if (REQUEST_TOKEN_REGEX.test(candidate)) {
      continue;
    }

    candidates.push(candidate);
  }

  return dedupeCandidates(candidates);
}

export function hashSparkCode(rawCode: string) {
  return createHash("sha256").update(rawCode, "utf8").digest("hex");
}

export function parseSparkMessageBody(messageBody: string) {
  const normalizedBody = normalizeWhitespace(messageBody);
  const requestToken = extractRequestToken(normalizedBody);
  const candidates = extractSparkCodeCandidates(normalizedBody);

  return {
    normalizedBody,
    requestToken,
    candidates,
  };
}
