import { z } from 'zod';

export const SOURCE_URL_MAX_LENGTH = 2048;

/**
 * Where a media job reads its input: an object the user uploaded, or a public http(s) URL.
 * The URL scheme is checked here; whether the host resolves to a public address is checked
 * by the egress guard at request time, because DNS answers change.
 */
export const mediaSourceFields = {
  sourceKey: z.string().min(1).optional(),
  sourceUrl: z
    .url({ protocol: /^https?$/ })
    .max(SOURCE_URL_MAX_LENGTH)
    .optional(),
};

export const hasExactlyOneSource = (input: { sourceKey?: string; sourceUrl?: string }): boolean =>
  (input.sourceKey === undefined) !== (input.sourceUrl === undefined);

export const EXACTLY_ONE_SOURCE_MESSAGE = 'exactly one of sourceKey or sourceUrl is required';

export type MediaSource = { kind: 'key'; key: string } | { kind: 'url'; url: string };

export function mediaSourceOf(input: { sourceKey?: string; sourceUrl?: string }): MediaSource {
  if (input.sourceKey !== undefined) return { kind: 'key', key: input.sourceKey };
  if (input.sourceUrl !== undefined) return { kind: 'url', url: input.sourceUrl };
  throw new Error(EXACTLY_ONE_SOURCE_MESSAGE);
}
