import { type Job } from '../../../features/jobs';
import { type Upload } from '../../../features/upload';
import { buildSheetItems } from './sheet-items';

const base = { fileName: 'cat.png', previewUrl: 'blob:cat', createdAt: 1 };

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  status: 'running',
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  ...overrides,
});

describe('buildSheetItems', () => {
  it('puts uploads in flight before server jobs', () => {
    const uploads: Upload[] = [{ ...base, id: 'u1', phase: 'uploading', progress: 0.4 }];
    const items = buildSheetItems([job()], uploads);
    expect(items.map((i) => i.key)).toEqual(['upload:u1', 'job:job-1']);
    expect(items[0]).toMatchObject({ stage: { phase: 'uploading', progress: 0.4 } });
  });

  it('shows a submitted upload only through its job, with the local name and preview', () => {
    const uploads: Upload[] = [{ ...base, id: 'u1', phase: 'submitted', jobId: 'job-1' }];
    expect(buildSheetItems([job()], uploads)).toEqual([
      expect.objectContaining({ kind: 'job', title: 'cat.png', previewUrl: 'blob:cat' }),
    ]);
  });

  it('prefers the medium result as preview once the job succeeded', () => {
    const results = [
      { preset: 'thumb', width: 200, height: 100, bytes: 10, url: 'https://s3/thumb' },
      { preset: 'medium', width: 800, height: 400, bytes: 20, url: 'https://s3/medium' },
    ];
    const [item] = buildSheetItems([job({ status: 'succeeded', results })], []);
    expect(item).toMatchObject({ previewUrl: 'https://s3/medium', title: null });
  });

  it('keeps failed uploads with their problem', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'failed', problem: 'size', detail: null },
    ];
    expect(buildSheetItems([], uploads)[0]).toMatchObject({
      stage: { phase: 'failed', problem: 'size' },
    });
  });
});
