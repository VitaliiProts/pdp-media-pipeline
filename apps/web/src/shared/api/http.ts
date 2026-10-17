import axios, { isAxiosError, isCancel } from 'axios';

export type AppError =
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'cancelled' }
  /** 429, or 503 that says when to come back: the request was fine, the timing was not. */
  | { kind: 'retryLater'; status: 429 | 503; retryAfterS: number }
  | { kind: 'http'; status: number; message: string; code: string | null };

interface HttpHooks {
  /** `url` of the refused request; 401 from `/v1/auth/*` means a wrong password, not an ended session. */
  onUnauthorized: (url: string) => void;
}

let hooks: HttpHooks = { onUnauthorized: () => undefined };

/** Wired once by the app layer, so `shared` never imports the store. */
export function configureHttp(next: HttpHooks): void {
  hooks = next;
}

export const http = axios.create({ baseURL: '/', timeout: 15_000 });

http.interceptors.response.use(undefined, (error: unknown) => {
  if (isAxiosError(error) && error.response?.status === 401)
    hooks.onUnauthorized(error.config?.url ?? '');
  throw error;
});

/** Presigned URLs point straight at object storage on another origin: no interceptors. */
export const storageHttp = axios.create({ timeout: 120_000 });

function messageOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('message' in data)) return null;
  const { message } = data;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join('; ');
  return null;
}

function codeOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('code' in data)) return null;
  return typeof data.code === 'string' ? data.code : null;
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
  return {
    kind: 'http',
    status,
    message: messageOf(error.response?.data) ?? error.message,
    code: codeOf(error.response?.data),
  };
}

const APP_ERROR_KINDS: ReadonlySet<unknown> = new Set<AppError['kind']>([
  'unauthorized',
  'network',
  'cancelled',
  'retryLater',
  'http',
]);

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    APP_ERROR_KINDS.has(value.kind)
  );
}

/** What `unwrap()` rejects with is `unknown`; this narrows it back. */
export function appErrorOf(value: unknown): AppError | null {
  return isAppError(value) ? value : null;
}

/** The gateway's machine-readable reason (`EMAIL_TAKEN`, `ASSET_BUSY`, …), if any. */
export function errorCodeOf(value: unknown): string | null {
  return isAppError(value) && value.kind === 'http' ? value.code : null;
}

export function httpStatusOf(value: unknown): number | null {
  return isAppError(value) && value.kind === 'http' ? value.status : null;
}

/** Seconds the gateway asked to wait, if the request was refused for timing. */
export function retryAfterOf(error: unknown): number | null {
  return isAppError(error) && error.kind === 'retryLater' ? error.retryAfterS : null;
}

export function isUnauthorized(error: unknown): boolean {
  return isAppError(error) && error.kind === 'unauthorized';
}
