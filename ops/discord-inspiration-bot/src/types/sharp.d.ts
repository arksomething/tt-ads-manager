declare module 'sharp' {
  type FitOption = 'cover' | 'contain' | 'fill' | 'inside' | 'outside';

  interface ResizeOptions {
    fit?: FitOption;
    background?: { r: number; g: number; b: number; alpha?: number };
  }

  interface SharpInstance {
    metadata(): Promise<{ width?: number; height?: number }>;
    resize(width: number, height: number, options?: ResizeOptions): SharpInstance;
    png(): SharpInstance;
    toBuffer(): Promise<Buffer>;
  }

  interface SharpStatic {
    (input?: Buffer | string): SharpInstance;
    new (input?: Buffer | string): SharpInstance;
  }

  const sharp: SharpStatic;
  export default sharp;
}

