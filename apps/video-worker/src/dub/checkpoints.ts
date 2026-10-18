import { dubCheckpointKey } from '@pdp/contracts';
import { z } from 'zod';
import { type Transcript, type Translation, type TokenUsage } from './providers/types';

export interface DubStorage {
  exists(key: string): Promise<boolean>;
  getObject(key: string, maxBytes: number): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  downloadToFile(key: string, path: string, maxBytes: number): Promise<number>;
  uploadFile(key: string, path: string, contentType: string): Promise<number>;
  copyObject(source: string, target: string): Promise<void>;
}

export const CHECKPOINT = {
  audio: 'audio.flac',
  transcript: 'transcript.json',
  vocals: 'vocals.flac',
  background: 'background.flac',
  analysis: 'analysis.json',
  translation: 'translation.json',
  refit: 'refit.json',
} as const;

/** What a dub of the same file with other speakers or language can take as is. */
export const REUSABLE = [
  CHECKPOINT.audio,
  CHECKPOINT.transcript,
  CHECKPOINT.vocals,
  CHECKPOINT.background,
  CHECKPOINT.analysis,
] as const;

/** A minute of recognised speech is tens of kilobytes. */
const MAX_JSON_BYTES = 5_000_000;

const Usage = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
}) satisfies z.ZodType<TokenUsage>;

export const TranscriptCheckpoint = z.object({
  segments: z.array(
    z.object({
      id: z.string(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
      speaker: z.string(),
    }),
  ),
  billedSeconds: z.number().min(0),
}) satisfies z.ZodType<Transcript>;

export const TranslationCheckpoint = z.object({
  sourceLanguage: z.string(),
  lines: z.array(z.object({ id: z.string(), variants: z.array(z.string()) })),
  usage: Usage,
}) satisfies z.ZodType<Translation>;

/** Refits by phrase id; a retry asks only for the phrases it lacks. */
export const RefitCheckpoint = z.record(
  z.string(),
  z.object({ variants: z.array(z.string()), usage: Usage }),
);
export type RefitCheckpoint = z.infer<typeof RefitCheckpoint>;

/**
 * Artifacts under `results/{jobId}/dub/`. A finished paid step is stored before the next one
 * starts, so a retry of the job finds it and does not pay again.
 */
export class DubCheckpoints {
  constructor(
    private readonly storage: DubStorage,
    private readonly jobId: string,
  ) {}

  key(name: string): string {
    return dubCheckpointKey(this.jobId, name);
  }

  has(name: string): Promise<boolean> {
    return this.storage.exists(this.key(name));
  }

  /**
   * The stored value, or `compute`'s, stored unless `compute` stores it itself. One that no
   * longer matches the schema (written by an older worker) is computed again.
   */
  async json<T>(
    name: string,
    schema: z.ZodType<T>,
    compute: () => Promise<T>,
    options: { storedByCompute?: boolean } = {},
  ): Promise<T> {
    const stored = await this.read(name, schema);
    if (stored !== undefined) return stored;
    const value = await compute();
    if (!options.storedByCompute) await this.write(name, value);
    return value;
  }

  async read<T>(name: string, schema: z.ZodType<T>): Promise<T | undefined> {
    if (!(await this.has(name))) return undefined;
    const body = await this.storage.getObject(this.key(name), MAX_JSON_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      return undefined;
    }
    const result = schema.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  write(name: string, value: unknown): Promise<void> {
    return this.storage.putObject(
      this.key(name),
      Buffer.from(JSON.stringify(value)),
      'application/json',
    );
  }

  /** Copies what this job lacks from another job; a checkpoint the other job lacks is skipped. */
  async copyFrom(jobId: string, names: readonly string[]): Promise<void> {
    await Promise.all(
      names.map(async (name) => {
        const source = dubCheckpointKey(jobId, name);
        if ((await this.has(name)) || !(await this.storage.exists(source))) return;
        await this.storage.copyObject(source, this.key(name));
      }),
    );
  }
}
