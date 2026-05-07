import { z } from "zod";

const authEnvSchema = z.object({
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.url().optional(),
});

const supabaseAuthEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_AUTH_KEY: z.string().min(1),
});

const supabaseDatabaseEnvSchema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_SK: z.string().min(1).optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_PK: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.SUPABASE_SERVICE_ROLE_KEY ??
          value.SUPABASE_SK ??
          value.SUPABASE_ANON_KEY ??
          value.SUPABASE_PK,
      ),
    {
      message:
        "Provide a Supabase server key or publishable key alongside SUPABASE_URL.",
    },
  )
  .transform((value) => ({
    SUPABASE_URL: value.SUPABASE_URL,
    SUPABASE_SERVER_KEY:
      value.SUPABASE_SERVICE_ROLE_KEY ??
      value.SUPABASE_SK ??
      value.SUPABASE_ANON_KEY ??
      value.SUPABASE_PK ??
      "",
  }));

const dataProviderEnvSchema = z.object({
  DATA_PROVIDER_BASE_URL: z.url(),
  DATA_PROVIDER_API_KEY: z.string().min(1),
});

const aiEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  OPENAI_BASE_URL: z.url().optional(),
});

const twilioEnvSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
  TWILIO_SMS_FROM: z.string().min(1).optional(),
  TWILIO_WHATSAPP_FROM: z.string().min(1).optional(),
  TWILIO_INBOUND_WEBHOOK_URL: z.url().optional(),
});

const tikTokBusinessEnvSchema = z.object({
  TIKTOK_BUSINESS_BASE_URL: z.url().default("https://business-api.tiktok.com"),
  TIKTOK_AUTH_URL: z.url().default("https://business-api.tiktok.com/portal/auth"),
});

const tikTokBusinessOauthEnvSchema = tikTokBusinessEnvSchema.extend({
  TIKTOK_APP_ID: z.string().min(1),
  TIKTOK_SECRET: z.string().min(1),
  TIKTOK_REDIRECT: z.url(),
});

const singularEnvSchema = z.object({
  SINGULAR_API_BASE_URL: z.url().default("https://api.singular.net"),
  SINGULAR_API_KEY: z.string().min(1),
  SINGULAR_APP_NAMES: z.string().optional(),
  SINGULAR_SOURCE_NAMES: z.string().optional(),
  SINGULAR_COHORT_PERIOD: z.string().min(1).default("7d"),
});

const adaptyRevenueSegmentationValues = [
  "attribution_source",
  "attribution_channel",
  "attribution_campaign",
  "attribution_adgroup",
  "attribution_adset",
  "attribution_creative",
] as const;

const adaptyEnvSchema = z.object({
  ADAPTY_API_BASE_URL: z.url().default("https://api-admin.adapty.io"),
  ADAPTY_API_KEY: z.string().min(1),
  ADAPTY_TIKTOK_SOURCE_PATTERNS: z.string().min(1).default("tiktok,tik tok"),
  ADAPTY_TIKTOK_SEGMENTATION: z
    .enum(adaptyRevenueSegmentationValues)
    .default("attribution_source"),
});

const viewsBaseEnvSchema = z.object({
  VIEWSBASE_BASE_URL: z.url().default("https://www.viewsbase.com"),
  VIEWSBASE_SESSION_COOKIE_NAME: z
    .string()
    .min(1)
    .default("sb-euxaarvxbpiaipzmlesu-auth-token"),
  VIEWSBASE_SESSION_COOKIE_VALUE: z.string().min(1),
  VIEWSBASE_DEFAULT_ORG_SLUG: z.string().min(1).optional(),
});

type AuthEnv = z.infer<typeof authEnvSchema>;
type SupabaseAuthEnv = z.infer<typeof supabaseAuthEnvSchema>;
type SupabaseDatabaseEnv = z.infer<typeof supabaseDatabaseEnvSchema>;
type DataProviderEnv = z.infer<typeof dataProviderEnvSchema>;
type AiEnv = z.infer<typeof aiEnvSchema>;
type TwilioEnv = z.infer<typeof twilioEnvSchema>;
type TikTokBusinessEnv = z.infer<typeof tikTokBusinessEnvSchema>;
type TikTokBusinessOauthEnv = z.infer<typeof tikTokBusinessOauthEnvSchema>;
type SingularEnv = z.infer<typeof singularEnvSchema>;
type AdaptyEnv = z.infer<typeof adaptyEnvSchema>;
type ViewsBaseEnv = z.infer<typeof viewsBaseEnvSchema>;

