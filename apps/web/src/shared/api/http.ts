import axios, { isAxiosError, isCancel } from 'axios';

export type AppError =
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'cancelled' }
  | { kind: 'http'; status: number; message: string };

interface HttpHooks {
  getApiKey: () => string | null;
  onUnauthorized: () => void;
}

let hooks: HttpHooks = { getApiKey: () => null, onUnauthorized: () => undefined };

/** Wired once by the app layer, so `shared` never imports the store. */
export function configureHttp(next: HttpHooks): void {
  hooks = next;
}

export const API_KEY_HEADER = 'x-api-key';

export const http = axios.create({ baseURL: '/', timeout: 15_000 });

http.interceptors.request.use((config) => {
  const key = hooks.getApiKey();
  if (key) config.headers.set(API_KEY_HEADER, key);
  return config;
});

http.interceptors.response.use(undefined, (error: unknown) => {
  if (isAxiosError(error) && error.response?.status === 401) hooks.onUnauthorized();
  throw error;
});

/**
 * Presigned URLs point straight at object storage on another origin. They must not
 * carry the API key, so they get their own instance without interceptors.
 */
export const storageHttp = axios.create({ timeout: 120_000 });

function messageOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('message' in data)) return null;
  const { message } = data;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join('; ');
  return null;
}

export function toAppError(error: unknown): AppError {
  if (isCancel(error)) return { kind: 'cancelled' };
  if (!isAxiosError(error)) return { kind: 'network' };
  const status = error.response?.status;
  if (!status) return { kind: 'network' };
  if (status === 401) return { kind: 'unauthorized' };
  return { kind: 'http', status, message: messageOf(error.response?.data) ?? error.message };
}
