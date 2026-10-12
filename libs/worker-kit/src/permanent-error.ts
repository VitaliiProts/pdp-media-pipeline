/** Retrying cannot help: the input itself is unusable. */
export class PermanentError extends Error {
  readonly permanent = true;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

/** Any error flagged `permanent`, so libs can mark failures without depending on this one. */
export const isPermanentError = (err: unknown): boolean =>
  err instanceof Error && (err as { permanent?: unknown }).permanent === true;
