import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { VisionService } from './VisionService';
import { Prompts } from '../../config/Prompts';

/**
 * BrandingService
 * Loads brand assets and produces a concise brand prompt for image generation.
 * No visual overlay is performed; logo is summarized/described for context.
 */
export class BrandingService {
  private openai: OpenAI;
  private vision: VisionService;
  private cachedLogoBuffer: Buffer | null = null;
  private cachedLogoDescription: string | null = null;

  constructor(openai: OpenAI, vision: VisionService) {
    this.openai = openai;
    this.vision = vision;
  }

  private tryPaths(rel: string): string | null {
    const candidates = [
      path.join(process.cwd(), rel),
      path.join(process.cwd(), 'src', rel),
      path.join(__dirname, '..', '..', '..', rel),
    ];
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  private findAsset(filename: string): string | null {
    return (
      this.tryPaths(path.join('assets', filename)) ||
      this.tryPaths(filename)
    );
  }

  public getLogoBuffer(): Buffer | null {
    if (this.cachedLogoBuffer) return this.cachedLogoBuffer;
    const p = this.findAsset('Logo.png');
    if (!p) return null;
    try {
      this.cachedLogoBuffer = fs.readFileSync(p);
      return this.cachedLogoBuffer;
    } catch {
      return null;
    }
  }

  public async getLogoDescription(): Promise<string> {
    if (this.cachedLogoDescription) return this.cachedLogoDescription;
    const buf = this.getLogoBuffer();
    if (!buf) {
      this.cachedLogoDescription = '';
      return '';
    }
    const desc = await this.vision.describeImage(buf);
    this.cachedLogoDescription = desc || '';
    return this.cachedLogoDescription;
  }

  /**
   * Returns a concise brand prompt string to prepend to image-gen prompts.
   */
  public async getBrandPrompt(): Promise<string> {
    const logoDesc = await this.getLogoDescription();
    return Prompts.branding.getFormattedPrompt(logoDesc || undefined);
  }
}


