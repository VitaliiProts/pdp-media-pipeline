import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { MetadataClient } from '@pdp/metadata-client';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Pool } from 'pg';
import { FakeAudioSeparate } from '../apps/video-worker/src/dub/audio-separate/fake-audio-separate';
import { createApps, type RunningApps } from './support/apps';
import { prepareDatabase, registerUpload, waitFor } from './support/helpers';
import { BUCKET, type Infra, startInfra } from './support/infra';
import { FFMPEG_ENV, makeVideo } from './support/media';

const ROOT = join(__dirname, '..');
const ACK_WAIT_MS = 3000;

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await listen(server);
  const { port } = server.address() as AddressInfo;
  server.close();
  return port;
}

/** What the paid API was asked, by path; answers are built from the request. */
function fakeOpenAi() {
  const calls = { transcribe: 0, translate: 0, refit: 0 };
  const server = createServer((req, res) => {
    void body(req).then((raw) => {
      const answer = (payload: object) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/v1/audio/transcriptions') {
        calls.transcribe++;
        return answer({
          segments: [
            { start: 0.5, end: 3, speaker: 'A', text: 'We should leave before the storm.' },
            { start: 4, end: 6.5, speaker: 'B', text: 'I told you this would happen.' },
          ],
        });
      }
      const request = JSON.parse(raw.toString('utf8')) as { messages: { content: string }[] };
      const user = JSON.parse(request.messages[1]!.content) as {
        segments?: { id: string; text: string }[];
        fullest?: string;
      };
      const content = user.segments
        ? {
            sourceLanguage: 'en',
            segments: user.segments.map((s) => ({ id: s.id, variants: [s.text, s.text] })),
          }
        : { variants: [user.fullest] };
      calls[user.segments ? 'translate' : 'refit']++;
      answer({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
    });
  });
  return { server, calls };
}

describe('a dub pod killed mid-job', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let userId: string;
  let metadata: MetadataClient;
  const openAi = fakeOpenAi();
  const separateCalls = { separate: 0, analyze: 0 };
  let analyzeArrived: () => void;
  const firstAnalyze = new Promise<void>((resolve) => (analyzeArrived = resolve));
  let audioSeparate: Server;
  const workers: ChildProcess[] = [];
  let workerEnv: Record<string, string>;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    ({ userId } = db.user);
    apps = createApps(infra);
    const metadataUrl = await apps.start('metadata');
    metadata = new MetadataClient({ baseUrl: metadataUrl, timeoutMs: 5000 });
    await apps.start('scheduler');

    const storage = {
      copyObject: async (source: string, target: string) => {
        await infra.s3.send(
          new CopyObjectCommand({
            Bucket: BUCKET,
            CopySource: `${BUCKET}/${source}`,
            Key: target,
          }),
        );
      },
      putObject: async (key: string, data: Buffer, contentType: string) => {
        await infra.s3.send(
          new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: data, ContentType: contentType }),
        );
      },
    };
    const fake = new FakeAudioSeparate(storage);
    // The first analysis never answers: the pod gets killed while it waits.
    audioSeparate = createServer((req, res) => {
      void body(req).then(async (raw) => {
        const request = JSON.parse(raw.toString('utf8')) as never;
        if (req.url === '/v1/analyze' && separateCalls.analyze++ === 0) {
          analyzeArrived();
          return;
        }
        if (req.url === '/v1/separate') separateCalls.separate++;
        const result =
          req.url === '/v1/separate' ? await fake.separate(request) : await fake.analyze(request);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      });
    });

    await promisify(execFile)(process.execPath, [
      require.resolve('typescript/bin/tsc'),
      '-p',
      join(ROOT, 'apps/video-worker/tsconfig.build.json'),
    ]);
    workerEnv = {
      ...(process.env as Record<string, string>),
      ...FFMPEG_ENV,
      OTEL_SDK_DISABLED: 'true',
      LOG_LEVEL: 'warn',
      METADATA_URL: metadataUrl,
      VIDEO_JOB_TYPES: 'video.dub',
      WORKER_ACK_WAIT_MS: String(ACK_WAIT_MS),
      WORKER_RETRY_BASE_MS: '50',
      DUB_PROVIDERS: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: `${await listen(openAi.server)}/v1`,
      DUB_TTS: 'fake',
      DUB_AUDIO_SEPARATE: 'http',
      AUDIO_SEPARATE_URL: await listen(audioSeparate),
    };
  });

  afterAll(async () => {
    for (const worker of workers) worker.kill('SIGKILL');
    audioSeparate?.closeAllConnections();
    audioSeparate?.close();
    openAi.server.close();
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  async function startWorker(id: string): Promise<ChildProcess> {
    const port = await freePort();
    const worker = spawn(process.execPath, [join(ROOT, 'apps/video-worker/dist/main.js')], {
      env: { ...workerEnv, PORT: String(port), WORKER_ID: id },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    workers.push(worker);
    await waitFor(
      () =>
        fetch(`http://127.0.0.1:${port}/health/ready`).then(
          (r) => r.ok,
          () => false,
        ),
      { what: `${id} to be ready`, timeoutMs: 30_000, intervalMs: 200 },
    );
    return worker;
  }

  it('loses no job and pays for no finished step again', async () => {
    const sourceKey = `uploads/${userId}/killed.mp4`;
    const video = await makeVideo(8, 320, 240, { audio: true });
    await infra.s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: sourceKey,
        Body: video,
        ContentType: 'video/mp4',
      }),
    );
    await registerUpload(pool, sourceKey, video.length);

    const first = await startWorker('killed');
    const { job } = await metadata.createJob({
      userId,
      type: 'video.dub',
      input: { sourceKey, targetLanguage: 'uk' },
    });
    await firstAnalyze;
    expect(openAi.calls).toEqual({ transcribe: 1, translate: 0, refit: 0 });
    first.kill('SIGKILL');
    await once(first, 'exit');

    await startWorker('second');
    const finished = await waitFor(
      async () => {
        const current = await metadata.getJob(job.id);
        return current.status === 'succeeded' || current.status === 'dead' ? current : undefined;
      },
      { what: 'the dub to finish on the second pod', timeoutMs: 60_000, intervalMs: 200 },
    );

    expect(finished).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(openAi.calls).toMatchObject({ transcribe: 1, translate: 1 });
    expect(separateCalls).toEqual({ separate: 1, analyze: 2 });
    const { rows } = await pool.query<{ attempt: number; outcome: string; worker_id: string }>(
      'select attempt, outcome, worker_id from job_executions where job_id = $1 order by attempt',
      [job.id],
    );
    expect(rows).toEqual([
      { attempt: 1, outcome: 'abandoned', worker_id: 'worker:killed' },
      { attempt: 2, outcome: 'succeeded', worker_id: 'worker:second' },
    ]);
  });
});
