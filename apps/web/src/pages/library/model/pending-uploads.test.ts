import { ASSETS_PAGE_SIZE } from '../../../features/assets';
import { type Upload } from '../../../features/upload';
import { testAsset } from '../../../test/fixtures';
import { awaitedJobIds, newlyListedJobIds, pendingUploads } from './pending-uploads';

const base = { fileName: 'a.png', kind: 'image', previewUrl: 'blob:1', createdAt: 1 } as const;

const listing = (jobId: string) =>
  testAsset({ latestJob: { id: jobId, type: 'image.resize', status: 'running' } });

const submitted = (n: number): Upload => ({
  ...base,
  id: `u${n}`,
  createdAt: n,
  phase: 'submitted',
  jobId: `job-${n}`,
});

describe('pendingUploads', () => {
  it('drops an upload once the list shows the asset its job made', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'submitted', jobId: 'job-1' },
      { ...base, id: 'u2', phase: 'submitted', jobId: 'job-2' },
      { ...base, id: 'u3', phase: 'uploading', progress: 0.5 },
      { ...base, id: 'u4', phase: 'failed', problem: 'empty', detail: null },
    ];

    expect(pendingUploads(uploads, [listing('job-1')]).map((u) => u.id)).toEqual([
      'u2',
      'u3',
      'u4',
    ]);
  });

  it('keeps a listed upload gone after its asset leaves the list', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'submitted', jobId: 'job-1', listed: true },
    ];

    expect(pendingUploads(uploads, [])).toEqual([]);
  });

  it('gives up on submitted uploads too old to be on the first page', () => {
    const uploads = Array.from({ length: ASSETS_PAGE_SIZE + 1 }, (_, i) => submitted(i + 1));
    const failed: Upload = { ...base, id: 'f', phase: 'failed', problem: 'empty', detail: null };

    const pending = pendingUploads([...uploads, failed], []).map((u) => u.id);
    expect(pending).toHaveLength(ASSETS_PAGE_SIZE + 1);
    expect(pending).not.toContain('u1');
    expect(pending).toContain('f');
  });
});

describe('awaitedJobIds', () => {
  it('waits for submitted uploads the list has not shown yet', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'submitted', jobId: 'job-1', listed: true },
      { ...base, id: 'u2', phase: 'submitted', jobId: 'job-2' },
      { ...base, id: 'u3', phase: 'creating' },
    ];

    expect(awaitedJobIds(uploads)).toEqual(['job-2']);
  });

  it('waits only for as many as fit on the first page, newest first', () => {
    const uploads = Array.from({ length: ASSETS_PAGE_SIZE + 1 }, (_, i) => submitted(i + 1));

    const awaited = awaitedJobIds(uploads);
    expect(awaited).toHaveLength(ASSETS_PAGE_SIZE);
    expect(awaited).not.toContain('job-1');
  });
});

describe('newlyListedJobIds', () => {
  it('names the jobs of submitted uploads that the list shows and that are not marked yet', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'submitted', jobId: 'job-1' },
      { ...base, id: 'u2', phase: 'submitted', jobId: 'job-2', listed: true },
      { ...base, id: 'u3', phase: 'submitted', jobId: 'job-3' },
    ];

    expect(newlyListedJobIds(uploads, [listing('job-1'), listing('job-2')])).toEqual(['job-1']);
  });
});
