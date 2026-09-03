import { createMonitorTickHandler } from "./runtime.mjs";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

Deno.serve(createMonitorTickHandler({
  environment: {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    CREATOR_TRACKER_MONITOR_TICK_SECRET: Deno.env.get(
      "CREATOR_TRACKER_MONITOR_TICK_SECRET",
    ),
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
    CREATOR_TRACKER_MONITOR_EMAIL_FROM: Deno.env.get(
      "CREATOR_TRACKER_MONITOR_EMAIL_FROM",
    ),
    CREATOR_TRACKER_MONITOR_EMAIL_TO: Deno.env.get(
      "CREATOR_TRACKER_MONITOR_EMAIL_TO",
    ),
  },
}));
