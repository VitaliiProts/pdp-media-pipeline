import { spawn } from 'node:child_process';

const STDERR_TAIL = 2000;

export interface RunOptions {
  timeoutMs: number;
  maxStdoutBytes?: number;
  /** Gets stdout as it arrives instead of in the result, for long runs that report on it. */
  onStdout?: (chunk: string) => void;
  /** Aborting kills the process the same way the timeout does. */
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Transient: the same input may finish on a less loaded node. */
export class ProcessTimeoutError extends Error {
  readonly permanent = false;

  constructor(command: string, timeoutMs: number) {
    super(`${command} killed after ${timeoutMs}ms`);
    this.name = 'ProcessTimeoutError';
  }
}

/** Transient: the job was interrupted, not the input rejected. */
export class ProcessAbortedError extends Error {
  readonly permanent = false;

  constructor(command: string, reason: unknown) {
    super(`${command} aborted${reason instanceof Error ? `: ${reason.message}` : ''}`);
    this.name = 'ProcessAbortedError';
  }
}

/**
 * A non-zero exit code means the tool rejected the input, which a retry will not change.
 * Death by a signal we did not send (OOM killer) or a failed spawn is worth a retry.
 */
export class ProcessFailedError extends Error {
  readonly permanent: boolean;

  constructor(
    command: string,
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
  ) {
    const how = exitCode !== null ? `exited with ${exitCode}` : `was killed by ${signal}`;
    super(`${command} ${how}${stderr ? `: ${stderr.trim()}` : ''}`);
    this.name = 'ProcessFailedError';
    this.permanent = exitCode !== null;
  }
}

/**
 * Runs a binary without a shell. On timeout the child gets SIGKILL, not SIGTERM: ffmpeg
 * stuck on a malformed stream may not react to a polite signal. The promise settles only
 * after the child has exited, so no process outlives the attempt that started it.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  const maxStdout = options.maxStdoutBytes ?? 1024 * 1024;
  const { signal, onStdout } = options;
  if (signal?.aborted) return Promise.reject(new ProcessAbortedError(command, signal.reason));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let spawnError: Error | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (onStdout) onStdout(chunk);
      else if (stdout.length < maxStdout) stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on('error', (err) => {
      spawnError = err;
    });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (timedOut) reject(new ProcessTimeoutError(command, options.timeoutMs));
      else if (aborted) reject(new ProcessAbortedError(command, signal?.reason));
      else if (spawnError) reject(new ProcessFailedError(command, null, null, spawnError.message));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new ProcessFailedError(command, code, exitSignal, stderr));
    });
  });
}
