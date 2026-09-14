import { RankingService } from '../../../src/core/services/RankingService';
import { ViralAPIClient, CreatorStats, LeaderboardEntry, VideoAnalyticsItem, CreatorViewsEntry } from '../../../src/core/clients/ViralAPIClient';

// Mock ViralAPIClient
jest.mock('../../../src/core/clients/ViralAPIClient');

describe('RankingService', () => {
  let rankingService: RankingService;
  let mockViralClient: jest.Mocked<ViralAPIClient>;

  beforeEach(() => {
    mockViralClient = new ViralAPIClient('https://test.api', 'test-key') as jest.Mocked<ViralAPIClient>;
    rankingService = new RankingService(mockViralClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLeaderboard', () => {
    it('should fetch and return leaderboard', async () => {
      const mockLeaderboard: LeaderboardEntry[] = [
        {
          rank: 1,
          creator: {
            id: '1',
            username: 'creator1',
            views: 1000000,
            followers: 50000,
            videosPosted: 100,
            uniqueDaysPosted: 28,
            consistencyScore: 95,
          },
          score: 95,
        },
        {
          rank: 2,
          creator: {
            id: '2',
            username: 'creator2',
            views: 500000,
            followers: 30000,
            videosPosted: 80,
            uniqueDaysPosted: 25,
            consistencyScore: 85,
          },
          score: 85,
        },
      ];

      mockViralClient.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await rankingService.getLeaderboard({ period: 'weekly', limit: 10 });

      expect(result.leaderboard).toEqual(mockLeaderboard);
      expect(result.period).toBe('weekly');
      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(mockViralClient.getLeaderboard).toHaveBeenCalledWith({ period: 'weekly', limit: 10 });
    });

    it('should use default options when none provided', async () => {
      mockViralClient.getLeaderboard.mockResolvedValue([]);

      const result = await rankingService.getLeaderboard();

      // Default behavior now uses last 14 days instead of all-time
      expect(result.period).toBe('last-14-days');
      expect(mockViralClient.getLeaderboard).toHaveBeenCalledWith({ sinceDays: 14 });
    });
  });

  describe('getCreatorRank', () => {
    it('should fetch creator stats and calculate rank', async () => {
      const mockCreatorStats: CreatorStats = {
        id: '1',
        username: 'testcreator',
        views: 750000,
        followers: 40000,
        videosPosted: 90,
        uniqueDaysPosted: 27,
        consistencyScore: 90,
      };

      const mockLeaderboard: LeaderboardEntry[] = [
        { rank: 1, creator: { id: '2', username: 'other1', views: 1000000, followers: 50000, videosPosted: 100, uniqueDaysPosted: 28 }, score: 95 },
        { rank: 2, creator: mockCreatorStats, score: 90 },
        { rank: 3, creator: { id: '3', username: 'other2', views: 500000, followers: 30000, videosPosted: 80, uniqueDaysPosted: 25 }, score: 85 },
      ];

      mockViralClient.getCreatorStats.mockResolvedValue(mockCreatorStats);
      mockViralClient.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await rankingService.getCreatorRank('testcreator');

      expect(result).not.toBeNull();
      expect(result?.stats).toEqual(mockCreatorStats);
      expect(result?.rank).toBe(2);
      expect(result?.percentile).toBeDefined();
    });

    it('should return null for non-existent creator', async () => {
      mockViralClient.getCreatorStats.mockResolvedValue(null);

      const result = await rankingService.getCreatorRank('nonexistent');

      expect(result).toBeNull();
      expect(mockViralClient.getLeaderboard).not.toHaveBeenCalled();
    });

    it('should return undefined rank if creator not in leaderboard', async () => {
      const mockCreatorStats: CreatorStats = {
        id: '99',
        username: 'newcreator',
        views: 100,
        followers: 10,
        videosPosted: 5,
      };

      mockViralClient.getCreatorStats.mockResolvedValue(mockCreatorStats);
      mockViralClient.getLeaderboard.mockResolvedValue([]);

      const result = await rankingService.getCreatorRank('newcreator');

      expect(result).not.toBeNull();
      expect(result?.rank).toBeUndefined();
      expect(result?.percentile).toBeUndefined();
    });
  });

  describe('calculateCombinedScore', () => {
    it('should calculate combined score from views and consistency', () => {
      const score = rankingService.calculateCombinedScore(1000000, 90);
      
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(200);
    });

    it('should weight views more heavily than consistency', () => {
      const highViewsLowConsistency = rankingService.calculateCombinedScore(10000000, 50);
      const lowViewsHighConsistency = rankingService.calculateCombinedScore(1000, 100);

      expect(highViewsLowConsistency).toBeGreaterThan(lowViewsHighConsistency);
    });

    it('should handle zero values', () => {
      const score = rankingService.calculateCombinedScore(0, 0);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getBestCreators', () => {
    it('should return top creators by views for an explicit date range', async () => {
      const mockEntries: CreatorViewsEntry[] = [
        {
          rank: 1,
          creator: {
            id: 'alpha',
            username: 'Alpha',
            views: 1500000,
            followers: 0,
            videosPosted: 8,
          },
        },
        {
          rank: 2,
          creator: {
            id: 'beta',
            username: 'beta',
            views: 900000,
            followers: 0,
            videosPosted: 4,
          },
        },
      ];

      mockViralClient.getTopCreatorsByViews.mockResolvedValue(mockEntries);

      const result = await rankingService.getBestCreators({
        limit: 5,
        startDate: '2026-04-01',
        endDate: '2026-04-10',
      });

      expect(result.entries).toEqual(mockEntries);
      expect(result.startDate).toBe('2026-04-01');
      expect(result.endDate).toBe('2026-04-10');
      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(mockViralClient.getTopCreatorsByViews).toHaveBeenCalledWith({
        limit: 5,
        startDate: '2026-04-01',
        endDate: '2026-04-10',
      });
    });

    it('should default to the last 7 days when no range is provided', async () => {
      mockViralClient.getTopCreatorsByViews.mockResolvedValue([]);

      const result = await rankingService.getBestCreators();

      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(mockViralClient.getTopCreatorsByViews).toHaveBeenCalledWith(expect.objectContaining({
        limit: 10,
        startDate: result.startDate,
        endDate: result.endDate,
      }));
    });

    it('should reject partial date ranges', async () => {
      await expect(rankingService.getBestCreators({ startDate: '2026-04-01' }))
        .rejects
        .toThrow('Provide both start_date and end_date, or omit both to use the last 7 days.');
    });

    it('should reject invalid date ordering', async () => {
      await expect(
        rankingService.getBestCreators({ startDate: '2026-04-11', endDate: '2026-04-01' })
      ).rejects.toThrow('start_date must be on or before end_date.');
    });
  });

  describe('getBestVideos', () => {
    it('should default to the last 7 days when no range is provided', async () => {
      mockViralClient.getVideos.mockResolvedValue([]);

      const result = await rankingService.getBestVideos();

      expect(result.windowDays).toBe(7);
      expect(mockViralClient.getVideos).toHaveBeenNthCalledWith(1, {
        perPage: 50,
        page: 1,
        sortCol: 'viewCount',
        sortDir: 'desc',
        sinceDays: 7,
      });
    });

    it('should return top videos with generated links', async () => {
      const now = Date.now();
      const mockVideos: VideoAnalyticsItem[] = [
        {
          platform: 'tiktok',
          platformVideoId: '123',
          accountUsername: 'alpha',
          publishedAt: new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString(),
          viewCount: 1500,
        },
        {
          platform: 'instagram',
          platformVideoId: 'reel_456',
          accountUsername: 'beta',
          publishedAt: new Date(now - (3 * 24 * 60 * 60 * 1000)).toISOString(),
          viewCount: 2500,
        },
      ];

      mockViralClient.getVideos.mockResolvedValueOnce(mockVideos);

      const result = await rankingService.getBestVideos({ sinceDays: 30, limit: 2 });

      expect(result.windowDays).toBe(30);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]).toEqual(expect.objectContaining({
        username: 'beta',
        views: 2500,
        url: 'https://www.instagram.com/reel/reel_456/',
      }));
      expect(result.entries[1]).toEqual(expect.objectContaining({
        username: 'alpha',
        views: 1500,
        url: 'https://www.tiktok.com/@alpha/video/123',
      }));
      expect(mockViralClient.getVideos).toHaveBeenCalledWith({
        perPage: 25,
        page: 1,
        sortCol: 'viewCount',
        sortDir: 'desc',
        sinceDays: 30,
      });
    });

    it('should fall back to client-side window filtering when range query fails', async () => {
      const now = Date.now();
      const recentVideo: VideoAnalyticsItem = {
        platform: 'tiktok',
        platformVideoId: '123',
        accountUsername: 'alpha',
        publishedAt: new Date(now - (5 * 24 * 60 * 60 * 1000)).toISOString(),
        viewCount: 900,
      };
      const oldVideo: VideoAnalyticsItem = {
        platform: 'tiktok',
        platformVideoId: '999',
        accountUsername: 'beta',
        publishedAt: new Date(now - (90 * 24 * 60 * 60 * 1000)).toISOString(),
        viewCount: 5000,
      };

      mockViralClient.getVideos
        .mockRejectedValueOnce(new Error('Internal Server Error'))
        .mockResolvedValueOnce([recentVideo, oldVideo]);

      const result = await rankingService.getBestVideos({ sinceDays: 30, limit: 1 });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual(expect.objectContaining({
        username: 'alpha',
        views: 900,
      }));
      expect(mockViralClient.getVideos).toHaveBeenNthCalledWith(2, {
        perPage: 25,
        page: 1,
        sortCol: 'viewCount',
        sortDir: 'desc',
      });
    });
  });

  describe('formatLeaderboard', () => {
    it('should format leaderboard with medals for top 3', () => {
      const mockResult = {
        leaderboard: [
          { rank: 1, creator: { id: '1', username: 'first', views: 1000000, followers: 50000, videosPosted: 100, uniqueDaysPosted: 28 }, score: 95 },
          { rank: 2, creator: { id: '2', username: 'second', views: 900000, followers: 45000, videosPosted: 90, uniqueDaysPosted: 26 }, score: 90 },
          { rank: 3, creator: { id: '3', username: 'third', views: 800000, followers: 40000, videosPosted: 80, uniqueDaysPosted: 24 }, score: 85 },
        ],
        period: 'weekly',
        generatedAt: new Date(),
      };

      const formatted = rankingService.formatLeaderboard(mockResult, 10);

      expect(formatted).toContain('🥇');
      expect(formatted).toContain('🥈');
      expect(formatted).toContain('🥉');
      expect(formatted).toContain('first');
      expect(formatted).toContain('second');
      expect(formatted).toContain('third');
      expect(formatted).toContain('weekly');
      expect(formatted).toContain('Streak');
    });

    it('should format numbers with K/M suffixes', () => {
      const mockResult = {
        leaderboard: [
          { rank: 1, creator: { id: '1', username: 'creator', views: 1500000, followers: 50000, videosPosted: 100, uniqueDaysPosted: 30 }, score: 95 },
        ],
        period: 'all-time',
        generatedAt: new Date(),
      };

      const formatted = rankingService.formatLeaderboard(mockResult, 10);

      expect(formatted).toContain('1.5M');
    });
  });

  describe('formatCreatorRank', () => {
    it('should format creator stats with rank information', () => {
      const mockRankInfo = {
        stats: {
          id: '1',
          username: 'testcreator',
          views: 750000,
          followers: 40000,
          videosPosted: 90,
          uniqueDaysPosted: 27,
          consistencyScore: 90,
        },
        rank: 2,
        percentile: 75,
      };

      const formatted = rankingService.formatCreatorRank(mockRankInfo);

      expect(formatted).toContain('testcreator');
      expect(formatted).toContain('750.0K');
      expect(formatted).toContain('90');
      expect(formatted).toContain('#2');
      expect(formatted).toContain('Top 25%');
      expect(formatted).toContain('Streak');
    });

    it('should handle missing optional fields', () => {
      const mockRankInfo = {
        stats: {
          id: '1',
          username: 'testcreator',
          views: 1000,
          followers: 100,
          videosPosted: 10,
        },
      };

      const formatted = rankingService.formatCreatorRank(mockRankInfo);

      expect(formatted).toContain('testcreator');
      expect(formatted).not.toContain('Rank');
      expect(formatted).not.toContain('Percentile');
    });
  });
});
