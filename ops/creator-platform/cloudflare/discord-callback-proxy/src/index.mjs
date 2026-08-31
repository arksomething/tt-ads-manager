const callbackPath = "/api/integrations/discord/callback";
const creatorPlatformOrigin = "https://gotall-creator-platform.vercel.app";

function noStoreHeaders(headers = new Headers()) {
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Referrer-Policy", "no-referrer");
  headers.delete("Set-Cookie");
  return headers;
}

export async function proxyDiscordCallback(request, fetcher = fetch) {
  const incoming = new URL(request.url);
  if (request.method !== "GET" || incoming.pathname !== callbackPath) {
    return new Response("Not found", {
      status: 404,
      headers: noStoreHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8" })),
    });
  }

  const upstreamUrl = new URL(callbackPath, creatorPlatformOrigin);
  upstreamUrl.search = incoming.search;
  try {
    const upstream = await fetcher(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "GoTall-Discord-OAuth-Callback/1.0",
      },
      redirect: "manual",
    });
    const headers = noStoreHeaders(new Headers(upstream.headers));
    headers.delete("Content-Security-Policy-Report-Only");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return new Response("The Discord connection callback is temporarily unavailable.", {
      status: 502,
      headers: noStoreHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8" })),
    });
  }
}

export default {
  async fetch(request) {
    return proxyDiscordCallback(request);
  },
};
