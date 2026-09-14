import { ViralAPIClient, LeaderboardEntry, CreatorStats, LeaderboardOptions, VideoAnalyticsItem, CreatorViewsEntry } from '../clients/ViralAPIClient';

export interface RankingResult {
  leaderboard: LeaderboardEntry[];
  period: string;
  generatedAt: Date;
}

export interface CreatorRankInfo {
  stats: CreatorStats;
  rank?: number;
  percentile?: number;
}

export interface BestCreatorsOptions {
  limit?: number;
  startDate?: string;
  endDate?: string;
}

export interface BestCreatorsResult {
  entries: CreatorViewsEntry[];
  startDate: string;
  endDate: string;
  generatedAt: Date;
}

export interface BestVideosOptions {
  sinceDays?: number;
  limit?: number;
}

export interface BestVideoEntry {
  rank: number;
  username: string;
  platform: string;
  views: number;
  publishedAt?: string;
  caption?: string;
  url?: string;
  thumbnailUrl?: string;
  videoId?: string;
}

export interface BestVideosResult {
  entries: BestVideoEntry[];
  windowDays: number;
  generatedAt: Date;
}

/**
 * Service for creator ranking and leaderboard management
 * Handles scoring algorithms and data aggregation
 */
export class RankingService {
  private static readonly ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  private static readonly DEFAULT_ANALYTICS_WINDOW_DAYS = 7;

  constructor(private viralClient: ViralAPIClient) {}

  /**
   * Get leaderboard with scoring
   */
  public async getLeaderboard(options: LeaderboardOptions = {}): Promise<RankingResult> {
    // Default to last 14 days when no specific period is requested or 'all-time' is passed
    const sinceDays = (!options.period || options.period === 'all-time') ? 14 : undefined;
    const leaderboard = await this.viralClient.getLeaderboard({ ...options, sinceDays });
    const periodLabel = sinceDays ? 'last-14-days' : (options.period || 'all-time');
    return {
      leaderboard,
      period: periodLabel,
      generatedAt: new Date(),
    };
  }

  /**
   * Get creator's ranking and stats
   */
  public async getCreatorRank(identifier: string): Promise<CreatorRankInfo | null> {
    const stats = await this.viralClient.getCreatorStats(identifier);
    
    if (!stats) {
      return null;
    }

    // Get full leaderboard to calculate rank
    const leaderboard = await this.viralClient.getLeaderboard({ limit: 100 });
    const creatorEntry = leaderboard.find(entry => entry.creator.id === stats.id);

    return {
      stats,
      rank: creatorEntry?.rank,
      percentile: creatorEntry ? this.calculatePercentile(creatorEntry.rank, leaderboard.length) : undefined,
    };
  }

  /**
   * Get top creators ranked strictly by views inside an inclusive date range.
   * Defaults to the last 7 calendar days when no range is provided.
   */
  public async getBestCreators(options: BestCreatorsOptions = {}): Promise<BestCreatorsResult> {
    const limit = options.limit ?? 10;
    const range = this.resolveDateRange(options.startDate, options.endDate);
    const entries = await this.viralClient.getTopCreatorsByViews({
      limit,
      startDate: range.startDate,
      endDate: range.endDate,
    });

    return {
      entries,
      startDate: range.startDate,
      endDate: range.endDate,
      generatedAt: new Date(),
    };
  }

  /**
   * Get top-performing videos by view count inside a recent time window.
   */
  public async getBestVideos(options: BestVideosOptions = {}): Promise<BestVideosResult> {
    const sinceDays = options.sinceDays ?? RankingService.DEFAULT_ANALYTICS_WINDOW_DAYS;
    const limit = options.limit ?? 10;
    const perPage = Math.min(100, Math.max(limit * 5, 25));
    const maxPages = 5;
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - sinceDays);

    const collected = new Map<string, VideoAnalyticsItem>();
    let shouldFallbackToClientFiltering = false;

    for (let page = 1; page <= maxPages && collected.size < limit * 3; page++) {
      try {
        const batch = await this.viralClient.getVideos({
          perPage,
          page,
          sortCol: 'viewCount',
          sortDir: 'desc',
          sinceDays,
        });

        if (!batch.length) break;
        this.collectBestVideoBatch(collected, batch, cutoffDate, false);
        if (batch.length < perPage) break;
      } catch (error: any) {
        console.log('⚠️  Falling back to client-side date filtering for best videos');
        shouldFallbackToClientFiltering = true;
        break;
      }
    }

