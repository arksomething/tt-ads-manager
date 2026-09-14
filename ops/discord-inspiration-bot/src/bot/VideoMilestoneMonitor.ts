import { Client, EmbedBuilder } from 'discord.js';
import { VideoMilestoneConfig } from '../config/Config';
import { VideoAnalyticsItem, ViralAPIClient } from '../core/clients/ViralAPIClient';
import { VideoMilestoneRecord, VideoMilestoneStateStore } from '../core/storage/VideoMilestoneStateStore';
import { notificationPayload } from './InspirationSubscriptions';

export class VideoMilestoneMonitor {
  private static readonly PAGE_SIZE = 100;
  private static readonly MAX_SCAN_PAGES = 20;

  private readonly stateStore: VideoMilestoneStateStore;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;

  constructor(
    private readonly client: Client,
    private readonly viralClient: ViralAPIClient,
    private readonly config: VideoMilestoneConfig
  ) {
    this.stateStore = new VideoMilestoneStateStore(config.stateFilePath);
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    try {
      if (!this.config.enabled) {
        console.log('ℹ️ Video milestone monitor disabled');
        return;
      }

      await this.stateStore.load();

      if (!this.stateStore.isInitialized()) {
        const seededCount = await this.seedExistingMilestones();
        console.log(
          `ℹ️ Seeded ${seededCount} existing ${this.formatThreshold(this.config.viewThreshold)}+ video(s) without posting`
        );
      } else {
        try {
          await this.poll();
        } catch (error) {
          console.error('❌ Initial video milestone poll failed, will retry on the next interval:', error);
        }
      }

      this.scheduleNextPoll();
      console.log(
        `⏰ Video milestone monitor started for channel ${this.config.channelId} every ${Math.round(this.config.pollIntervalMs / 60000)} minute(s)`
      );
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  public stop(): void {
    this.started = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextPoll(): void {
    if (!this.started || !this.config.enabled) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runScheduledPoll();
    }, this.config.pollIntervalMs);
  }

  private async runScheduledPoll(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      console.error('❌ Video milestone poll failed:', error);
    } finally {
      this.scheduleNextPoll();
    }
  }

  private async seedExistingMilestones(): Promise<number> {
    const eligibleVideos = await this.fetchEligibleVideos();
    const records = eligibleVideos
      .map((video) => this.buildRecord(video))
      .filter((record): record is VideoMilestoneRecord => record !== null);

    await this.stateStore.initializeWith(records);
    return records.length;
  }

  private async poll(): Promise<void> {
    const eligibleVideos = await this.fetchEligibleVideos();
    let postedCount = 0;

    for (const video of eligibleVideos) {
      const record = this.buildRecord(video);

      if (!record) {
        console.warn('⚠️ Skipping milestone candidate with no stable identity');
        continue;
      }

      if (this.stateStore.hasAnnounced(record.videoKey, record.threshold)) {
        continue;
      }

      await this.postVideoMilestone(video, record);
      postedCount += 1;
    }

    console.log(
      `ℹ️ Video milestone poll complete: ${eligibleVideos.length} eligible video(s), ${postedCount} new announcement(s)`
    );
  }

  private async fetchEligibleVideos(): Promise<VideoAnalyticsItem[]> {
    const eligibleByKey = new Map<string, VideoAnalyticsItem>();

    for (let page = 1; page <= VideoMilestoneMonitor.MAX_SCAN_PAGES; page += 1) {
      const batch = await this.viralClient.getVideos({
        page,
        perPage: VideoMilestoneMonitor.PAGE_SIZE,
        sortCol: 'viewCount',
        sortDir: 'desc',
      });

      if (batch.length === 0) {
        break;
      }

      for (const video of batch) {
        const views = this.getViews(video);
        if (views < this.config.viewThreshold) {
          continue;
        }

        const key = this.buildVideoKey(video);
        if (!key || eligibleByKey.has(key)) {
          continue;
        }

        eligibleByKey.set(key, video);
      }

      const lastItemViews = this.getViews(batch[batch.length - 1]);
      if (batch.length < VideoMilestoneMonitor.PAGE_SIZE || lastItemViews < this.config.viewThreshold) {
        break;
      }
    }

    return Array.from(eligibleByKey.values()).sort((left, right) => this.getViews(right) - this.getViews(left));
  }

  private async postVideoMilestone(video: VideoAnalyticsItem, record: VideoMilestoneRecord): Promise<void> {
    const channel = await this.client.channels.fetch(this.config.channelId);

    if (!channel) {
      throw new Error(`Channel not found: ${this.config.channelId}`);
    }

    if (!channel.isTextBased() || !('send' in channel) || typeof channel.send !== 'function') {
      throw new Error(`Channel is not sendable: ${this.config.channelId}`);
    }

    const embed = this.buildEmbed(video, record.url);
    const payload = { ...notificationPayload(this.config.notificationRoleId, record.url), embeds: [embed] };

    await channel.send(payload);
    await this.stateStore.recordAnnouncement(record);

    console.log(`✅ Posted ${this.formatThreshold(this.config.viewThreshold)} milestone for ${record.videoKey}`);
  }

