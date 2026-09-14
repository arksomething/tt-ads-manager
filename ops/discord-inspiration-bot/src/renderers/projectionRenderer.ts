import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { renderProjectionMarkup } from './nativeProjection/renderProjectionMarkup';

interface ProjectionRenderData {
  currentHeight: string;
  predictedHeight: string;
  heightGain: number;
  unitLabel: string;
  issuesCount: number;
  issuesWord: string;
  reasons: string[];
  growthComplete: number;
  dreamData?: {
    probability: number;
  };
  percentileRank: number;
  percentileDisplay: string;
  currentAge: number;
  progressPercent?: number;
}

let browserInstance: Browser | null = null;
let browserLaunchTime = 0;
const BROWSER_MAX_AGE_MS = 5 * 60 * 1000;
const SCREEN_WIDTH = 430;
const SCREEN_HEIGHT = 873;
const SCREEN_SCALE = 3;

async function getBrowser(): Promise<Browser> {
  const now = Date.now();
  const browserTooOld =
    browserLaunchTime > 0 && now - browserLaunchTime > BROWSER_MAX_AGE_MS;

  if (!browserInstance || !browserInstance.connected || browserTooOld) {
    if (browserInstance) {
      try {
        await Promise.race([
          browserInstance.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser close timeout')), 3000)
          ),
        ]);
      } catch (error) {
        console.warn('⚠️ Failed to close old browser instance:', error);
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
        '--disable-extensions',
      ],
      timeout: 30000,
    });
    browserLaunchTime = now;
    console.log('✅ Browser launched successfully');
  }

  return browserInstance;
}

function clampPercentage(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value as number)));
}

function resolveIconBase64(): string {
  const candidatePaths = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '..', 'renderers', 'icon.png'),
    path.join(process.cwd(), 'src', 'renderers', 'icon.png'),
  ];

  const resolved = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    return '';
  }

  const iconBuffer = fs.readFileSync(resolved);
  return `data:image/png;base64,${iconBuffer.toString('base64')}`;
}

export async function renderProjectionImage(
  data: ProjectionRenderData
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const iconBase64 = resolveIconBase64();
    const html = renderProjectionMarkup({
      currentHeight: data.currentHeight,
      predictedHeight: data.predictedHeight,
      heightGain: data.heightGain,
      unitLabel: data.unitLabel,
      issuesCount: data.issuesCount,
      issuesWord: data.issuesWord,
      reasons: data.reasons,
      growthComplete: clampPercentage(data.growthComplete, 85),
      dreamProbability: clampPercentage(data.dreamData?.probability, 50),
      percentileDisplay: data.percentileDisplay,
      currentAge: Math.max(1, Math.floor(data.currentAge || 0)),
      progressPercent: clampPercentage(data.progressPercent, 85),
      iconDataUrl: iconBase64 || undefined,
    });

    await page.setViewport({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      deviceScaleFactor: SCREEN_SCALE,
      isMobile: true,
      hasTouch: false,
    });

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    await page.evaluate(async () => {
      const fonts = (document as Document & {
        fonts?: { ready: Promise<unknown> };
      }).fonts;

      if (fonts?.ready) {
        await fonts.ready;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const screenshot = await Promise.race([
      page.screenshot({
        type: 'png',
        clip: {
          x: 0,
          y: 0,
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
        },
      }) as Promise<Buffer>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Screenshot timeout after 8 seconds')), 8000)
      ),
    ]);

    return screenshot;
  } catch (error) {
    console.error('❌ Error rendering projection image:', error);
    throw error;
  } finally {
    try {
      await Promise.race([
        page.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Page close timeout')), 2000)
        ),
      ]);
    } catch (error) {
      console.warn('⚠️ Failed to close page cleanly:', error);
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
