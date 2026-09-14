import OpenAI from 'openai';
import { AppConfig } from '../config/Config';
import { HeightService } from './services/HeightService';
import { ImageService } from './services/ImageService';
import { TikTokService } from './services/TikTokService';
import { ViralAPIClient } from './clients/ViralAPIClient';
import { RankingService } from './services/RankingService';
import { StreakService } from './services/RankingService';
import { VisionService } from './services/VisionService';
import { BrandingService } from './services/BrandingService';

/**
 * Dependency Injection Container
 * Manages service lifecycle and dependencies
 */
export class ServiceContainer {
  private services: Map<string, any> = new Map();
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.initializeServices();
  }

  private initializeServices(): void {
    // Initialize external clients
    const openaiClient = new OpenAI({
      apiKey: this.config.openai.apiKey,
    });
    this.services.set('openai', openaiClient);

    const viralClient = new ViralAPIClient(
      this.config.viral.apiUrl,
      this.config.viral.apiKey,
      this.config.viral.bearerToken,
      {
        cacheTtlMs: this.config.viral.cacheTtlMs,
        maxPages: this.config.viral.maxPages,
        defaultPageSize: this.config.viral.pageSize,
        minIntervalMs: this.config.viral.minIntervalMs,
      }
    );
    this.services.set('viralClient', viralClient);

    // Initialize services
    const heightService = new HeightService();
    this.services.set('heightService', heightService);

    const imageService = new ImageService(openaiClient);
    this.services.set('imageService', imageService);

    const rankingService = new RankingService(viralClient);
    this.services.set('rankingService', rankingService);

    const streakService = new StreakService(viralClient);
    this.services.set('streakService', streakService);

    const tiktokService = new TikTokService();
    this.services.set('tiktokService', tiktokService);

    const visionService = new VisionService(openaiClient);
    this.services.set('visionService', visionService);

    const brandingService = new BrandingService(openaiClient, visionService);
    this.services.set('brandingService', brandingService);
  }

  public getOpenAI(): OpenAI {
    return this.services.get('openai');
  }

  public getHeightService(): HeightService {
    return this.services.get('heightService');
  }

  public getImageService(): ImageService {
    return this.services.get('imageService');
  }

  public getViralClient(): ViralAPIClient {
    return this.services.get('viralClient');
  }

  public getRankingService(): RankingService {
    return this.services.get('rankingService');
  }

  public getStreakService(): StreakService {
    return this.services.get('streakService');
  }

  public getTikTokService(): TikTokService {
    return this.services.get('tiktokService');
  }

  public getVisionService(): VisionService {
    return this.services.get('visionService');
  }

  public getBrandingService(): BrandingService {
    return this.services.get('brandingService');
  }

  public getConfig(): AppConfig {
    return this.config;
  }
}

