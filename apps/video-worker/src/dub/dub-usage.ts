import { type TokenUsage } from './providers/types';

/**
 * Prices of the default models, for an estimate only. Recognition bills audio and text tokens;
 * measured in spike 02 at $0.0107 a minute, twice OpenAI's own $0.006 because of the segments.
 */
const STT_USD_PER_MINUTE = 0.0107;
/** gpt-5-mini, per million tokens. */
const INPUT_USD_PER_MILLION = 0.25;
const OUTPUT_USD_PER_MILLION = 2;

export interface DubUsage {
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export const sttCostUsd = (audioSeconds: number): number =>
  (audioSeconds / 60) * STT_USD_PER_MINUTE;

export const tokenCostUsd = ({ inputTokens, outputTokens }: TokenUsage): number =>
  (inputTokens * INPUT_USD_PER_MILLION + outputTokens * OUTPUT_USD_PER_MILLION) / 1e6;

export function dubUsage(audioSeconds: number, tokens: readonly TokenUsage[]): DubUsage {
  const inputTokens = tokens.reduce((sum, t) => sum + t.inputTokens, 0);
  const outputTokens = tokens.reduce((sum, t) => sum + t.outputTokens, 0);
  const cost = sttCostUsd(audioSeconds) + tokenCostUsd({ inputTokens, outputTokens });
  return {
    audioSeconds,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(cost * 1e5) / 1e5,
  };
}
