import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProcessAbortedError,
  ProcessFailedError,
  ProcessTimeoutError,
  runProcess,
} from './run-process';

const node = process.execPath;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runProcess', () => {
  it('returns stdout of a successful run', async () => {
    const res = await runProcess(node, ['-e', 'process.stdout.write("ok")'], { timeoutMs: 5000 });
    expect(res.stdout).toBe('ok');
  });

  it('reports a non-zero exit as permanent, with the stderr tail', async () => {
    const err = await runProcess(
      node,
      ['-e', 'process.stderr.write("Invalid data found"); process.exit(3)'],
      { timeoutMs: 5000 },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProcessFailedError);
    expect(err).toMatchObject({ exitCode: 3, permanent: true });
    expect((err as Error).message).toContain('Invalid data found');
  });

  it('SIGKILLs a process that ignores SIGTERM and waits for it to exit', async () => {
    const pidFile = join(await mkdtemp(join(tmpdir(), 'run-process-')), 'pid');
    const script = [
      'process.on("SIGTERM", () => {});',
      `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('');
    const started = Date.now();
    const err = await runProcess(node, ['-e', script], { timeoutMs: 500 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProcessTimeoutError);
    expect((err as ProcessTimeoutError).permanent).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(isAlive(Number(await readFile(pidFile, 'utf8')))).toBe(false);
  });

  it('kills the process on abort and reports it as transient', async () => {
    const controller = new AbortController();
    const run = runProcess(node, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('shutting down')), 100);
    const err = await run.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProcessAbortedError);
    expect(err).toMatchObject({ permanent: false });
    expect((err as Error).message).toContain('shutting down');
  });

  it('does not start when already aborted', async () => {
    const err = await runProcess(node, ['-e', ''], {
      timeoutMs: 1000,
      signal: AbortSignal.abort(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProcessAbortedError);
  });

  it('streams stdout to onStdout instead of buffering it', async () => {
    const chunks: string[] = [];
    const res = await runProcess(node, ['-e', 'process.stdout.write("a=1\\n")'], {
      timeoutMs: 5000,
      onStdout: (chunk) => chunks.push(chunk),
    });
    expect(chunks.join('')).toBe('a=1\n');
    expect(res.stdout).toBe('');
  });

  it('treats a missing binary as transient', async () => {
    const err = await runProcess('/nonexistent/ffmpeg', [], { timeoutMs: 1000 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProcessFailedError);
    expect((err as ProcessFailedError).permanent).toBe(false);
  });
});
