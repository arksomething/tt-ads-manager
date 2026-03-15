import { z } from "zod";

const authEnvSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

const dataProviderEnvSchema = z.object({
  DATA_PROVIDER_BASE_URL: z.url(),
  DATA_PROVIDER_API_KEY: z.string().min(1),
});

type AuthEnv = z.infer<typeof authEnvSchema>;
type DataProviderEnv = z.infer<typeof dataProviderEnvSchema>;

let cachedAuthEnv: AuthEnv | undefined;
let cachedDataProviderEnv: DataProviderEnv | undefined;

export function getAuthEnv() {
  if (!cachedAuthEnv) {
    cachedAuthEnv = authEnvSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET,
      AUTH_URL: process.env.AUTH_URL,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    });
  }

  return cachedAuthEnv;
}

export function getDataProviderEnv() {
  if (!cachedDataProviderEnv) {
    cachedDataProviderEnv = dataProviderEnvSchema.parse({
      DATA_PROVIDER_BASE_URL: process.env.DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY: process.env.DATA_PROVIDER_API_KEY,
    });
  }

  return cachedDataProviderEnv;
}
