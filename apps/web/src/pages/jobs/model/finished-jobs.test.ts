import { finishedSince, sameSnapshot, snapshotOf } from './finished-jobs';
import { type SheetItem } from './sheet-items';

const jobItem = (
  jobId: string,
  status: Extract<SheetItem, { kind: 'job' }>['status'],
): SheetItem => ({
  kind: 'job',
  key: `job:${jobId}`,
  jobId,
  title: null,
  previewUrl: null,
  status,
  attempts: 1,
  lastError: null,
  deadReason: null,
  progress: null,
  results: [],
  frames: [],
  createdAt: '2026-10-09T10:00:00.000Z',
  traceId: null,
});

describe('finished jobs', () => {
  it('reports jobs that reached a final state since the snapshot', () => {
    const before = snapshotOf([
      jobItem('a', 'running'),
      jobItem('b', 'queued'),
      jobItem('c', 'succeeded'),
    ]);
    const now = [jobItem('a', 'succeeded'), jobItem('b', 'running'), jobItem('c', 'succeeded')];
    expect(finishedSince(before, now).map((item) => item.jobId)).toEqual(['a']);
  });

  it('does not report jobs first seen already finished', () => {
    expect(finishedSince(snapshotOf([]), [jobItem('a', 'dead')])).toEqual([]);
  });

  it('compares snapshots by status', () => {
    const a = snapshotOf([jobItem('a', 'running')]);
    expect(sameSnapshot(a, snapshotOf([jobItem('a', 'running')]))).toBe(true);
    expect(sameSnapshot(a, snapshotOf([jobItem('a', 'succeeded')]))).toBe(false);
    expect(sameSnapshot(a, snapshotOf([]))).toBe(false);
  });
});