    if (shouldFallbackToClientFiltering || collected.size === 0) {
      collected.clear();

      for (let page = 1; page <= maxPages && collected.size < limit * 3; page++) {
        const batch = await this.viralClient.getVideos({
          perPage,
          page,
          sortCol: 'viewCount',
          sortDir: 'desc',
        });

        if (!batch.length) break;
        this.collectBestVideoBatch(collected, batch, cutoffDate, true);
        if (batch.length < perPage) break;
      }
    }

    const entries = Array.from(collected.values())
      .map<BestVideoEntry>((video) => ({
        rank: 0,
        username: video.accountUsername || 'unknown',
        platform: (video.platform || 'unknown').toLowerCase(),
        views: video.windowViewCount ?? video.viewCount ?? 0,
        publishedAt: video.publishedAt ?? video.publishedDate,
        caption: this.normalizeCaption(video.caption),
        url: this.buildVideoUrl(video),
        thumbnailUrl: video.thumbnailUrl,
        videoId: video.platformVideoId ?? video.id ?? video.orgVideoId,
      }))
      .filter((entry) => Number.isFinite(entry.views) && entry.views > 0)
      .sort((a, b) => {
        if (b.views !== a.views) return b.views - a.views;
        const publishedDelta = this.toTimestamp(b.publishedAt) - this.toTimestamp(a.publishedAt);
        if (publishedDelta !== 0) return publishedDelta;
        return a.username.localeCompare(b.username);
      })
      .slice(0, limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return {
      entries,
      windowDays: sinceDays,
      generatedAt: new Date(),
    };
  }

  /**
   * Calculate combined score from views and consistency
   */
  public calculateCombinedScore(views: number, consistencyScore: number): number {
    // Weight: 70% views, 30% consistency
    const viewsNormalized = Math.log10(views + 1) * 10; // Logarithmic scale for views
    const combinedScore = (viewsNormalized * 0.7) + (consistencyScore * 0.3);
    
    return Math.round(combinedScore);
  }

  /**
   * Calculate percentile rank
   */
  private calculatePercentile(rank: number, totalCreators: number): number {
    if (totalCreators === 0) return 0;
    const percentile = ((totalCreators - rank) / totalCreators) * 100;
    return Math.round(percentile);
  }

  private resolveDateRange(startDate?: string, endDate?: string): { startDate: string; endDate: string } {
    if ((startDate && !endDate) || (!startDate && endDate)) {
      throw new Error(`Provide both start_date and end_date, or omit both to use the last ${RankingService.DEFAULT_ANALYTICS_WINDOW_DAYS} days.`);
    }

    if (!startDate && !endDate) {
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - (RankingService.DEFAULT_ANALYTICS_WINDOW_DAYS - 1));

      return {
        startDate: RankingService.toIsoDate(start),
        endDate: RankingService.toIsoDate(end),
      };
    }

    const parsedStart = this.parseIsoDate(startDate!, 'start_date');
    const parsedEnd = this.parseIsoDate(endDate!, 'end_date');
    if (parsedStart.getTime() > parsedEnd.getTime()) {
      throw new Error('start_date must be on or before end_date.');
    }

