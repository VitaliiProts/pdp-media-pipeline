import { type AssetJob } from '../../../features/assets';
import { failureOf, requestOf, stageOf, stepStateOf } from './dub-job';

const job = (overrides: Partial<AssetJob>): AssetJob => ({
  id: 'j1',
  type: 'video.dub',
  status: 'queued',
  attempts: 0,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

describe('dub job', () => {
  it('reads the code before the message of the last error', () => {
    expect(failureOf('no_speech: no speech was recognised')).toBe('no_speech');
    expect(failureOf('stt_unavailable: openai: 503')).toBe('stt_unavailable');
    expect(failureOf('ffmpeg exited with 1')).toBe('other');
    expect(failureOf('weird_code: x')).toBe('other');
    expect(failureOf(null)).toBeNull();
  });

  it('follows the job from the queue to the result or the failure', () => {
    expect(stageOf(job({}))).toEqual({ kind: 'waiting', retrying: null });
    expect(
      stageOf(job({ status: 'scheduled', attempts: 1, lastError: 'stt_unavailable: down' })),
    ).toEqual({ kind: 'waiting', retrying: 'stt_unavailable' });
    expect(stageOf(job({ status: 'running', progress: 42, progressStep: 'translate' }))).toEqual({
      kind: 'running',
      step: 'translate',
      percent: 42,
    });
    expect(stageOf(job({ status: 'running', progressStep: 'later' }))).toEqual({
      kind: 'running',
      step: null,
      percent: null,
    });
    expect(stageOf(job({ status: 'dead', lastError: 'too_long: 75 s' }))).toEqual({
      kind: 'failed',
      failure: 'too_long',
    });
    expect(stageOf(job({ status: 'succeeded' }))).toEqual({ kind: 'failed', failure: 'other' });
  });

  it('marks the steps before the current one done', () => {
    expect(stepStateOf('extract', 'align')).toBe('done');
    expect(stepStateOf('align', 'align')).toBe('current');
    expect(stepStateOf('mix', 'align')).toBe('pending');
    expect(stepStateOf('extract', null)).toBe('pending');
  });

  it('reads the languages it was asked for, detection by default', () => {
    expect(requestOf(job({ input: { targetLanguage: 'de' } }))).toEqual({
      targetLanguage: 'de',
      sourceLanguage: 'auto',
    });
    expect(requestOf(job({ input: { targetLanguage: 'uk', sourceLanguage: 'en' } }))).toEqual({
      targetLanguage: 'uk',
      sourceLanguage: 'en',
    });
  });
});
