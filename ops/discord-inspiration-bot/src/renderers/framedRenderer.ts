import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

let browserInstance: Browser | null = null;
let browserLaunchTime: number = 0;
const BROWSER_MAX_AGE_MS = 5 * 60 * 1000; // Restart browser after 5 minutes to prevent memory leaks

async function getBrowser(): Promise<Browser> {
  const now = Date.now();
  const browserTooOld = browserLaunchTime > 0 && (now - browserLaunchTime) > BROWSER_MAX_AGE_MS;
  
  if (!browserInstance || !browserInstance.connected || browserTooOld) {
    if (browserInstance) {
      try {
        await Promise.race([
          browserInstance.close(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 3000))
        ]);
      } catch (e) {
        console.warn('⚠️ Failed to close old browser instance:', e);
      }
      browserInstance = null;
    }
    
    console.log('🌐 Launching new Puppeteer browser instance...');
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions'
      ],
      timeout: 30000, // 30 second timeout for browser launch
    });
    browserLaunchTime = now;
    console.log('✅ Browser launched successfully');
  }
  return browserInstance;
}

export async function renderFramedImage(imageBuffer: Buffer, backgroundColor?: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Convert image buffer to base64
    const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    // Load HTML template - handle both dev (ts-node) and production (compiled) paths
    let templatePath = path.join(__dirname, 'framed-template.html');
    if (!fs.existsSync(templatePath)) {
      // Fallback to source path for dev mode
      templatePath = path.join(__dirname, '..', 'renderers', 'framed-template.html');
    }
    if (!fs.existsSync(templatePath)) {
      // Another fallback - try src/renderers
      templatePath = path.join(process.cwd(), 'src', 'renderers', 'framed-template.html');
    }
    const htmlTemplate = fs.readFileSync(templatePath, 'utf-8');

    // Get background color (default to white)
    const bgColor = backgroundColor || '#ffffff';

    // Replace template variables with actual data
    const html = htmlTemplate
      .replace(/\{\{IMAGE_DATA\}\}/g, imageBase64)
      .replace(/\{\{BACKGROUND_COLOR\}\}/g, bgColor);

    // Set viewport size for a larger framed image (1080p width)
    await page.setViewport({
      width: 1080,
      height: 1920, // Portrait orientation
      deviceScaleFactor: 2, // For retina/high-DPI screens
    });

    // Load HTML content - use domcontentloaded instead of networkidle0 to avoid hanging on external resources
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });

    // Wait for the image to load
    try {
      await page.waitForSelector('.framed-image', { timeout: 3000 });
      // Wait for image to load by checking if it's complete
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          // @ts-ignore - document exists in browser context
          const img = document.querySelector('.framed-image');
          if (img && (img as any).complete) {
            resolve();
          } else if (img) {
            (img as any).onload = () => resolve();
            (img as any).onerror = () => resolve(); // Continue even if image fails
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      // If image doesn't load, continue anyway
      console.warn('⚠️ Image loading timeout, continuing anyway');
    }

    // Wait for fonts and rendering
    await new Promise(resolve => setTimeout(resolve, 500));

    // Take screenshot with timeout protection
    const screenshot = await Promise.race([
      page.screenshot({
        type: 'png',
        fullPage: true,
      }) as Promise<Buffer>,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Screenshot timeout after 5 seconds')), 5000)
      )
    ]);

    return screenshot;
  } catch (error) {
    console.error('❌ Error rendering framed image:', error);
    throw error;
  } finally {
    // Close page with timeout protection
    try {
      await Promise.race([
        page.close(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Page close timeout')), 2000)
        )
      ]);
    } catch (closeError) {
      console.warn('⚠️ Failed to close page cleanly:', closeError);
    }
  }
}

export async function closeFramedBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