  private buildEmbed(video: VideoAnalyticsItem, url?: string): EmbedBuilder {
    const caption = this.normalizeCaption(video.caption);
    const embed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle(`${this.formatThreshold(this.config.viewThreshold)} Milestone`)
      .setDescription(`A tracked video crossed ${this.formatNumber(this.config.viewThreshold)} views.`)
      .addFields(
        {
          name: 'Name',
          value: this.truncate(this.buildVideoName(video), 1024),
          inline: false,
        },
        {
          name: 'Account',
          value: this.displayAccount(video),
          inline: true,
        },
        {
          name: 'Views',
          value: this.formatNumber(this.getViews(video)),
          inline: true,
        },
        {
          name: 'Likes',
          value: this.formatOptionalNumber(video.likeCount),
          inline: true,
        },
        {
          name: 'Platform',
          value: this.formatPlatform(video.platform),
          inline: true,
        }
      )
      .setTimestamp(new Date());

    const publishedAt = this.formatPublishedAt(video.publishedAt ?? video.publishedDate);
    if (publishedAt) {
      embed.addFields({
        name: 'Published',
        value: publishedAt,
        inline: true,
      });
    }

    if (caption) {
      embed.addFields({
        name: 'Caption',
        value: this.truncate(caption, 1024),
        inline: false,
      });
    }

    if (url) {
      embed.setURL(url);
    }

    if (video.thumbnailUrl?.startsWith('http://') || video.thumbnailUrl?.startsWith('https://')) {
      embed.setThumbnail(video.thumbnailUrl);
    }

    return embed;
  }

  private buildMilestoneContent(url?: string): string | undefined {
    const parts: string[] = [];


    if (url) {
      parts.push(url);
    }

    if (parts.length === 0) {
      return undefined;
    }

    return parts.join(' ');
  }

  private buildRecord(video: VideoAnalyticsItem): VideoMilestoneRecord | null {
    const videoKey = this.buildVideoKey(video);
    if (!videoKey) {
      return null;
    }

    return {
      videoKey,
      threshold: this.config.viewThreshold,
      channelId: this.config.channelId,
      announcedAt: new Date().toISOString(),
      url: this.resolveVideoUrl(video),
      username: this.normalizeUsername(video.accountUsername),
    };
  }

  private buildVideoKey(video: VideoAnalyticsItem): string | null {
    const platform = this.normalizeIdentityPart(video.platform) || 'unknown';
    const stableId = this.normalizeIdentityPart(video.platformVideoId ?? video.id ?? video.orgVideoId);

    if (stableId) {
      return `${platform}:${stableId}`;
    }

    const fallbackParts = [
      platform === 'unknown' ? '' : platform,
      this.normalizeIdentityPart(video.accountUsername),
      this.toDateKey(video.publishedAt ?? video.publishedDate),
      this.normalizeIdentityPart(this.normalizeCaption(video.caption), 120),
    ].filter(Boolean);

    if (fallbackParts.length >= 2) {
      return fallbackParts.join('|');
    }

    const directUrl = this.resolveVideoUrl(video);
    return directUrl ? directUrl.toLowerCase() : null;
  }

  private resolveVideoUrl(video: VideoAnalyticsItem): string | undefined {
    if (video.videoUrl?.startsWith('http://') || video.videoUrl?.startsWith('https://')) {
      return video.videoUrl;
    }

    const platform = (video.platform || '').toLowerCase();
    const username = this.normalizeUsername(video.accountUsername);
    const videoId = video.platformVideoId ?? video.id ?? video.orgVideoId;

    if (platform === 'tiktok' && username && videoId) {
      return `https://www.tiktok.com/@${username}/video/${videoId}`;
    }

    if (platform === 'instagram' && videoId) {
      return `https://www.instagram.com/reel/${videoId}/`;
    }

    return undefined;
  }

  private buildVideoName(video: VideoAnalyticsItem): string {
    const caption = this.normalizeCaption(video.caption);
    if (caption) {
      return this.truncate(caption, 200);
    }

    return `${this.formatPlatform(video.platform)} video from ${this.displayAccount(video)}`;
  }

  private displayAccount(video: VideoAnalyticsItem): string {
    const username = this.normalizeUsername(video.accountUsername);
    return username ? `@${username}` : 'Unknown';
  }

  private normalizeUsername(username?: string): string | undefined {
    if (!username) {
      return undefined;
    }

    const normalized = username.trim().replace(/^@/, '');
    return normalized || undefined;
  }

  private normalizeCaption(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
  }

  private normalizeIdentityPart(value?: string, maxLength = 80): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);

    return normalized || undefined;
  }

  private toDateKey(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toISOString().slice(0, 10);
  }

  private getViews(video: VideoAnalyticsItem): number {
    const value = video.viewCount ?? video.windowViewCount ?? 0;
    return Number.isFinite(value) ? value : 0;
  }

  private formatPlatform(platform?: string): string {
    if (!platform) {
      return 'Unknown';
    }

    const normalized = platform.trim();
    if (!normalized) {
      return 'Unknown';
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private formatPublishedAt(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  }

  private formatOptionalNumber(value?: number): string {
    if (!Number.isFinite(value ?? NaN)) {
      return 'Unknown';
    }

    return this.formatNumber(value!);
  }

  private formatThreshold(value: number): string {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 0,
    }).format(value).toUpperCase();
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    if (maxLength <= 3) {
      return value.slice(0, maxLength);
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }
}
