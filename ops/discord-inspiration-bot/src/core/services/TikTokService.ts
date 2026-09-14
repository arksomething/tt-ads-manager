import puppeteer, { Browser } from 'puppeteer';

/**
 * Service for extracting images from TikTok slideshow posts
 */
export class TikTokService {
  private browser: Browser | null = null;

  /**
   * Get or create a browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Validate TikTok URL format
   */
  private isValidTikTokUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return (
        (parsedUrl.hostname === 'www.tiktok.com' || 
         parsedUrl.hostname === 'tiktok.com' ||
         parsedUrl.hostname === 'vm.tiktok.com' ||
         parsedUrl.hostname === 'vt.tiktok.com') &&
        parsedUrl.pathname.length > 1
      );
    } catch {
      return false;
    }
  }

  /**
   * Extract slideshow images from a TikTok URL
   * @param tiktokUrl - The TikTok post URL
   * @returns Array of image buffers
   */
  async extractSlideshowImages(tiktokUrl: string): Promise<Buffer[]> {
    // Validate URL
    if (!this.isValidTikTokUrl(tiktokUrl)) {
      throw new Error('Invalid TikTok URL. Please provide a valid TikTok post URL.');
    }

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Wire up network diagnostics before hitting the page
      page.on('requestfailed', request => {
        console.warn(
          `⚠️ TikTok request failed: ${request.failure()?.errorText} ${request.url()}`
        );
      });
      page.on('response', response => {
        if (!response.ok()) {
          const status = response.status();
          if (status >= 400) {
            console.warn(
              `⚠️ TikTok response ${status} for ${response.url()}`
            );
          }
        }
      });
      page.on('console', msg => {
        try {
          const text = msg.text();
          if (/verify|captcha/i.test(text)) {
            console.warn(`⚠️ TikTok console: ${text}`);
          } else if (msg.type() === 'error') {
            console.warn(`⚠️ TikTok console error: ${text}`);
          }
        } catch {
          // ignore
        }
      });

      // Set user agent to avoid detection
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      console.log(`🔍 Navigating to TikTok URL: ${tiktokUrl}`);
      
      // Navigate to the URL with a timeout
      const gotoResponse = await page.goto(tiktokUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      console.log(
        `🌐 TikTok navigation status: ${gotoResponse?.status() ?? 'unknown'} ${gotoResponse?.statusText() ?? ''} (final URL: ${page.url()})`
      );
      if (page.url().includes('challenge') || page.url().includes('verify')) {
        console.warn('⚠️ TikTok redirected to a challenge page.');
      }

      // Wait a bit for JavaScript to render
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Try to extract images using multiple selectors
      // @ts-ignore - document is available in browser context
      const scrapeResult = await page.evaluate(() => {
        const urlSet = new Set<string>();
        const seenIds = new Set<string>();
        let slideMatchCount = 0;
        
        // @ts-ignore - document is available in browser context
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc) {
          return {
            imageUrls: [],
            debug: {
              totalImages: 0,
              slideMatchCount: 0,
              hasVerifyText: false,
            },
          };
        }

        // Helper to extract unique ID from TikTok image URL
        const extractImageId = (url: string): string | null => {
          // Extract the hash/ID from paths like /tos-useast2a-i-phhotomode-euttp/b74d9a76...
          const match = url.match(/\/([a-f0-9]{8})[^/]*$/i);
          return match ? match[1] : null;
        };

        // Helper to check if URL is valid slideshow image
        const isValidSlideshowImage = (src: string): boolean => {
          if (!src || !src.startsWith('http')) return false;
          
          // Filter out avatars, icons, logos, and other UI elements
          if (src.includes('avt') || 
              src.includes('avatar') || 
              src.includes('profile') ||
              src.includes('icon') ||
              src.includes('logo') ||
              src.includes('default-')) {
            return false;
          }
          
          // Prioritize photomode images (actual slideshow content)
          return src.includes('phhotomode') || src.includes('photomode');
        };

        // Helper to add URL if unique
        const addUniqueUrl = (src: string): void => {
          if (!isValidSlideshowImage(src)) return;
          
          // Check if we've seen this image ID before
          const imageId = extractImageId(src);
          if (imageId && seenIds.has(imageId)) {
            return; // Skip duplicate
          }
          
          if (!urlSet.has(src)) {
            urlSet.add(src);
            if (imageId) seenIds.add(imageId);
          }
        };

        // Strategy 1: Look for slideshow/carousel images
        const slideshowImages = doc.querySelectorAll(
          'img[class*=\"slide\"], img[class*=\"Slide\"], img[data-e2e=\"slide-item\"], [class*=\"carousel\"] img, [class*=\"swiper\"] img'
        );
        slideshowImages.forEach((img: any) => {
          if (isValidSlideshowImage(img.src)) {
            slideMatchCount++;
          }
          addUniqueUrl(img.src);
        });

        // Strategy 2: Look for images in the main video/content container
        const videoContainer = doc.querySelector('[class*="video"], [class*="Video"], [data-e2e="browse-video"]');
        if (videoContainer && urlSet.size === 0) {
          // Only use this fallback if Strategy 1 didn't find anything
          const containerImages = videoContainer.querySelectorAll('img');
          containerImages.forEach((img: any) => {
            addUniqueUrl(img.src);
          });
        }

        // Strategy 3: Look for background images (rare, only if nothing found yet)
        if (urlSet.size === 0) {
          const divsWithBgImages = doc.querySelectorAll('[style*="background-image"]');
          divsWithBgImages.forEach((div: any) => {
            const style = div.style.backgroundImage;
            const match = style.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) {
              addUniqueUrl(match[1]);
            }
          });
        }

        const hasVerifyText = Array.from(doc.querySelectorAll('*')).some((element: any) =>
          typeof element?.textContent === 'string' && /verify|captcha|forbidden/i.test(element.textContent)
        );

        return {
          imageUrls: Array.from(urlSet),
          debug: {
            totalImages: doc.querySelectorAll('img').length,
            slideMatchCount,
            hasVerifyText,
          },
        };
      });
      const imageUrls = scrapeResult.imageUrls;
      console.log(
        `📸 Found ${imageUrls.length} image URLs (DOM imgs: ${scrapeResult.debug.totalImages}, slide matches: ${scrapeResult.debug.slideMatchCount}, verify text: ${scrapeResult.debug.hasVerifyText})`
      );
      if (scrapeResult.debug.hasVerifyText) {
        console.warn('⚠️ TikTok page may be presenting a verification or CAPTCHA challenge.');
      }

      if (imageUrls.length === 0) {
        throw new Error(
          'No slideshow images found. This might be a video post, or the page structure has changed.'
        );
      }

      // Download images
      const imageBuffers: Buffer[] = [];
      for (const url of imageUrls) {
        try {
          console.log(`⬇️ Downloading image: ${url.substring(0, 80)}...`);
          const response = await fetch(url);
          
          if (!response.ok) {
            console.warn(`⚠️ Failed to download image: ${response.status} ${response.statusText}`);
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          // Verify it's a valid image (at least 10KB)
          if (buffer.length > 10000) {
            imageBuffers.push(buffer);
          } else {
            console.warn(`⚠️ Skipping small image (${buffer.length} bytes)`);
          }
        } catch (error) {
          console.warn(`⚠️ Error downloading image from ${url}:`, error);
        }
      }

      if (imageBuffers.length === 0) {
        throw new Error('Failed to download any images. The images might be protected or unavailable.');
      }

      console.log(`✅ Successfully downloaded ${imageBuffers.length} images`);
      return imageBuffers;

    } catch (error: any) {
      console.error('❌ Error extracting TikTok images:', error);
      throw new Error(
        error.message || 'Failed to extract images from TikTok. Please make sure the URL is correct and points to a slideshow post.'
      );
    } finally {
      await page.close();
    }
  }

  /**
   * Close the browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

