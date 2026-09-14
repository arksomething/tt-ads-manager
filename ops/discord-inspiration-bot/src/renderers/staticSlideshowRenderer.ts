import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

interface StaticSlideData {
  label: string; // e.g., "CURRENT HEIGHT", "MOM'S HEIGHT", "DAD'S HEIGHT"
  height: string; // e.g., "5'7"
  iconType: 'person' | 'female' | 'male';
  age?: number;
  backgroundColor?: string; // Optional background color (default: white)
}

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

function generatePersonIcon(iconType: 'person' | 'female' | 'male'): string {
  // Use Font Awesome 6.4+ icons
  if (iconType === 'female') {
    // Font Awesome 6.4+ has fa-person-dress for female representation
    return '<i class="fas fa-person-dress"></i>';
  } else if (iconType === 'male') {
    // Use fa-person for male (or fa-user-tie for more masculine look, but fa-person is cleaner)
    return '<i class="fas fa-person"></i>';
  } else {
    // Gender-neutral person icon
    return '<i class="fas fa-person"></i>';
  }
}

export async function renderStaticSlide(data: StaticSlideData): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Load HTML template - handle both dev (ts-node) and production (compiled) paths
    let templatePath = path.join(__dirname, 'static-slideshow-template.html');
    if (!fs.existsSync(templatePath)) {
      // Fallback to source path for dev mode
      templatePath = path.join(__dirname, '..', 'renderers', 'static-slideshow-template.html');
    }
    if (!fs.existsSync(templatePath)) {
      // Another fallback - try src/renderers
      templatePath = path.join(process.cwd(), 'src', 'renderers', 'static-slideshow-template.html');
    }
    const htmlTemplate = fs.readFileSync(templatePath, 'utf-8');

    // Generate person icon SVG
    const personIcon = generatePersonIcon(data.iconType);

    // Build age section if provided
    const ageSection = data.age !== undefined 
      ? `<div class="age-value">AGE ${data.age}</div>`
      : '';

    // Get background color (default to white)
    const bgColor = data.backgroundColor || '#ffffff';

    // Replace template variables
    const html = htmlTemplate
      .replace(/\{\{LABEL\}\}/g, data.label)
      .replace(/\{\{HEIGHT\}\}/g, data.height)
      .replace(/\{\{PERSON_ICON\}\}/g, personIcon)
      .replace(/\{\{AGE_SECTION\}\}/g, ageSection)
      .replace(/\{\{BACKGROUND_COLOR\}\}/g, bgColor);

    // Set viewport size (portrait, similar to slideshow images)
    await page.setViewport({
      width: 1080,
      height: 1920,
      deviceScaleFactor: 2, // For retina/high-DPI screens
    });

    // Load HTML content - use domcontentloaded instead of networkidle0 to avoid hanging on external resources
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });

    // Wait for fonts and rendering (shorter wait since we're not waiting for network)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Take screenshot with timeout protection
    const screenshot = await Promise.race([
      page.screenshot({
        type: 'png',
        clip: {
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
        },
      }) as Promise<Buffer>,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Screenshot timeout after 5 seconds')), 5000)
      )
    ]);

    return screenshot;
  } catch (error) {
    console.error('❌ Error rendering static slide:', error);
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

export async function closeStaticSlideshowBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