let cachedAuthEnv: AuthEnv | undefined;
let cachedSupabaseAuthEnv: SupabaseAuthEnv | undefined;
let cachedSupabaseDatabaseEnv: SupabaseDatabaseEnv | undefined;
let cachedDataProviderEnv: DataProviderEnv | undefined;
let cachedAiEnv: AiEnv | undefined;
let cachedTwilioEnv: TwilioEnv | undefined;
let cachedTikTokBusinessEnv: TikTokBusinessEnv | undefined;
let cachedTikTokBusinessOauthEnv: TikTokBusinessOauthEnv | undefined;
let cachedSingularEnv: SingularEnv | undefined;
let cachedAdaptyEnv: AdaptyEnv | undefined;
let cachedViewsBaseEnv: ViewsBaseEnv | undefined;

function getSupabaseUrlEnv() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
}

function getSupabaseAuthKeyEnv() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PK ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SK
  );
}

export function getAuthEnv() {
  if (!cachedAuthEnv) {
    cachedAuthEnv = authEnvSchema.parse({
      AUTH_SECRET: process.env.AUTH_SECRET,
      AUTH_URL: process.env.AUTH_URL,
    });
  }

  return cachedAuthEnv;
}

export function hasSupabaseAuthEnv() {
  return Boolean(getSupabaseUrlEnv() && getSupabaseAuthKeyEnv());
}

export function getSupabaseAuthEnv() {
  if (!cachedSupabaseAuthEnv) {
    cachedSupabaseAuthEnv = supabaseAuthEnvSchema.parse({
      SUPABASE_URL: getSupabaseUrlEnv(),
      SUPABASE_AUTH_KEY: getSupabaseAuthKeyEnv(),
    });
  }

  return cachedSupabaseAuthEnv;
}

export function hasSupabaseDatabaseEnv() {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ??
        process.env.SUPABASE_SK ??
        process.env.SUPABASE_ANON_KEY ??
        process.env.SUPABASE_PK),
  );
}

export function getSupabaseDatabaseEnv() {
  if (!cachedSupabaseDatabaseEnv) {
    cachedSupabaseDatabaseEnv = supabaseDatabaseEnvSchema.parse({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
      SUPABASE_SK: process.env.SUPABASE_SK || undefined,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || undefined,
      SUPABASE_PK: process.env.SUPABASE_PK || undefined,
    });
  }

  return cachedSupabaseDatabaseEnv;
}

export function getDataProviderEnv() {
  if (!cachedDataProviderEnv) {
    cachedDataProviderEnv = dataProviderEnvSchema.parse({
      DATA_PROVIDER_BASE_URL:
        process.env.VIRAL_APP_BASE_URL ?? process.env.DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY:
        process.env.VIRAL_APP_API_KEY ?? process.env.DATA_PROVIDER_API_KEY,
    });
  }

  return cachedDataProviderEnv;
}

export function hasAiEnv() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getAiEnv() {
  if (!cachedAiEnv) {
    cachedAiEnv = aiEnvSchema.parse({
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || undefined,
    });
  }

  return cachedAiEnv;
}

export function hasTwilioEnv() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function isAuthDisabled() {
  return process.env.DISABLE_AUTH?.trim() === "true";
}

export function isGoogleAuthDisabled() {
  return (
    isAuthDisabled() || process.env.DISABLE_GOOGLE_AUTH?.trim() === "true"
  );
}

export function getTwilioEnv() {
  if (!cachedTwilioEnv) {
    cachedTwilioEnv = twilioEnvSchema.parse({
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_MESSAGING_SERVICE_SID:
        process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
      TWILIO_SMS_FROM:
        process.env.TWILIO_SMS_FROM ||
        process.env.TWILIO_FROM_NUMBER ||
        process.env.TWILIO_PHONE_NUMBER ||
        undefined,
      TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || undefined,
      TWILIO_INBOUND_WEBHOOK_URL: process.env.TWILIO_INBOUND_WEBHOOK_URL || undefined,
    });
  }

  return cachedTwilioEnv;
}

