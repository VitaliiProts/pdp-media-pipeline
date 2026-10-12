import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessFailedError, ProcessTimeoutError, runProcess } from './run-process';

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

  it('treats a missing binary as transient', async () => {
    const err = await runProcess('/nonexistent/ffmpeg', [], { timeoutMs: 1000 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProcessFailedError);
    expect((err as ProcessFailedError).permanent).toBe(false);
  });
});
