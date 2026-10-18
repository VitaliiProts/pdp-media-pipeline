import { SpeakerGenderSchema } from '@pdp/contracts';
import { z } from 'zod';

/**
 * HTTP API of the `audio-separate` service (ADR-016). All audio moves through S3: requests
 * name the keys, and an output key that already exists is returned without recomputing.
 */

export const SeparateRequest = z.object({
  input: z.string().min(1),
  vocals: z.string().min(1),
  background: z.string().min(1),
});
export type SeparateRequest = z.infer<typeof SeparateRequest>;

export const SeparateResponse = z.object({ vocals: z.string(), background: z.string() });
export type SeparateResponse = z.infer<typeof SeparateResponse>;

export const AnalyzeRequest = z.object({
  vocals: z.string().min(1),
  /** Segments of the transcript; each is aligned within its own window. */
  segments: z.array(
    z.object({
      id: z.string(),
      speaker: z.string(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
    }),
  ),
  /** Where the result is stored as JSON, too. */
  output: z.string().min(1),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

const Interval = z.object({ start: z.number(), end: z.number() });

export const AnalyzeResponse = z.object({
  /** Every word of every segment; a word the aligner could not place has score 0. */
  segments: z.array(
    z.object({
      id: z.string(),
      speaker: z.string(),
      words: z.array(Interval.extend({ word: z.string(), score: z.number() })),
    }),
  ),
  speakers: z.array(
    z.object({
      id: z.string(),
      gender: SpeakerGenderSchema,
      maleProbability: z.number().min(0).max(1),
      /** Speech the classifier heard. */
      seconds: z.number(),
    }),
  ),
  /** Voice of at least 0.5 s without any aligned word: speech the recogniser missed. */
  unrecognized: z.array(Interval),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;