    return {
      startDate: RankingService.toIsoDate(parsedStart),
      endDate: RankingService.toIsoDate(parsedEnd),
    };
  }

  private parseIsoDate(value: string, fieldName: 'start_date' | 'end_date'): Date {
    if (!RankingService.ISO_DATE_PATTERN.test(value)) {
      throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || RankingService.toIsoDate(parsed) !== value) {
      throw new Error(`${fieldName} must be a valid calendar date in YYYY-MM-DD format.`);
    }

    return parsed;
  }

  private static toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private collectBestVideoBatch(
    collected: Map<string, VideoAnalyticsItem>,
    batch: VideoAnalyticsItem[],
    cutoffDate: Date,
    enforceCutoff: boolean
  ): void {
    for (const video of batch) {
      const key = this.getVideoIdentity(video);
      const views = video.windowViewCount ?? video.viewCount ?? 0;

      if (!key || !video.accountUsername || !Number.isFinite(views) || views <= 0) {
        continue;
      }

      if (!this.isVideoWithinWindow(video, cutoffDate, enforceCutoff)) {
        continue;
      }

      const existing = collected.get(key);
      const existingViews = existing ? (existing.windowViewCount ?? existing.viewCount ?? 0) : -1;
      if (!existing || views > existingViews) {
        collected.set(key, video);
      }
    }
  }

  private getVideoIdentity(video: VideoAnalyticsItem): string | undefined {
    const fallbackIdentity = [video.platform, video.accountUsername, video.publishedAt, video.caption]
      .filter(Boolean)
      .join(':');

    let identity = video.platformVideoId;
    if (!identity) identity = video.id;
    if (!identity) identity = video.orgVideoId;
    if (!identity) identity = video.videoUrl;
    if (!identity) identity = fallbackIdentity || undefined;
    return identity;
  }

  private isVideoWithinWindow(video: VideoAnalyticsItem, cutoffDate: Date, enforceCutoff: boolean): boolean {
    const dateValue = video.publishedAt ?? video.publishedDate;
    if (!dateValue) return !enforceCutoff;

    const publishedMs = Date.parse(dateValue);
    if (!Number.isFinite(publishedMs)) return !enforceCutoff;

    return publishedMs >= cutoffDate.getTime();
  }

  private buildVideoUrl(video: VideoAnalyticsItem): string | undefined {
    if (video.videoUrl?.startsWith('http://') || video.videoUrl?.startsWith('https://')) {
      return video.videoUrl;
    }

    const username = video.accountUsername?.replace(/^@/, '');
    const platformVideoId = video.platformVideoId ?? video.id ?? video.orgVideoId;
    const platform = (video.platform || '').toLowerCase();

    if (!platformVideoId) return undefined;

    if (platform === 'tiktok' && username) {
      return `https://www.tiktok.com/@${username}/video/${platformVideoId}`;
    }

    if (platform === 'instagram') {
      return `https://www.instagram.com/reel/${platformVideoId}/`;
    }

    if (platform === 'youtube' || platform === 'youtube_shorts') {
      return `https://www.youtube.com/watch?v=${platformVideoId}`;
    }

    return undefined;
  }

  private normalizeCaption(caption?: string): string | undefined {
    if (!caption) return undefined;
    return caption.replace(/\s+/g, ' ').trim();
  }

  private toTimestamp(dateValue?: string): number {
    if (!dateValue) return 0;
    const timestamp = Date.parse(dateValue);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }


  /**
   * Format leaderboard for display
   */
  public formatLeaderboard(result: RankingResult, limit: number = 10): string {
    const entries = result.leaderboard.slice(0, limit);
    
    let text = `## 🏆 Creator Leaderboard (${result.period})\n\n`;
    
    entries.forEach((entry, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${entry.rank}.`;
      const streak = entry.creator.uniqueDaysPosted ?? 0;
      const streakEmoji = streak >= 25 ? '🔥' : streak >= 15 ? '⚡' : '📅';
      
      text += `${medal} **${entry.creator.username}**\n`;
      text += `   ${streakEmoji} Streak: ${streak} days | `;
      text += `Views: ${this.formatNumber(entry.creator.views)}\n\n`;
    });

    return text;
  }

  /**
   * Format creator rank information
   */
  public formatCreatorRank(info: CreatorRankInfo): string {
    let text = `## 📊 Your Creator Stats\n\n`;
    text += `**Username:** ${info.stats.username}\n`;
    
    // Show streak first if available
    if (info.stats.uniqueDaysPosted !== undefined) {
      const streak = info.stats.uniqueDaysPosted;
      const streakEmoji = streak >= 25 ? '🔥' : streak >= 15 ? '⚡' : '📅';
      text += `**${streakEmoji} Posting Streak:** ${streak} days\n`;
    }
    
    text += `**Views:** ${this.formatNumber(info.stats.views)}\n`;
    text += `**Videos Posted:** ${info.stats.videosPosted}\n`;
    
    if (info.stats.consistencyScore !== undefined) {
      text += `**Consistency:** ${info.stats.consistencyScore}%\n`;
    }
    
    if (info.rank !== undefined) {
      text += `\n**Your Rank:** #${info.rank}\n`;
    }
    
    if (info.percentile !== undefined) {
      text += `**Percentile:** Top ${100 - info.percentile}%\n`;
    }

    return text;
  }

  /**
   * Format large numbers with K/M suffix
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }
}

export interface StreakOptions {
  sinceDays?: number; // time window to inspect, defaults to 60
  limit?: number; // number of creators to return, defaults to 10
  mode?: 'current' | 'longest'; // current consecutive days up to today, or longest streak within window
}

export interface StreakEntry {
  rank: number;
  username: string;
  streakDays: number;
  videosPosted: number;
  lastPostAt?: string;
}

export interface StreakResult {
  entries: StreakEntry[];
  windowDays: number;
  generatedAt: Date;
  mode: 'current' | 'longest';
}

export class StreakCalculator {
  public static toDayKey(dateIso: string): string {
    // Keep UTC dates consistent; consider only date part
    return new Date(dateIso).toISOString().slice(0, 10);
  }

  public static computeCurrentStreak(dayKeys: Set<string>, today = new Date()): number {
    let streak = 0;
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    while (true) {
      const key = cursor.toISOString().slice(0, 10);
      if (!dayKeys.has(key)) break;
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }

  public static computeLongestStreak(sortedDayKeysAsc: string[]): number {
    if (sortedDayKeysAsc.length === 0) return 0;
    let best = 1;
    let cur = 1;
    for (let i = 1; i < sortedDayKeysAsc.length; i++) {
      const prev = new Date(sortedDayKeysAsc[i - 1]);
      const curDate = new Date(sortedDayKeysAsc[i]);
      const diffDays = Math.round((+curDate - +prev) / (24 * 60 * 60 * 1000));
      if (diffDays === 1) {
        cur += 1;
        if (cur > best) best = cur;
      } else if (diffDays > 1) {
        cur = 1;
      }
    }
    return best;
  }
}

export class StreakService {
  constructor(private viralClient: ViralAPIClient) {}

  public async getStreakLeaderboard(options: StreakOptions = {}): Promise<StreakResult> {
    const sinceDays = options.sinceDays ?? 60;
    const limit = options.limit ?? 10;
    const mode: 'current' | 'longest' = options.mode ?? 'current';

    // Collect videos across a few pages using existing pagination limits from client settings
    const perPage = 100;
    const maxPages = 5;

    const byUserDays: Map<string, Set<string>> = new Map();
    let page = 1;
    
    // Calculate cutoff date for client-side filtering
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - sinceDays);
    
    while (page <= maxPages) {
      try {
        // Try with sinceDays first
        let batch: any[];
        try {
          batch = await this.viralClient.getVideos({ perPage, page, sortCol: 'publishedAt', sortDir: 'desc', sinceDays });
        } catch (firstError: any) {
          // If sinceDays causes error (500), try without it and filter client-side
          if (firstError.message?.includes('Internal Server Error') || firstError.message?.includes('500')) {
            console.log('⚠️  API /videos endpoint fails with sinceDays parameter, trying without it');
            batch = await this.viralClient.getVideos({ perPage, page, sortCol: 'publishedAt', sortDir: 'desc' });
          } else {
            throw firstError;
          }
        }
        
        if (!batch.length) break;
        
        for (const v of batch) {
          const username = (v.accountUsername || 'unknown').toLowerCase();
          if (!v.publishedAt) continue;
          
          // Client-side date filtering if we couldn't use sinceDays parameter
          const publishDate = new Date(v.publishedAt);
          if (publishDate < cutoffDate) continue;
          
          const dayKey = StreakCalculator.toDayKey(v.publishedAt);
          const set = byUserDays.get(username) || new Set<string>();
          set.add(dayKey);
          byUserDays.set(username, set);
        }
        page += 1;
      } catch (error: any) {
        console.error(`❌ Failed to fetch videos for streak calculation (page ${page}):`, error.message);
        break; // Stop pagination on error
      }
    }

    const entries: StreakEntry[] = [];
    for (const [username, daySet] of byUserDays.entries()) {
      const sorted = Array.from(daySet.values()).sort();
      const streak = mode === 'current'
        ? StreakCalculator.computeCurrentStreak(daySet)
        : StreakCalculator.computeLongestStreak(sorted);
      const lastPostAt = sorted.length ? sorted[sorted.length - 1] : undefined;
      entries.push({ rank: 0, username, streakDays: streak, videosPosted: daySet.size, lastPostAt });
    }

    const ranked = entries
      .sort((a, b) => b.streakDays - a.streakDays || b.videosPosted - a.videosPosted || a.username.localeCompare(b.username))
      .slice(0, limit)
      .map((e, idx) => ({ ...e, rank: idx + 1 }));

    // If we got no data, log a warning
    if (ranked.length === 0) {
      console.log('⚠️  No streak data available - API may not support video queries');
    }

    return {
      entries: ranked,
      windowDays: sinceDays,
      generatedAt: new Date(),
      mode,
    };
  }
}
