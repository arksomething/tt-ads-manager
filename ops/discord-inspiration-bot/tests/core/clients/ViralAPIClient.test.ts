import { ViralAPIClient } from '../../../src/core/clients/ViralAPIClient';

// Mock global fetch
global.fetch = jest.fn();

describe('ViralAPIClient', () => {
  let client: ViralAPIClient;
  const mockApiUrl = 'https://test-api.com';
  const mockApiKey = 'test-api-key';
  const mockBearer = 'test-bearer-token';

  beforeEach(() => {
    client = new ViralAPIClient(mockApiUrl, mockApiKey);
    jest.clearAllMocks();
    // Default mock: return 404 for any unmocked requests
    (global.fetch as jest.Mock).mockResolvedValue({ 
      ok: false, 
      status: 404, 
      statusText: 'Not Found',
      json: async () => ({}) 
    });
  });

  describe('getCreatorStats (aggregated from /videos)', () => {
    it('should aggregate videos by accountUsername', async () => {
      // First page has data, subsequent pages return empty to stop pagination
      let callCount = 0;
      (global.fetch as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              data: [
                { accountUsername: 'testcreator', viewCount: 100, publishedAt: '2024-01-01T00:00:00Z' },
                { accountUsername: 'TESTCREATOR', viewCount: 200, publishedAt: '2024-02-01T00:00:00Z' },
                { accountUsername: 'other', viewCount: 999, publishedAt: '2024-03-01T00:00:00Z' },
              ],
            }),
          });
        } else {
          // Return empty for subsequent pagination requests
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ data: [] }),
          });
        }
      });

      const result = await client.getCreatorStats('testcreator');
      expect(result).toEqual(
        expect.objectContaining({
          id: 'testcreator',
          username: 'testcreator',
          views: 300,
          videosPosted: 2,
        })
      );
    });
  });

  describe('getLeaderboard (aggregated from /videos)', () => {
    it('should rank creators by combined score using API endpoint', async () => {
      // Mock API response with proper leaderboard structure
      const mockLeaderboard = [
        { 
          username: 'alice', 
          views: 150, 
          videos: 2, 
          uniqueDaysPosted: 2,
          consistency: 29  // 2 days out of 7 
        },
        {
          username: 'bob',
          views: 200,
          videos: 1,
          uniqueDaysPosted: 1,
          consistency: 14  // 1 day out of 7
        },
      ];
      
      (global.fetch as jest.Mock).mockResolvedValue({ 
        ok: true, 
        status: 200, 
        statusText: 'OK',
        json: async () => ({ data: mockLeaderboard })
      });

      const result = await client.getLeaderboard({ limit: 2, period: 'weekly' });
      
      // Alice ranks first with higher combined score (better consistency despite fewer views)
      expect(result).toHaveLength(2);
      expect(result[0].creator.username).toBe('alice');
      expect(result[0].creator.views).toBe(150);
      expect(result[1].creator.username).toBe('bob');
      expect(result[1].creator.views).toBe(200);
    });
  });

  describe('getTopCreatorsByViews', () => {
    it('should aggregate creator views inside the provided date range', async () => {
      let callCount = 0;
      (global.fetch as jest.Mock).mockImplementation(() => {
        callCount += 1;

        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              data: [
                { accountUsername: 'Alpha', viewCount: 200, publishedAt: '2026-04-04T12:00:00Z' },
                { accountUsername: 'beta', viewCount: 300, publishedAt: '2026-04-05T12:00:00Z' },
                { accountUsername: 'alpha', viewCount: 150, publishedAt: '2026-04-06T12:00:00Z' },
                { accountUsername: 'legacy', viewCount: 9999, publishedAt: '2026-03-20T12:00:00Z' },
              ],
            }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: [] }),
        });
      });

      const result = await client.getTopCreatorsByViews({
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        limit: 2,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        rank: 1,
        creator: expect.objectContaining({
          username: 'Alpha',
          views: 350,
          videosPosted: 2,
        }),
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        rank: 2,
        creator: expect.objectContaining({
          username: 'beta',
          views: 300,
          videosPosted: 1,
        }),
      }));
    });
  });

  describe('calculateConsistencyScore', () => {
    it('should calculate score for regular posting', () => {
      const score = client.calculateConsistencyScore(30, 30); // 1 post per day
      expect(score).toBe(100);
    });

    it('should calculate score for less frequent posting', () => {
      const score = client.calculateConsistencyScore(15, 30); // 0.5 posts per day
      expect(score).toBe(50);
    });

    it('should cap score at 100 for very frequent posting', () => {
      const score = client.calculateConsistencyScore(60, 30); // 2 posts per day
      expect(score).toBe(100);
    });

    it('should return 0 for no days elapsed', () => {
      const score = client.calculateConsistencyScore(10, 0);
      expect(score).toBe(0);
    });

    it('should return 0 for no videos posted', () => {
      const score = client.calculateConsistencyScore(0, 30);
      expect(score).toBe(0);
    });

    it('should round to nearest integer', () => {
      const score = client.calculateConsistencyScore(25, 30); // 83.33...
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return true for healthy API', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
      });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        `${mockApiUrl}/health`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false for unhealthy API', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Auth handling', () => {
    it('should use x-api-key when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
      await client.getVideos({ perPage: 1 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': mockApiKey, Accept: 'application/json' }),
          method: 'GET',
        })
      );
    });

    it('should retry with bearer on 401 when both are available', async () => {
      const clientBoth = new ViralAPIClient(mockApiUrl, mockApiKey, mockBearer);
      // First call 401, second call OK
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });

      await clientBoth.getVideos({ perPage: 1 });

      const firstCall = (global.fetch as jest.Mock).mock.calls[0][1];
      const secondCall = (global.fetch as jest.Mock).mock.calls[1][1];
      expect(firstCall.headers['x-api-key']).toBe(mockApiKey);
      expect(secondCall.headers['Authorization']).toBe(`Bearer ${mockBearer}`);
    });

    it('should work without API key', async () => {
      const clientWithoutKey = new ViralAPIClient(mockApiUrl);
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
      await clientWithoutKey.getVideos({ perPage: 1 });
      const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBeUndefined();
    });
  });

  describe('/videos query mapping', () => {
    it('should map camelCase query params to snake_case', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
      await client.getVideos({ perPage: 25, sortCol: 'viewCount', sortDir: 'desc', period: 'weekly' });
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('per_page=25');
      expect(url).toContain('sort_col=viewCount');
      expect(url).toContain('sort_dir=desc');
      expect(url).toContain('period=weekly');
    });

    it('should send explicit date range params when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
      await client.getVideos({
        perPage: 25,
        sortCol: 'publishedAt',
        sortDir: 'desc',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
      });
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('start_date=2026-04-01');
      expect(url).toContain('end_date=2026-04-10');
    });

    it('should retry with camelCase params when snake_case is capped at 10 rows', async () => {
      const tenRows = Array.from({ length: 10 }, (_, idx) => ({
        id: `snake-${idx}`,
        accountUsername: `snake-${idx}`,
        viewCount: idx + 1,
        publishedAt: '2026-04-01T00:00:00Z',
      }));
      const twentyFiveRows = Array.from({ length: 25 }, (_, idx) => ({
        id: `camel-${idx}`,
        accountUsername: `camel-${idx}`,
        viewCount: idx + 1,
        publishedAt: '2026-04-01T00:00:00Z',
      }));

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: tenRows }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: twentyFiveRows }),
        });

      const result = await client.getVideos({ page: 1, perPage: 25 });

      expect(result).toHaveLength(25);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('per_page=25');
      expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('perPage=25');
    });

    it('should normalize video metadata needed for direct video links', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: [
            {
              id: 'abc123',
              orgVideoId: 'orgvid_123',
              platformVideoId: '7627492860828454158',
              accountUsername: 'gotall_height',
              platform: 'tiktok',
              publishedAt: '2026-04-11 13:28:40+00',
              publishedDate: '2026-04-11',
              viewCount: 865,
              caption: '@GoTall || #tall #method',
              thumbnailUrl: 'https://assets.viral.app/tiktok/videos/thumbnail/7627492860828454158.webp',
              url: 'https://www.tiktok.com/@gotall_height/video/7627492860828454158',
            },
          ],
        }),
      });

      const result = await client.getVideos({ perPage: 1 });

      expect(result[0]).toEqual(expect.objectContaining({
        id: 'abc123',
        orgVideoId: 'orgvid_123',
        platformVideoId: '7627492860828454158',
        accountUsername: 'gotall_height',
        publishedDate: '2026-04-11',
        caption: '@GoTall || #tall #method',
        thumbnailUrl: 'https://assets.viral.app/tiktok/videos/thumbnail/7627492860828454158.webp',
        videoUrl: 'https://www.tiktok.com/@gotall_height/video/7627492860828454158',
      }));
    });
  });
});
