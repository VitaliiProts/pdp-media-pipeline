import { JobDto, ProgressRequest } from './metadata-api';
import { DUB_STEPS } from './video-dub';

describe('ProgressRequest', () => {
  it('takes the step the job is in', () => {
    expect(ProgressRequest.parse({ attempt: 1, progress: 45, step: 'align' })).toEqual({
      attempt: 1,
      progress: 45,
      step: 'align',
    });
  });

  it('accepts every dub step', () => {
    for (const step of DUB_STEPS) {
      expect(ProgressRequest.safeParse({ attempt: 1, progress: 0, step }).success).toBe(true);
    }
  });

  it.each(['', 'Align', 'two words', 'x'.repeat(33)])('rejects step %j', (step) => {
    expect(ProgressRequest.safeParse({ attempt: 1, progress: 0, step }).success).toBe(false);
  });
});

describe('JobDto', () => {
  it('has no step when the stored job predates steps', () => {
    const job = JobDto.parse({
      id: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      type: 'video.dub',
      class: 'cpu',
      status: 'running',
      priority: 5,
      input: {},
      output: null,
      attempts: 1,
      attemptBase: 0,
      deadReason: null,
      lastError: null,
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      finishedAt: null,
      progress: 10,
    });
    expect(job.progressStep).toBeNull();
  });
});
