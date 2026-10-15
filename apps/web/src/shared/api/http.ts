import { type SerializedError } from '@reduxjs/toolkit';
import axios, { isAxiosError, isCancel } from 'axios';

export type AppError =
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'cancelled' }
  /** 429, or 503 that says when to come back: the request was fine, the timing was not. */
  | { kind: 'retryLater'; status: 429 | 503; retryAfterS: number }
  | { kind: 'http'; status: number; message: string };

interface HttpHooks {
  getApiKey: () => string | null;
  /** `sentKey` is the key the rejected request carried, which may no longer be the current one. */
  onUnauthorized: (sentKey: string | null) => void;
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
  if (isAxiosError(error) && error.response?.status === 401) {
    const sentKey = error.config?.headers.get(API_KEY_HEADER);
    hooks.onUnauthorized(typeof sentKey === 'string' ? sentKey : null);
  }
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

const DEFAULT_RETRY_AFTER_S = 5;

/** Only the delta-seconds form; the gateway never sends an HTTP date. */
function parseRetryAfter(header: unknown): number | null {
  const seconds = typeof header === 'string' ? Number.parseInt(header, 10) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function toAppError(error: unknown): AppError {
  if (isCancel(error)) return { kind: 'cancelled' };
  if (!isAxiosError(error)) return { kind: 'network' };
  const status = error.response?.status;
  if (!status) return { kind: 'network' };
  if (status === 401) return { kind: 'unauthorized' };
  const retryAfterS = parseRetryAfter(error.response?.headers['retry-after']);
  if (status === 429)
    return { kind: 'retryLater', status, retryAfterS: retryAfterS ?? DEFAULT_RETRY_AFTER_S };
  if (status === 503 && retryAfterS !== null) return { kind: 'retryLater', status, retryAfterS };
  return { kind: 'http', status, message: messageOf(error.response?.data) ?? error.message };
}

type QueryError = AppError | SerializedError | undefined;

const isAppError = (error: QueryError): error is AppError => error !== undefined && 'kind' in error;

/** Seconds the gateway asked to wait, if the request was refused for timing. */
export function retryAfterOf(error: QueryError): number | null {
  return isAppError(error) && error.kind === 'retryLater' ? error.retryAfterS : null;
}

export function isUnauthorized(error: QueryError): boolean {
  return isAppError(error) && error.kind === 'unauthorized';
}
