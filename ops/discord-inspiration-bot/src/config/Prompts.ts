/**
 * Centralized Prompts Configuration
 * All AI prompts used throughout the application
 */

export const Prompts = {
  /**
   * Brand Guidelines for Image Generation
   */
  branding: {
    guidelines: [
      'Style: Minimalist, modern, high-contrast, clean whitespace, vertical portrait (2:3).',
      'Typography: Bold, uppercase sans-serif; clear hierarchy; generous spacing.',
      'Palette: Prefer black/white with subtle neutrals; avoid noisy backgrounds.',
      'Composition: Center-focused elements; instructional/product-focused aesthetics.',
    ],
    
    logoFallback: 'Logo: Not available for analysis; keep a clean, minimalist brand feel.',
    
    assetsHint: 'Reference tone from product marketing screenshots (e.g., app store and main screenshots) to keep a consistent, polished look.',
    
    /**
     * Get formatted brand prompt with optional logo description
     */
    getFormattedPrompt(logoDescription?: string): string {
      const logoLine = logoDescription
        ? `Logo (for style reference; do not overlay): ${logoDescription}`
        : this.logoFallback;

      return [
        'GOTALL BRAND GUIDELINES:',
        ...this.guidelines,
        logoLine,
        this.assetsHint,
      ].join('\n');
    },
  },

  /**
   * Vision Service Prompts - for analyzing TikTok slideshows
   */
  vision: {
    mainTask: 'You are analyzing images from a TikTok slideshow. Task: 1) Classify if this is a HEIGHT PREDICTION video (predicting a specific user\'s future height) or NOT. 2) If height prediction, extract the user\'s data fields. 3) Provide a concise per-image caption (≤8 words) describing the concept. Return STRICT JSON only.',
    
    jsonSchema: 'Output JSON schema: {"type":"height|generic","confidence":0..1,"fields":{"currentHeight":"optional","age":number,"motherHeight":"optional","fatherHeight":"optional","sex":"male|female|optional"},"captions":["..."]}',
    
    instructions: 'Instructions: type="height" ONLY if the slideshow is predicting a specific person\'s future height (shows current height, age, parent heights). All other videos are "generic". If any required field is missing or uncertain, omit it rather than guessing. Captions length must equal number of provided images. Use numbers exactly as visible (e.g., 5\'8, 170 cm, AGE 13).',
  },

  /**
   * Remix Slideshow Command Prompts - using Responses API
   */
  remix: {
    introduction: 'You are analyzing images from a TikTok slideshow.',
    
    heightDetection: 'If this IS a HEIGHT PREDICTION slideshow (predicting a specific person\'s future height and showing current height, age, and parents\' heights), CALL the tool render_height_slides with extracted fields. It will ONLY BE A HEIGHT PREDICTION SLIDESHOW IF PARENTS HEIGHTS, USER HEIGHT, AND USER AGE IS AVALIBLE. OTHERWISE IT IS NOT A HEIGHT PREDICTION.',
    
    heightFields: 'render_height_slides fields: { currentHeight: string, age: number, motherHeight: string, fatherHeight: string, sex: "male"|"female" }. Use numbers exactly as shown (e.g., 5\'8, 170 cm). Omit if uncertain.',
    
    imageGeneration: 'If NOT height prediction (or fields are incomplete), generate one Gotall-branded remake for EACH input slide using the image_generation tool. Keep designs almost the same, minimalist, product-focused. Match the background color from the original slideshow. Portrait 1024x1536. Avoid competitor names/logos. Make app highlights green',
    
    extraStylePrefix: 'Additional style preference:',
  },

  /**
   * Image Generation Prompts - for slideshow images
   */
  imageGeneration: {
    baseStyle: '', // Empty for now, can be filled with base style description if needed
    
    layoutInstructions: {
      title: (title: string): string => {
        const words = title.split(' ');
        return `The title "${title}" appears in two lines, centered. "${words[0]}" on the first line, and "${words.slice(1).join(' ')}" on the second line.`;
      },
      
      icon: (iconType: 'current' | 'mother' | 'father'): string => {
        const descriptions = {
          current: 'A generic, gender-neutral stick figure silhouette with circular head, rectangular torso, and two rectangular legs, standing to the left of a vertical height ruler. The height ruler is a vertical line with four horizontal tick marks extending to the right, indicating measurements. The top of the ruler aligns with the top of the person\'s head, and the bottom aligns with the bottom of the person\'s feet. Both are solid black.',
          mother: 'A generic, solid black silhouette of a woman positioned centrally. It depicts a head (circle), torso (trapezoid widening downwards), arms (short, rounded rectangles extending from shoulders), and legs (two rounded rectangles for lower body/skirt, and two smaller rounded rectangles for feet). The overall shape suggests a dress or skirt. To the right of the female icon, a simple black height chart is depicted with a thick vertical line with four shorter horizontal tick marks extending to the right, resembling a simplified stadiometer. The woman\'s head aligns roughly with the second tick mark from the top.',
          father: 'A generic human figure icon (similar to a restroom sign icon) facing forward, with a circular head, rectangular torso, and two legs. Immediately to the right of the human figure, a vertical ruler or height chart is depicted with a thick vertical line with four equally spaced horizontal tick marks extending to the right, creating five segments. The top of the human figure\'s head aligns horizontally with the top of the ruler. The bottom of the human figure\'s feet aligns horizontally with the bottom of the ruler. Both are solid black.',
        };
        return descriptions[iconType];
      },
      
      subtitle: (subtitle: string): string => 
        `The text "${subtitle}" is displayed in uppercase, medium size.`,
      
      value: (value: string): string => {
        if (value.includes('\nAGE')) {
          const [heightValue, ageText] = value.split('\nAGE ');
          return `In the lower third of the image, the specific height "${heightValue.trim()}" is shown in a very large, prominent font size. At the very bottom with comfortable margin, the age "AGE ${ageText.trim()}" is displayed in uppercase, similar in size to the subtitle.`;
        }
        return `In the lower third of the image, the specific value "${value}" is shown in a very large, prominent font size.`;
      },
      
      valueExact: (value: string): string => {
        const chars = value.split('').join(', ');
        return `Bottom section: Render EXACTLY this text: "${value}" (that is: ${chars}).`;
      },
    },
    
    buildPrompt(spec: {
      title: string;
      subtitle: string;
      value: string;
      iconType: 'current' | 'mother' | 'father';
      baseStyle?: string;
      exactText?: boolean;
    }): string {
      const baseStyleDescription = spec.baseStyle || this.baseStyle;
      const valueInstruction = spec.exactText 
        ? this.layoutInstructions.valueExact(spec.value)
        : this.layoutInstructions.value(spec.value);
      
      const importantNote = spec.exactText
        ? 'IMPORTANT: Render all text EXACTLY as specified, character by character. Pay special attention to numbers.\n\n'
        : '';
      
      return `${baseStyleDescription}

${importantNote}LAYOUT FROM TOP TO BOTTOM:
1. Top section: ${this.layoutInstructions.title(spec.title)}
2. Middle section: ${this.layoutInstructions.icon(spec.iconType)}
3. Below the icon: ${this.layoutInstructions.subtitle(spec.subtitle)}
4. ${valueInstruction}

All text and graphics are solid black. Ensure all elements are fully visible with proper spacing between sections.`;
    },
  },

  /**
   * Logo Analysis Prompt - for understanding brand logo
   */
  logoAnalysis: {
    system: 'You are a brand identity analyst.',
    
    user: 'Describe this logo in 1-2 sentences: colors, shapes, typography style, and any prominent symbols or wordmarks. Be concise and focus on visual elements that define the brand aesthetic.',
  },
};

export default Prompts;

