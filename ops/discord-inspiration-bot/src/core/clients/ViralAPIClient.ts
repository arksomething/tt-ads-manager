/**
 * Client for Viral.app API
 * Handles creator analytics and ranking data
 * API Documentation: https://viral.app/api/v1/docs
 */
export interface CreatorStats {
  id: string;
  username: string;
  views: number;
  followers: number;
  videosPosted: number;
  uniqueDaysPosted?: number;  // Number of unique days with posts
  consistencyScore?: number;   // Percentage: uniqueDaysPosted / totalDays * 100
  lastActive?: Date;
}

export interface LeaderboardEntry {
  rank: number;
  creator: CreatorStats;
  score: number;
}

export interface LeaderboardOptions {
  period?: 'daily' | 'weekly' | 'monthly' | 'all-time';
  limit?: number;
  sortBy?: 'views' | 'consistency' | 'combined';
  // Custom time window in days; takes precedence over period for filtering/consistency calc
  sinceDays?: number;
}

export interface CreatorViewsEntry {
  rank: number;
  creator: CreatorStats;
}

// Minimal shape based on docs and screenshot for /videos
export interface VideoAnalyticsItem {
  id?: string;
  orgVideoId?: string;
  platformVideoId?: string;
  accountUsername?: string;
  platform?: string;
  viewCount?: number;
  // If API provides windowed view counts (e.g., last 14 days), we capture it here
  windowViewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  bookmarkCount?: number;
  engagementRate?: number | null;
  publishedAt?: string;
  publishedDate?: string;
  caption?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
}

export interface VideosQueryOptions {
  page?: number;
  perPage?: number;
  sortCol?: 'viewCount' | 'publishedAt' | string;
  sortDir?: 'asc' | 'desc';
  platforms?: string; // comma-separated, e.g., 'tiktok,instagram'
  period?: 'daily' | 'weekly' | 'monthly' | 'all-time';
  // Optional client-side filter
  accountUsername?: string;
  sinceDays?: number;
  startDate?: string;
  endDate?: string;
}

export interface TopCreatorsByViewsOptions {
  limit?: number;
  startDate?: string;
  endDate?: string;
}

export class ViralAPIClient {
  private static readonly MS_PER_DAY = 24 * 60 * 60 * 1000;
  private apiUrl: string;
  private apiKey?: string;
  private bearerToken?: string;
  private cacheTtlMs: number;
  private maxPages: number;
  private defaultPageSize: number;
  private minIntervalMs: number;
  private lastRequestAt = 0;

  private videosCache: Map<string, { at: number; items: VideoAnalyticsItem[] }> = new Map();
  private leaderboardCache: Map<string, { at: number; entries: LeaderboardEntry[] }> = new Map();
  private topCreatorsCache: Map<string, { at: number; entries: CreatorViewsEntry[] }> = new Map();

