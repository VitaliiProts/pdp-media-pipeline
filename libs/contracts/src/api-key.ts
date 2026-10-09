import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_HEADER = 'x-api-key';

/** Only the hash is stored; a plain SHA-256 is enough for high-entropy random keys. */
export const hashApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex');

export const generateApiKey = (): string => `pdp_${randomBytes(24).toString('base64url')}`;

export const apiKeyPrefix = (apiKey: string): string => apiKey.slice(0, 8);
