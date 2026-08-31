declare module "../../ops/creator-platform/cloudflare/discord-callback-proxy/src/index.mjs" {
  export function proxyDiscordCallback(
    request: Request,
    fetcher?: typeof fetch,
  ): Promise<Response>;
}
