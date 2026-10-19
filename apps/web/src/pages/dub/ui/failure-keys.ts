import { type DubFailure } from '../model/dub-job';

export const FAILURE_KEY = {
  no_audio: 'failure.no_audio',
  no_speech: 'failure.no_speech',
  same_language: 'failure.same_language',
  too_long: 'failure.too_long',
  stt_unavailable: 'failure.stt_unavailable',
  translate_unavailable: 'failure.translate_unavailable',
  other: 'failure.other',
} as const satisfies Record<DubFailure, string>;
