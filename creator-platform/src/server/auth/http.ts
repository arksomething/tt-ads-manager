import type { NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";

export function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function getRawFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function authRedirectUrl(
  request: NextRequest,
  path: string,
  args?: {
    error?: string | null;
    notice?: string | null;
    next?: string | null;
  },
) {
  const url = new URL(path, request.url);

  if (args?.error) url.searchParams.set("error", args.error);
  if (args?.notice) url.searchParams.set("notice", args.notice);
  if (args?.next) url.searchParams.set("next", sanitizeNextPath(args.next));

  return url;
}

export function validatePasswordPair(password: string, confirmation: string) {
  if (password.length < 10) {
    return "Use a password with at least 10 characters.";
  }

  if (password.length > 128) {
    return "Use a password with no more than 128 characters.";
  }

  if (password !== confirmation) {
    return "The passwords do not match.";
  }

  return null;
}
