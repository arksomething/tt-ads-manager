type SupabasePublicEnv = {
  url: string;
  publishableKey: string;
};

type SupabaseAdminEnv = {
  url: string;
  serviceRoleKey: string;
};

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseAppOrigin(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN must be a valid absolute URL.");
  }

  const localHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "APP_ORIGIN must be an HTTPS origin without a path, query, or credentials.",
    );
  }

  return url.origin;
}

export function getAppOrigin(requestUrl?: string) {
  const configured = firstNonEmpty(process.env.APP_ORIGIN);
  if (configured) return parseAppOrigin(configured);

  if (requestUrl) {
    let requestOrigin: URL | null = null;
    try {
      requestOrigin = new URL(requestUrl);
    } catch {
      // Fall through to the configuration error below.
    }

    if (
      requestOrigin &&
      isLoopbackHostname(requestOrigin.hostname) &&
      (requestOrigin.protocol === "http:" || requestOrigin.protocol === "https:")
    ) {
      return requestOrigin.origin;
    }
  }

  throw new Error("APP_ORIGIN is required outside local development.");
}

export function hasSupabaseAuthEnv() {
  return Boolean(
    firstNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL) &&
      firstNonEmpty(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        process.env.SUPABASE_PUBLISHABLE_KEY,
        process.env.SUPABASE_ANON_KEY,
      ),
  );
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  const url = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
  );
  const publishableKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
  );

  if (!url || !publishableKey) {
    throw new Error(
      "Creator account authentication is not configured. Provide the Supabase URL and publishable key.",
    );
  }

  try {
    new URL(url);
  } catch {
    throw new Error("The configured Supabase URL is not valid.");
  }

  return { url, publishableKey };
}

export function getSupabaseAdminEnv(): SupabaseAdminEnv {
  const url = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
  );
  const serviceRoleKey = firstNonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Server-side Supabase access is not configured. Provide the Supabase URL and service role key.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("The configured Supabase URL is not valid.");
  }

  const localHttp =
    parsedUrl.protocol === "http:" && isLoopbackHostname(parsedUrl.hostname);
  if (
    (parsedUrl.protocol !== "https:" && !localHttp) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error("The configured Supabase URL must use HTTPS.");
  }

  if (serviceRoleKey.length < 20) {
    throw new Error("The configured Supabase service role key is not valid.");
  }

  return { url: parsedUrl.origin, serviceRoleKey };
}
