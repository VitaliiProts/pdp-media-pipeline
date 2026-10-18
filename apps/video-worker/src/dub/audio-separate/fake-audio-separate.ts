import { type DubStorage } from '../checkpoints';
import {
  type AnalyzeRequest,
  type AnalyzeResponse,
  type SeparateRequest,
  type SeparateResponse,
} from './audio-separate.api';
import { type AudioSeparate } from './audio-separate.client';

/**
 * Stands in for the Python service, for tests, k6 and k3d: the whole track becomes both the voice
 * and the background, words share their segment evenly, and speakers alternate male and female
 * in order of appearance.
 */
export class FakeAudioSeparate implements AudioSeparate {
  constructor(private readonly storage: Pick<DubStorage, 'copyObject' | 'putObject'>) {}

  async separate(request: SeparateRequest): Promise<SeparateResponse> {
    await this.storage.copyObject(request.input, request.vocals);
    await this.storage.copyObject(request.input, request.background);
    return { vocals: request.vocals, background: request.background };
  }

  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    const seconds = new Map<string, number>();
    for (const s of request.segments) {
      seconds.set(s.speaker, (seconds.get(s.speaker) ?? 0) + s.end - s.start);
    }
    const result: AnalyzeResponse = {
      segments: request.segments.map((s) => {
        const words = s.text.split(/\s+/).filter(Boolean);
        const share = (s.end - s.start) / Math.max(1, words.length);
        return {
          id: s.id,
          speaker: s.speaker,
          words: words.map((word, i) => ({
            word,
            start: s.start + i * share,
            end: s.start + (i + 1) * share,
            score: 1,
          })),
        };
      }),
      speakers: [...seconds].map(([id, spoken], i) => ({
        id,
        gender: i % 2 === 0 ? 'male' : 'female',
        maleProbability: i % 2 === 0 ? 0.9 : 0.1,
        seconds: spoken,
      })),
      unrecognized: [],
    };
    await this.storage.putObject(
      request.output,
      Buffer.from(JSON.stringify(result)),
      'application/json',
    );
    return result;
  }
}
