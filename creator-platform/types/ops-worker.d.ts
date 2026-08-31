declare module "../../ops/creator-platform/discord-worker/worker.mjs" {
  export function requestSignature(args: {
    secret: string;
    timestamp: number;
    nonce: string;
    workerId: string;
    method: string;
    pathname: string;
    body: string;
  }): string;
  export function renderTemplate(
    message: {
      templateKey: string;
      templateVersion: number;
      variables?: Record<string, unknown>;
    },
    appUrl: string,
  ): string;
  export function classifyDiscordFailure(
    status: number,
    payload: { code?: number; retry_after?: number },
    retryAfterHeader: string | null,
  ): {
    outcome: string;
    errorClass: string;
    providerCode: number | null;
    retryAfterSeconds: number | null;
  };
}
