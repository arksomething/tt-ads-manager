import OpenAI from 'openai';
import { renderProjectionImage } from '../../renderers/projectionRenderer';
import { renderFramedImage } from '../../renderers/framedRenderer';
import { renderStaticSlide } from '../../renderers/staticSlideshowRenderer';
import { Prompts } from '../../config/Prompts';

export interface SlideshowImageSpec {
  title: string;
  subtitle: string;
  value: string;
  iconType: 'current' | 'mother' | 'father';
}

export interface ProjectionImageData {
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

/**
 * Service for image generation and rendering
 * Consolidates all image-related operations
 */
export class ImageService {
  constructor(private openai: OpenAI) {}

  /**
   * Generate multiple AI images with a prompt
   */
  public async generateImages(prompt: string, count: number = 4): Promise<Buffer[]> {
    console.log(`🎨 Generating ${count} images in parallel for prompt: "${prompt}"`);

    const imagePromises = Array.from({ length: count }, async (_, i) => {
      try {
        console.log(`  → Generating image ${i + 1}/${count}...`);
        const response = await this.openai.images.generate({
          model: "gpt-image-1",
          prompt: prompt,
          n: 1,
          size: "1024x1536", // Portrait aspect ratio (2:3)
        });

        const imageBase64 = response.data?.[0]?.b64_json;
        if (imageBase64) {
          const imageBuffer = Buffer.from(imageBase64, 'base64');
          console.log(`  ✓ Image ${i + 1}/${count} generated`);
          return imageBuffer;
        } else {
          throw new Error(`Failed to generate image ${i + 1}: No base64 data in response`);
        }
      } catch (error: any) {
        console.error(`  ✗ Error generating image ${i + 1}:`, error.message);
        throw error;
      }
    });

    const imageBuffers = await Promise.all(imagePromises);
    console.log(`✅ All ${count} images generated successfully`);

    return imageBuffers;
  }

  /**
   * Generate slideshow images with specific specs
   */
  public async generateSlideshowImages(specs: SlideshowImageSpec[]): Promise<Buffer[]> {
    console.log(`🎨 Generating ${specs.length} slideshow images in parallel using gpt-image-1...`);

    const baseStyleDescription = `Minimalist, black and white graphic design in portrait orientation. Clean white or off-white background with subtle texture. Bold, black sans-serif font (Arial Black style). All text in uppercase. Content is vertically distributed with generous spacing between elements to fill the portrait canvas. Horizontally centered layout with ample white space. Professional, instructional, and modern aesthetic.`;

    const imagePromises = specs.map(async (spec, i) => {
      console.log(`  → Starting generation for image ${i + 1}/${specs.length} (${spec.subtitle})...`);

      const prompt = Prompts.imageGeneration.buildPrompt({
        title: spec.title,
        subtitle: spec.subtitle,
        value: spec.value,
        iconType: spec.iconType,
        baseStyle: baseStyleDescription,
        exactText: false,
      });

      try {
        const response = await this.openai.images.generate({
          model: "gpt-image-1",
          prompt: prompt,
          n: 1,
          size: "1024x1536",
        });

        const imageBase64 = response.data?.[0]?.b64_json;
        if (imageBase64) {
          const imageBuffer = Buffer.from(imageBase64, 'base64');
          console.log(`  ✓ Image ${i + 1}/${specs.length} (${spec.subtitle}) generated`);
          return imageBuffer;
        } else {
          throw new Error(`Failed to generate image ${i + 1}: No base64 data in response`);
        }
      } catch (error: any) {
        console.error(`  ✗ Error generating image ${i + 1}:`, error.message);
        throw error;
      }
    });

    const imageBuffers = await Promise.all(imagePromises);
    console.log(`✅ All ${specs.length} slideshow images generated successfully`);

    return imageBuffers;
  }

  /**
   * Render projection image using Puppeteer
   */
  public async renderProjectionImage(data: ProjectionImageData): Promise<Buffer> {
    return renderProjectionImage(data);
  }

  /**
   * Render framed image with optional background color
   */
  public async renderFramedImage(imageBuffer: Buffer, backgroundColor?: string): Promise<Buffer> {
    return renderFramedImage(imageBuffer, backgroundColor);
  }

  /**
   * Render static slideshow image
   */
  public async renderStaticSlide(data: any): Promise<Buffer> {
    return renderStaticSlide(data);
  }
}
