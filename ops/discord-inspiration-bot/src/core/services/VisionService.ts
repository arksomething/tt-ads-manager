import OpenAI from 'openai';
import { Prompts } from '../../config/Prompts';

export type VisionSlidesType = 'height' | 'generic';

export interface VisionExtractedFields {
  currentHeight?: string;
  age?: number;
  motherHeight?: string;
  fatherHeight?: string;
  sex?: 'male' | 'female';
}

export interface VisionClassificationResult {
  type: VisionSlidesType;
  confidence: number; // 0..1
  fields?: VisionExtractedFields;
  captions: string[]; // one caption per analyzed slide (short phrases)
}

/**
 * VisionService
 * Uses OpenAI Vision models to classify a slideshow and extract structured data/captions.
 */
export class VisionService {
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  /**
   * Classify slideshow and extract height-related fields + brief captions.
   * Limits images sent to the model for cost/perf.
   */
  public async classifyAndExtract(
    slideImages: Buffer[],
    options: { maxSamples?: number } = {}
  ): Promise<VisionClassificationResult> {
    const maxSamples = Math.max(1, Math.min(options.maxSamples ?? 6, slideImages.length));
    const samples = slideImages.slice(0, maxSamples);

    const userParts: any[] = [
      {
        type: 'text',
        text: Prompts.vision.mainTask
      },
      {
        type: 'text',
        text: Prompts.vision.jsonSchema
      },
      {
        type: 'text',
        text: Prompts.vision.instructions
      }
    ];

    for (const buf of samples) {
      const b64 = buf.toString('base64');
      userParts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64}` },
      });
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: userParts as any,
          },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' } as any,
      });

      const content = completion.choices?.[0]?.message?.content || '';
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {};
      }

      const type: VisionSlidesType = parsed?.type === 'height' ? 'height' : 'generic';
      const confidence: number = Number(parsed?.confidence);
      const safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
      const fields: VisionExtractedFields | undefined = parsed?.fields || undefined;
      const captions: string[] = Array.isArray(parsed?.captions) ? parsed.captions : new Array(samples.length).fill('generic slide');

      // Ensure captions length aligns with samples
      const paddedCaptions = captions.length === samples.length
        ? captions
        : [...captions.slice(0, samples.length), ...new Array(Math.max(0, samples.length - captions.length)).fill('slide')];

      return {
        type,
        confidence: safeConfidence,
        fields,
        captions: paddedCaptions,
      };
    } catch (error: any) {
      console.error('❌ VisionService.classifyAndExtract error:', error?.message || error);
      return { type: 'generic', confidence: 0.0, captions: new Array(samples.length).fill('slide') };
    }
  }

  /**
   * Describe an image concisely (used to summarize brand logo visuals).
   */
  public async describeImage(imageBuffer: Buffer): Promise<string> {
    const b64 = imageBuffer.toString('base64');
    const content: any[] = [
      { type: 'text', text: Prompts.logoAnalysis.user },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [ 
          { role: 'system', content: Prompts.logoAnalysis.system },
          { role: 'user', content } 
        ],
        temperature: 0.2,
      });
      return completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (error: any) {
      console.error('❌ VisionService.describeImage error:', error?.message || error);
      return '';
    }
  }
}


