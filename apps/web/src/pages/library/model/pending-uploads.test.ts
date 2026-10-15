import { type Upload } from '../../../features/upload';
import { testAsset } from '../../../test/fixtures';
import { pendingUploads } from './pending-uploads';

const base = { fileName: 'a.png', kind: 'image', previewUrl: 'blob:1', createdAt: 1 } as const;

describe('pendingUploads', () => {
  it('drops an upload once the list shows the asset its job made', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'submitted', jobId: 'job-1' },
      { ...base, id: 'u2', phase: 'submitted', jobId: 'job-2' },
      { ...base, id: 'u3', phase: 'uploading', progress: 0.5 },
      { ...base, id: 'u4', phase: 'failed', problem: 'empty', detail: null },
    ];
    const assets = [
      testAsset({ latestJob: { id: 'job-1', type: 'image.resize', status: 'running' } }),
    ];

    expect(pendingUploads(uploads, assets).map((u) => u.id)).toEqual(['u2', 'u3', 'u4']);
  });
});
