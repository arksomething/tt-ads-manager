import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface VideoMilestoneConfig {
  enabled: boolean;
  channelId: string;
  pollIntervalMs: number;
  viewThreshold: number;
  stateFilePath: string;
  notificationRoleId: string;
  guildId: string;
}

export interface AppConfig {
  discord: {
    token: string;
    clientId: string;
  };
  openai: {
    apiKey: string;
  };
  viral: {
    apiKey?: string;
    apiUrl: string;
    bearerToken?: string;
    cacheTtlMs?: number;
    maxPages?: number;
    pageSize?: number;
    minIntervalMs?: number;
  };
  milestones: VideoMilestoneConfig;
  environment: 'development' | 'production';
}

export class Config {
  private static instance: Config;
  private config: AppConfig;

  private constructor() {
    this.config = this.loadAndValidate();
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private loadAndValidate(): AppConfig {
    const missingVars: string[] = [];
    const environment = (process.env.NODE_ENV as 'development' | 'production') || 'development';

    const discordToken = process.env.DISCORD_TOKEN;
    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const milestoneEnabled = parseBooleanEnv(process.env.VIDEO_MILESTONE_ENABLED, true);
    const milestoneChannelId = process.env.VIDEO_MILESTONE_CHANNEL_ID || '1481528900025847838';
    const milestonePollIntervalMs = parsePositiveNumberEnv(
      process.env.VIDEO_MILESTONE_POLL_INTERVAL_MS,
      10 * 60 * 1000,
      'VIDEO_MILESTONE_POLL_INTERVAL_MS'
    );
    const milestoneViewThreshold = parsePositiveNumberEnv(
      process.env.VIDEO_MILESTONE_VIEW_THRESHOLD,
      100000,
      'VIDEO_MILESTONE_VIEW_THRESHOLD'
    );
    const milestoneStateFilePath = process.env.VIDEO_MILESTONE_STATE_FILE_PATH || '/app/data/video-milestones.json';

    // Required variables
    if (!discordToken) missingVars.push('DISCORD_TOKEN');
    if (!discordClientId) missingVars.push('DISCORD_CLIENT_ID');
    if (!openaiApiKey) missingVars.push('OPENAI_API_KEY');

    if (missingVars.length > 0) {
      throw new Error(
        `❌ Missing required environment variables: ${missingVars.join(', ')}\n` +
        'Please check your .env file and ensure all required variables are set.'
      );
    }

    return {
      discord: {
        token: discordToken!,
        clientId: discordClientId!,
      },
      openai: {
        apiKey: openaiApiKey!,
      },
      viral: {
        apiKey: process.env.VIRAL_API_KEY,
        apiUrl: process.env.VIRAL_API_URL || 'https://viral.app/api/v1',
        bearerToken: process.env.VIRAL_BEARER_TOKEN,
        cacheTtlMs: process.env.VIRAL_CACHE_TTL_MS ? Number(process.env.VIRAL_CACHE_TTL_MS) : undefined,
        maxPages: process.env.VIRAL_MAX_PAGES ? Number(process.env.VIRAL_MAX_PAGES) : undefined,
        pageSize: process.env.VIRAL_PAGE_SIZE ? Number(process.env.VIRAL_PAGE_SIZE) : undefined,
        minIntervalMs: process.env.VIRAL_MIN_INTERVAL_MS ? Number(process.env.VIRAL_MIN_INTERVAL_MS) : undefined,
      },
      milestones: {
        enabled: milestoneEnabled,
        channelId: milestoneChannelId,
        pollIntervalMs: milestonePollIntervalMs,
        viewThreshold: milestoneViewThreshold,
        stateFilePath: milestoneStateFilePath,
        notificationRoleId: process.env.INSPIRATION_ROLE_ID || '',
        guildId: process.env.DISCORD_GUILD_ID || '1400610531189985310',
      },
      environment,
    };
  }

  public get(): AppConfig {
    return this.config;
  }

  public isProduction(): boolean {
    return this.config.environment === 'production';
  }

  public isDevelopment(): boolean {
    return this.config.environment === 'development';
  }
}

// Export singleton instance getter
export const getConfig = (): AppConfig => Config.getInstance().get();

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  throw new Error(`Invalid boolean value: "${value}"`);
}

function parsePositiveNumberEnv(
  value: string | undefined,
  fallback: number,
  fieldName: string
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return parsed;
}