  constructor(apiUrl: string, apiKey?: string, bearerToken?: string, opts?: { cacheTtlMs?: number; maxPages?: number; defaultPageSize?: number; minIntervalMs?: number }) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.bearerToken = bearerToken;
    this.cacheTtlMs = opts?.cacheTtlMs ?? 120000; // 2 minutes
    this.maxPages = opts?.maxPages ?? 3;
    this.defaultPageSize = opts?.defaultPageSize ?? 100;
    this.minIntervalMs = opts?.minIntervalMs ?? 300;
  }

  private buildHeaders(auth: 'apiKey' | 'bearer' | 'none' = 'none'): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth === 'apiKey' && this.apiKey) headers['x-api-key'] = this.apiKey;
    if (auth === 'bearer' && this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;
    return headers;
  }

  private static sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.minIntervalMs - (now - this.lastRequestAt));
    if (wait > 0) await ViralAPIClient.sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async fetchWithAuth(url: string, init: any = {}): Promise<any> {
    await this.throttle();
    // Decide preferred auth strategy
    const hasApiKey = Boolean(this.apiKey);
    const hasBearer = Boolean(this.bearerToken);
    const first: 'apiKey' | 'bearer' | 'none' = hasApiKey ? 'apiKey' : hasBearer ? 'bearer' : 'none';
    const second: 'apiKey' | 'bearer' | 'none' = first === 'apiKey' ? (hasBearer ? 'bearer' : 'none') : (first === 'bearer' ? (hasApiKey ? 'apiKey' : 'none') : 'none');

    const attempt = async (auth: 'apiKey' | 'bearer' | 'none'): Promise<any> => {
      const headers = {
        ...(init.headers || {}),
        ...this.buildHeaders(auth),
      } as Record<string, string>;
      return await fetch(url, { ...init, headers });
    };

    let res = await attempt(first);
    if (res && (res.status === 401 || res.status === 403) && second !== 'none') {
      res = await attempt(second);
    }

    // Handle 429/503 with Retry-After (one or two retries)
    let retries = 2;
    while (res && (res.status === 429 || res.status === 503) && retries > 0) {
      const retryAfter = Number(res.headers?.get?.('Retry-After'));
      const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * Math.pow(2, 2 - retries);
      await ViralAPIClient.sleep(delay);
      await this.throttle();
      res = await attempt(first);
      retries -= 1;
    }
    return res;
  }

  private buildVideosParams(options: VideosQueryOptions, style: 'snake' | 'camel'): URLSearchParams {
    const params = new URLSearchParams();
    if (options.page) params.append('page', String(options.page));
    if (style === 'snake') {
      if (options.perPage) params.append('per_page', String(options.perPage));
      if (options.sortCol) params.append('sort_col', options.sortCol);
      if (options.sortDir) params.append('sort_dir', options.sortDir);
    } else {
      if (options.perPage) params.append('perPage', String(options.perPage));
      if (options.sortCol) params.append('sortCol', options.sortCol);
      if (options.sortDir) params.append('sortDir', options.sortDir);
    }
    if (options.platforms) params.append('platforms', options.platforms);
    if (options.period) params.append('period', options.period);

    if (options.startDate || options.endDate) {
      if (style === 'snake') {
        if (options.startDate) params.append('start_date', options.startDate);
        if (options.endDate) params.append('end_date', options.endDate);
      } else {
        if (options.startDate) params.append('startDate', options.startDate);
        if (options.endDate) params.append('endDate', options.endDate);
      }
    } else if (options.sinceDays && Number.isFinite(options.sinceDays) && options.sinceDays > 0) {
      const now = new Date();
      const start = new Date(now.getTime() - options.sinceDays * 24 * 60 * 60 * 1000);
      const isoDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
      if (style === 'snake') {
        params.append('start_date', isoDate(start));
        params.append('end_date', isoDate(now));
        // Fallback short-hand some APIs accept
        params.append('days', String(options.sinceDays));
      } else {
        params.append('startDate', isoDate(start));
        params.append('endDate', isoDate(now));
        params.append('days', String(options.sinceDays));
      }
    }
    return params;
  }

  private toDateKey(dateLike?: string): string | undefined {
    if (!dateLike) return undefined;
    const parsed = new Date(dateLike);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10);
  }

  private isWithinDateRange(publishedAt: string | undefined, startDate?: string, endDate?: string): boolean {
    if (!startDate && !endDate) return true;
    const dateKey = this.toDateKey(publishedAt);
    if (!dateKey) return false;
    if (startDate && dateKey < startDate) return false;
    if (endDate && dateKey > endDate) return false;
    return true;
  }

  private extractWindowViews(raw: any, sinceDays?: number): number | undefined {
    if (!sinceDays) return undefined;

    const d = String(sinceDays);
    const candidates = [
      // snake_case
      `views_last_${d}_days`,
      `view_count_last_${d}_days`,
      `views_${d}d`,
      `view_count_${d}d`,
      // camelCase / mixed
      `viewsLast${d}Days`,
      `viewCountLast${d}Days`,
      `views${d}d`,
      `viewCount${d}d`,
    ];

    for (const key of candidates) {
      if (raw[key] !== undefined && raw[key] !== null) {
        const num = Number(raw[key]);
        if (Number.isFinite(num)) return num;
      }
    }
    return undefined;
  }

  private getVideoPublishedAt(video: VideoAnalyticsItem): string | undefined {
    return video.publishedAt ?? video.publishedDate;
  }

  private shouldRetryVideosWithCamelCase(options: VideosQueryOptions, rawItems: any[]): boolean {
    if (rawItems.length <= 1) return true;

    // Viral's /videos endpoint accepts camelCase pagination params. When snake_case is
    // ignored it silently falls back to the default 10-row page size, which truncates
    // creator/video rankings without throwing an error.
    return Boolean(options.perPage && options.perPage > 10 && rawItems.length === 10);
  }

  private estimateVideosPageBudget(startDate?: string, endDate?: string): number {
    if (!startDate || !endDate) return this.maxPages;

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return Math.max(this.maxPages, 10);
    }

    const daySpan = Math.floor((end.getTime() - start.getTime()) / ViralAPIClient.MS_PER_DAY) + 1;
    return Math.min(100, Math.max(this.maxPages, 10, daySpan * 5));
  }

  private normalizeVideoItem(raw: any, sinceDays?: number): VideoAnalyticsItem {
    const viewCount = raw.viewCount ?? raw.view_count ?? raw.views ?? 0;
    const accountUsername = raw.accountUsername ?? raw.account_username ?? raw.username ?? raw.account?.username;
    const publishedAt = raw.publishedAt ?? raw.published_at ?? raw.created_at ?? undefined;
    const publishedDate = raw.publishedDate ?? raw.published_date ?? undefined;
    const likeCount = raw.likeCount ?? raw.like_count ?? raw.likes ?? undefined;
    const commentCount = raw.commentCount ?? raw.comment_count ?? raw.comments ?? undefined;
    const shareCount = raw.shareCount ?? raw.share_count ?? raw.shares ?? undefined;
    const bookmarkCount = raw.bookmarkCount ?? raw.bookmark_count ?? raw.bookmarks ?? undefined;
    const windowViewCount = this.extractWindowViews(raw, sinceDays);
    const caption = raw.caption ?? raw.description ?? raw.text ?? undefined;
    const thumbnailUrl = raw.thumbnailUrl ?? raw.thumbnail_url ?? raw.coverUrl ?? raw.cover_url ?? undefined;
    const videoUrl = raw.url
      ?? raw.videoUrl
      ?? raw.video_url
      ?? raw.permalink
      ?? raw.shareUrl
      ?? raw.share_url
      ?? raw.canonicalUrl
      ?? raw.canonical_url
      ?? undefined;

    return {
      id: raw.id ?? raw.videoId ?? raw.video_id,
      orgVideoId: raw.orgVideoId ?? raw.org_video_id,
      platformVideoId: raw.platformVideoId ?? raw.platform_video_id ?? raw.videoId ?? raw.video_id,
      accountUsername,
      platform: raw.platform ?? raw.platform_name ?? raw.source,
      viewCount,
      windowViewCount,
      likeCount,
      commentCount,
      shareCount,
      bookmarkCount,
      engagementRate: raw.engagementRate ?? raw.engagement_rate ?? null,
      publishedAt,
      publishedDate,
      caption,
      thumbnailUrl,
      videoUrl,
    };
  }

  /**
   * Fetch creator statistics by ID or username
   */
  public async getCreatorStats(identifier: string): Promise<CreatorStats | null> {
    try {
      // Aggregate from /videos by accountUsername with light pagination for coverage
      const normalizedIdentifier = identifier.toLowerCase();
      const perPage = 100;
      const maxPages = 5;
      let page = 1;
      const collected: VideoAnalyticsItem[] = [];

      while (page <= maxPages) {
        const pageItems = await this.getVideos({
          perPage,
          page,
          sortCol: 'publishedAt',
          sortDir: 'desc',
        });

        const pageMatches = pageItems.filter(v => (v.accountUsername || '').toLowerCase() === normalizedIdentifier);
        collected.push(...pageMatches);

        // Heuristic: if a page returns zero, break to avoid unnecessary calls
        if (pageMatches.length === 0 && page > 1) {
          break;
        }
        page += 1;
      }

      if (collected.length === 0) return null;

      const totalViews = collected.reduce((sum, v) => sum + (v.viewCount || 0), 0);
      const videosPosted = collected.length;
      const latest = collected.reduce<string | undefined>((max, v) => {
        const ts = v.publishedAt || '';
        if (!max) return ts;
        return new Date(ts) > new Date(max) ? ts : max;
      }, undefined);

      return {
        id: normalizedIdentifier,
        username: identifier,
        views: totalViews,
        followers: 0,
        videosPosted,
        consistencyScore: this.calculateConsistencyScore(videosPosted, 30),
        lastActive: latest ? new Date(latest) : undefined,
      };
    } catch (error: any) {
      console.error('❌ Error fetching creator stats:', error.message);
      throw error;
    }
  }

  /**
   * Try to fetch leaderboard from API-native endpoints
   * Returns null if endpoints don't exist or fail
   */
  private async tryApiLeaderboard(options: LeaderboardOptions): Promise<LeaderboardEntry[] | null> {
    const periodDays = options.sinceDays ?? (options.period === 'daily' ? 1 : options.period === 'weekly' ? 7 : options.period === 'monthly' ? 30 : 14);
    const limit = options.limit || 10;

    // Try various possible endpoint structures
    const endpoints = [
      // Dedicated leaderboard endpoint
      { url: `${this.apiUrl}/leaderboard`, params: { limit, period: options.period, days: periodDays } },
      { url: `${this.apiUrl}/leaderboards`, params: { limit, period: options.period, days: periodDays } },
      // Creator/account listing with aggregation
      { url: `${this.apiUrl}/creators`, params: { limit: limit * 2, sort: 'views', order: 'desc', days: periodDays } },
      { url: `${this.apiUrl}/accounts`, params: { limit: limit * 2, sort: 'views', order: 'desc', days: periodDays } },
      // Analytics endpoint
      { url: `${this.apiUrl}/analytics/creators`, params: { limit: limit * 2, sort: 'views', order: 'desc', days: periodDays } },
    ];

    for (const endpoint of endpoints) {
      try {
        const params = new URLSearchParams();
        Object.entries(endpoint.params).forEach(([key, value]) => {
          if (value !== undefined) params.append(key, String(value));
        });
        
        const url = `${endpoint.url}${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await this.fetchWithAuth(url, { method: 'GET' });
        
        if (!response.ok) continue; // Try next endpoint
        
        const data = await response.json();
        const items = Array.isArray(data) ? data : (data?.data ?? data?.creators ?? data?.accounts ?? null);
        
        if (!items || items.length === 0) continue;

        // Try to parse as leaderboard data
        const parsed = this.parseApiLeaderboardResponse(items, periodDays, limit);
        if (parsed && parsed.length > 0) {
          console.log(`✅ Using API endpoint: ${endpoint.url}`);
          return parsed;
        }
      } catch (error) {
        // Silently continue to next endpoint
        continue;
      }
    }

    return null; // No API endpoint worked, will use fallback
  }

  /**
   * Parse API response into LeaderboardEntry format
   * Handles various possible response structures
   */
  private parseApiLeaderboardResponse(items: any[], periodDays: number, limit: number): LeaderboardEntry[] | null {
    try {
      const entries = items.slice(0, limit).map((item, idx) => {
        // Extract fields with various naming conventions
        const username = item.username ?? item.accountUsername ?? item.account_username ?? item.name ?? item.id;
        const views = item.views ?? item.viewCount ?? item.view_count ?? item.totalViews ?? item.total_views ?? 0;
        const videos = item.videos ?? item.videosPosted ?? item.videos_posted ?? item.videoCount ?? item.video_count ?? 0;
        const followers = item.followers ?? item.followerCount ?? item.follower_count ?? 0;
        
        // Check for pre-calculated streak/consistency data
        const uniqueDays = item.uniqueDaysPosted ?? item.unique_days_posted ?? item.activeDays ?? item.active_days ?? item.postingDays ?? item.posting_days;
        const consistencyScore = item.consistency ?? item.consistencyScore ?? item.consistency_score;
        const streak = item.streak ?? item.streakDays ?? item.streak_days;

        // Calculate if not provided - use undefined if we truly can't estimate
        // This signals that we should fall back to video aggregation for accurate data
        const calculatedUniqueDays = uniqueDays ?? (streak ? Math.min(streak, periodDays) : undefined);
        const calculatedConsistency = consistencyScore ?? (calculatedUniqueDays !== undefined ? Math.round((calculatedUniqueDays / periodDays) * 100) : undefined);
        const score = item.score ?? this.calculateCombinedScore(views, calculatedConsistency ?? 0);

        const creator: CreatorStats = {
          id: item.id ?? username,
          username,
          views,
          followers,
          videosPosted: videos,
          uniqueDaysPosted: calculatedUniqueDays,
          consistencyScore: calculatedConsistency,
        };

        return {
          rank: idx + 1,
          creator,
          score,
        };
      });

      // Validate we got real data AND that it includes streak information
      // If all entries have undefined uniqueDaysPosted, reject this endpoint
      const hasStreakData = entries.some(e => e.creator.uniqueDaysPosted !== undefined && e.creator.uniqueDaysPosted > 0);
      
      if (entries.length > 0 && entries[0].creator.username && hasStreakData) {
        return entries;
      }
      
      // If we got valid data but no streak info, log it
      if (entries.length > 0 && entries[0].creator.username) {
        console.log('⚠️  API endpoint returned data but no streak information, will try video aggregation');
      }
    } catch (error) {
      // Parsing failed
    }

    return null;
  }

  /**
   * Fetch leaderboard with optional filters
   * First tries dedicated leaderboard/creator endpoints, falls back to video aggregation
   */
  public async getLeaderboard(options: LeaderboardOptions = {}): Promise<LeaderboardEntry[]> {
    try {
      // Cache key for leaderboard
      const cacheKey = JSON.stringify({ method: 'leaderboard', period: options.period, limit: options.limit, sinceDays: options.sinceDays });
      const cached = this.leaderboardCache.get(cacheKey);
      if (cached && Date.now() - cached.at < this.cacheTtlMs) {
        return cached.entries;
      }

      // Try API-native leaderboard/creator endpoints first
      const apiResult = await this.tryApiLeaderboard(options);
      if (apiResult) {
        this.leaderboardCache.set(cacheKey, { at: Date.now(), entries: apiResult });
        return apiResult;
      }

      // Fallback to manual video aggregation
      console.log('⚠️  No API leaderboard endpoint found, using manual video aggregation (slower)');

      // Paginate /videos to reach enough unique creators
      const desired = options.limit || 10;
      const targetUniqueCreators = desired * 2;
      const perPage = this.defaultPageSize;
      const maxPages = this.maxPages;

      const byCreator: Map<string, { views: number; videos: number; postingDays: Set<string> }> = new Map();
      let page = 1;
      let sortCol: 'viewCount' | 'publishedAt' | string = 'viewCount';
      let sortDir: 'asc' | 'desc' = 'desc';

      const candidateSortCols: string[] = options.sinceDays
        ? [
            `views_last_${options.sinceDays}_days`,
            `view_count_last_${options.sinceDays}_days`,
            `views_${options.sinceDays}d`,
            `view_count_${options.sinceDays}d`,
            `viewsLast${options.sinceDays}Days`,
            `viewCountLast${options.sinceDays}Days`,
            'viewCount',
          ]
        : ['viewCount'];

      for (const candidate of candidateSortCols) {
        page = 1;
        sortCol = candidate as any;
        while (page <= maxPages && byCreator.size < targetUniqueCreators) {
          const pageItems = await this.getVideos({ perPage, page, sortCol, sortDir, period: options.period, sinceDays: options.sinceDays });

          if (!pageItems.length) break;

          for (const v of pageItems) {
            const usernameKey = (v.accountUsername || 'unknown').toLowerCase();
            const current = byCreator.get(usernameKey) || { views: 0, videos: 0, postingDays: new Set<string>() };
            const contribution = (options.sinceDays ? (v.windowViewCount ?? v.viewCount) : v.viewCount) || 0;
            current.views += contribution;
            current.videos += 1;
            
            // Track unique posting days (YYYY-MM-DD format)
            if (v.publishedAt) {
              const dayKey = new Date(v.publishedAt).toISOString().slice(0, 10);
              current.postingDays.add(dayKey);
            }
            
            byCreator.set(usernameKey, current);
          }

          if (byCreator.size >= targetUniqueCreators) break;
          page += 1;
        }
        if (byCreator.size >= targetUniqueCreators) break;
      }

      const periodDays = options.sinceDays ?? (options.period === 'daily' ? 1 : options.period === 'weekly' ? 7 : options.period === 'monthly' ? 30 : 30);
      
      // First, calculate scores for all creators
      const withScores = Array.from(byCreator.entries()).map(([username, stats]) => {
        // Calculate consistency: based on unique posting days, not total videos
        // If they posted on 30 out of 30 days = 100 score
        // If they posted on 15 out of 30 days = 50 score
        // Multiple videos on the same day = still counts as just 1 day
        const uniqueDaysPosted = stats.postingDays.size;
        const consistency = Math.round((uniqueDaysPosted / periodDays) * 100);
        const score = this.calculateCombinedScore(stats.views, consistency);
        
        const creator: CreatorStats = {
          id: username,
          username,
          views: stats.views,
          followers: 0,
          videosPosted: stats.videos,
          uniqueDaysPosted,
          consistencyScore: consistency,
        };
        return { creator, score };
      });

      // Then sort by score and assign ranks
      const ranked = withScores
        .sort((a, b) => b.score - a.score)
        .slice(0, desired)
        .map<LeaderboardEntry>((entry, idx) => ({
          rank: idx + 1,
          creator: entry.creator,
          score: entry.score,
        }));

      // Store cache and return
      this.leaderboardCache.set(cacheKey, { at: Date.now(), entries: ranked });
      return ranked;
    } catch (error: any) {
      console.error('❌ Error fetching leaderboard:', error.message);
      // If failed, try stale cache
      const cacheEntry = Array.from(this.leaderboardCache.values()).sort((a,b)=>b.at-a.at)[0];
      if (cacheEntry) return cacheEntry.entries;
      throw error;
    }
  }

  /**
   * Fetch top creators ranked strictly by total views inside a date range.
   */
  public async getTopCreatorsByViews(options: TopCreatorsByViewsOptions = {}): Promise<CreatorViewsEntry[]> {
    try {
      const desired = options.limit || 10;
      const cacheKey = JSON.stringify({
        method: 'topCreatorsByViews',
        limit: desired,
        startDate: options.startDate,
        endDate: options.endDate,
      });
      const cached = this.topCreatorsCache.get(cacheKey);
      if (cached && Date.now() - cached.at < this.cacheTtlMs) {
        return cached.entries;
      }

      const perPage = this.defaultPageSize;
      const maxPages = this.estimateVideosPageBudget(options.startDate, options.endDate);

      const byCreator: Map<string, { username: string; views: number; videos: number; lastActive?: string }> = new Map();

      let page = 1;
      while (page <= maxPages) {
        const pageItems = await this.getVideos({
          perPage,
          page,
          sortCol: options.startDate || options.endDate ? 'publishedAt' : 'viewCount',
          sortDir: 'desc',
          startDate: options.startDate,
          endDate: options.endDate,
        });

        if (!pageItems.length) break;

        for (const video of pageItems) {
          const publishedAt = this.getVideoPublishedAt(video);
          if (!this.isWithinDateRange(publishedAt, options.startDate, options.endDate)) {
            continue;
          }

          const username = (video.accountUsername || 'unknown').trim() || 'unknown';
          const key = username.toLowerCase();
          const current = byCreator.get(key) || {
            username,
            views: 0,
            videos: 0,
            lastActive: undefined as string | undefined,
          };

          current.views += video.viewCount || 0;
          current.videos += 1;

          if (publishedAt && (!current.lastActive || new Date(publishedAt) > new Date(current.lastActive))) {
            current.lastActive = publishedAt;
          }

          byCreator.set(key, current);
        }

        if (!options.startDate && !options.endDate && byCreator.size >= desired * 2) {
          break;
        }

        const allBeforeStart = Boolean(options.startDate)
          && pageItems.every(video => {
            const dateKey = this.toDateKey(this.getVideoPublishedAt(video));
            return Boolean(dateKey && dateKey < options.startDate!);
          });
        if (allBeforeStart) {
          break;
        }

        page += 1;
      }

      const entries = Array.from(byCreator.values())
        .sort((a, b) => b.views - a.views || b.videos - a.videos || a.username.localeCompare(b.username))
        .slice(0, desired)
        .map<CreatorViewsEntry>((entry, index) => ({
          rank: index + 1,
          creator: {
            id: entry.username.toLowerCase(),
            username: entry.username,
            views: entry.views,
            followers: 0,
            videosPosted: entry.videos,
            lastActive: entry.lastActive ? new Date(entry.lastActive) : undefined,
          },
        }));

      this.topCreatorsCache.set(cacheKey, { at: Date.now(), entries });
      return entries;
    } catch (error: any) {
      console.error('❌ Error fetching top creators by views:', error.message);
      const cacheEntry = Array.from(this.topCreatorsCache.values()).sort((a, b) => b.at - a.at)[0];
      if (cacheEntry) return cacheEntry.entries;
      throw error;
    }
  }

  /**
   * Fetch tracked videos with analytics. Used as fallback to approximate leaderboards.
   */
  public async getVideos(options: VideosQueryOptions = {}): Promise<VideoAnalyticsItem[]> {
    try {
      // Check cache first
      const keyBase = { ...options };
      const cacheKey = JSON.stringify({ method: 'videos', ...keyBase, style: 'auto' });
      const cached = this.videosCache.get(cacheKey);
      if (cached && Date.now() - cached.at < this.cacheTtlMs) {
        return cached.items;
      }

      const fetchVideosPage = async (style: 'snake' | 'camel'): Promise<{ ok: boolean; statusText?: string; rawItems: any[] }> => {
        const params = this.buildVideosParams(options, style);
        const url = `${this.apiUrl}/videos${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await this.fetchWithAuth(url, { method: 'GET' });
        if (!response.ok) {
          return { ok: false, statusText: response.statusText, rawItems: [] };
        }

        const data = await response.json();
        return {
          ok: true,
          rawItems: Array.isArray(data) ? data : (data?.data ?? []),
        };
      };

      const snakeResult = await fetchVideosPage('snake');
      let rawItems = snakeResult.rawItems;

      const shouldRetryCamel = !snakeResult.ok || this.shouldRetryVideosWithCamelCase(options, rawItems);
      if (shouldRetryCamel) {
        const camelResult = await fetchVideosPage('camel');
        if (camelResult.ok && camelResult.rawItems.length >= rawItems.length) {
          rawItems = camelResult.rawItems;
        } else if (!snakeResult.ok) {
          throw new Error(`Failed to fetch videos: ${camelResult.statusText ?? snakeResult.statusText ?? 'Unknown error'}`);
        }
      } else if (!snakeResult.ok) {
        throw new Error(`Failed to fetch videos: ${snakeResult.statusText ?? 'Unknown error'}`);
      }

      const normalized: VideoAnalyticsItem[] = rawItems.map((r) => this.normalizeVideoItem(r, options.sinceDays));

      // Optional client-side filter by accountUsername
      const filtered = options.accountUsername
        ? normalized.filter(v => (v.accountUsername || '').toLowerCase() === options.accountUsername!.toLowerCase())
        : normalized;

      // Save to cache
      this.videosCache.set(cacheKey, { at: Date.now(), items: filtered });
      return filtered;
    } catch (error: any) {
      console.error('❌ Error fetching videos:', error.message);
      throw error;
    }
  }

  /**
   * Calculate consistency score based on posting frequency
   * This is a client-side calculation if API doesn't provide it
   * Note: This is a simplified version. For accurate consistency, use getLeaderboard
   * which tracks unique posting days.
   */
  public calculateConsistencyScore(videosPosted: number, daysSinceStart: number): number {
    if (daysSinceStart === 0) return 0;
    
    // Simplified estimate: assume each video is on a unique day (capped at daysSinceStart)
    // In reality, we'd need to track actual unique posting days
    const estimatedUniqueDays = Math.min(videosPosted, daysSinceStart);
    const score = Math.round((estimatedUniqueDays / daysSinceStart) * 100);
    
    return score;
  }

  private calculateCombinedScore(views: number, consistencyScore: number): number {
    const viewsNormalized = Math.log10(views + 1) * 10;
    const combinedScore = (viewsNormalized * 0.7) + (consistencyScore * 0.3);
    return Math.round(combinedScore);
  }

  /**
   * Check if API is available
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithAuth(`${this.apiUrl}/health`, { method: 'GET' });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
