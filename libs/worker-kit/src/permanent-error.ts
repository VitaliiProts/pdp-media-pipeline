/**
 * Retrying cannot help: the input itself is unusable. A `code` leads the message as
 * `code: message`, which is the job's `lastError`, so the UI can explain it.
 */
export class PermanentError extends Error {
  readonly permanent = true;

  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(code ? `${code}: ${message}` : message);
    this.name = 'PermanentError';
  }
}

/** Any error flagged `permanent`, so libs can mark failures without depending on this one. */
export const isPermanentError = (err: unknown): boolean =>
  err instanceof Error && (err as { permanent?: unknown }).permanent === true;
