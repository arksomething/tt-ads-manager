import { promises as fs } from 'fs';
import * as path from 'path';

export interface VideoMilestoneRecord {
  videoKey: string;
  threshold: number;
  channelId: string;
  announcedAt: string;
  url?: string;
  username?: string;
}

interface VideoMilestoneState {
  initializedAt?: string;
  announced: Record<string, VideoMilestoneRecord>;
}

export class VideoMilestoneStateStore {
  private state: VideoMilestoneState = { announced: {} };
  private loaded = false;

  constructor(private readonly filePath: string) {}

  public async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.state = parseState(raw, this.filePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        this.state = { announced: {} };
      } else {
        throw new Error(`Failed to load video milestone state from ${this.filePath}: ${error.message}`);
      }
    }

    this.loaded = true;
  }

  public isInitialized(): boolean {
    this.ensureLoaded();
    return Boolean(this.state.initializedAt);
  }

  public hasAnnounced(videoKey: string, threshold: number): boolean {
    this.ensureLoaded();
    return Boolean(this.state.announced[this.buildStateKey(videoKey, threshold)]);
  }

  public async initializeWith(records: VideoMilestoneRecord[]): Promise<void> {
    this.ensureLoaded();

    for (const record of records) {
      this.state.announced[this.buildStateKey(record.videoKey, record.threshold)] = record;
    }

    this.state.initializedAt = new Date().toISOString();
    await this.persist();
  }

  public async recordAnnouncement(record: VideoMilestoneRecord): Promise<void> {
    this.ensureLoaded();
    this.state.announced[this.buildStateKey(record.videoKey, record.threshold)] = record;
    if (!this.state.initializedAt) {
      this.state.initializedAt = new Date().toISOString();
    }
    await this.persist();
  }

  private buildStateKey(videoKey: string, threshold: number): string {
    return `${threshold}:${videoKey}`;
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('Video milestone state store must be loaded before use.');
    }
  }

  private async persist(): Promise<void> {
    const directory = path.dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tempFilePath, this.filePath);
  }
}

function parseState(raw: string, filePath: string): VideoMilestoneState {
  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`State file ${filePath} must contain a JSON object.`);
  }

  const announced = parsed.announced ?? {};
  if (!announced || typeof announced !== 'object' || Array.isArray(announced)) {
    throw new Error(`State file ${filePath} must contain an "announced" object.`);
  }

  const normalizedAnnounced: Record<string, VideoMilestoneRecord> = {};
  for (const [key, value] of Object.entries(announced)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`State file ${filePath} has an invalid record for key "${key}".`);
    }

    const record = value as Partial<VideoMilestoneRecord>;
    if (
      typeof record.videoKey !== 'string' ||
      typeof record.channelId !== 'string' ||
      typeof record.announcedAt !== 'string' ||
      typeof record.threshold !== 'number'
    ) {
      throw new Error(`State file ${filePath} has a malformed record for key "${key}".`);
    }

    normalizedAnnounced[key] = {
      videoKey: record.videoKey,
      threshold: record.threshold,
      channelId: record.channelId,
      announcedAt: record.announcedAt,
      url: typeof record.url === 'string' ? record.url : undefined,
      username: typeof record.username === 'string' ? record.username : undefined,
    };
  }

  return {
    initializedAt: typeof parsed.initializedAt === 'string' ? parsed.initializedAt : undefined,
    announced: normalizedAnnounced,
  };
}