export function getTikTokBusinessEnv() {
  if (!cachedTikTokBusinessEnv) {
    cachedTikTokBusinessEnv = tikTokBusinessEnvSchema.parse({
      TIKTOK_BUSINESS_BASE_URL:
        process.env.TIKTOK_BUSINESS_BASE_URL || "https://business-api.tiktok.com",
      TIKTOK_AUTH_URL:
        process.env.TIKTOK_AUTH_URL || "https://business-api.tiktok.com/portal/auth",
    });
  }

  return cachedTikTokBusinessEnv;
}

export function hasTikTokBusinessOauthEnv() {
  return Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_SECRET && process.env.TIKTOK_REDIRECT);
}

export function getTikTokBusinessOauthEnv() {
  if (!cachedTikTokBusinessOauthEnv) {
    cachedTikTokBusinessOauthEnv = tikTokBusinessOauthEnvSchema.parse({
      TIKTOK_BUSINESS_BASE_URL:
        process.env.TIKTOK_BUSINESS_BASE_URL || "https://business-api.tiktok.com",
      TIKTOK_AUTH_URL:
        process.env.TIKTOK_AUTH_URL || "https://business-api.tiktok.com/portal/auth",
      TIKTOK_APP_ID: process.env.TIKTOK_APP_ID,
      TIKTOK_SECRET: process.env.TIKTOK_SECRET,
      TIKTOK_REDIRECT: process.env.TIKTOK_REDIRECT,
    });
  }

  return cachedTikTokBusinessOauthEnv;
}

export function hasSingularEnv() {
  return Boolean(process.env.SINGULAR_API_KEY);
}

export function getSingularEnv() {
  if (!cachedSingularEnv) {
    cachedSingularEnv = singularEnvSchema.parse({
      SINGULAR_API_BASE_URL:
        process.env.SINGULAR_API_BASE_URL || "https://api.singular.net",
      SINGULAR_API_KEY: process.env.SINGULAR_API_KEY,
      SINGULAR_APP_NAMES: process.env.SINGULAR_APP_NAMES || undefined,
      SINGULAR_SOURCE_NAMES: process.env.SINGULAR_SOURCE_NAMES || undefined,
      SINGULAR_COHORT_PERIOD: process.env.SINGULAR_COHORT_PERIOD || "7d",
    });
  }

  return cachedSingularEnv;
}

export function hasAdaptyEnv() {
  return Boolean(process.env.ADAPTY_API_KEY);
}

export function getAdaptyEnv() {
  if (!cachedAdaptyEnv) {
    cachedAdaptyEnv = adaptyEnvSchema.parse({
      ADAPTY_API_BASE_URL:
        process.env.ADAPTY_API_BASE_URL || "https://api-admin.adapty.io",
      ADAPTY_API_KEY: process.env.ADAPTY_API_KEY,
      ADAPTY_TIKTOK_SOURCE_PATTERNS:
        process.env.ADAPTY_TIKTOK_SOURCE_PATTERNS || "tiktok,tik tok",
      ADAPTY_TIKTOK_SEGMENTATION:
        process.env.ADAPTY_TIKTOK_SEGMENTATION || "attribution_source",
    });
  }

  return cachedAdaptyEnv;
}

export function hasViewsBaseEnv() {
  return Boolean(process.env.VIEWSBASE_SESSION_COOKIE_VALUE);
}

export function getViewsBaseEnv() {
  if (!cachedViewsBaseEnv) {
    cachedViewsBaseEnv = viewsBaseEnvSchema.parse({
      VIEWSBASE_BASE_URL:
        process.env.VIEWSBASE_BASE_URL || "https://www.viewsbase.com",
      VIEWSBASE_SESSION_COOKIE_NAME:
        process.env.VIEWSBASE_SESSION_COOKIE_NAME ||
        "sb-euxaarvxbpiaipzmlesu-auth-token",
      VIEWSBASE_SESSION_COOKIE_VALUE: process.env.VIEWSBASE_SESSION_COOKIE_VALUE,
      VIEWSBASE_DEFAULT_ORG_SLUG:
        process.env.VIEWSBASE_DEFAULT_ORG_SLUG || undefined,
    });
  }

  return cachedViewsBaseEnv;
}
