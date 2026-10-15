import { isTerminal, type JobStatus } from '../../../features/jobs';
import { type SheetItem } from './sheet-items';

type JobItem = Extract<SheetItem, { kind: 'job' }>;

export type StatusSnapshot = ReadonlyMap<string, JobStatus>;

export function snapshotOf(items: readonly SheetItem[]): StatusSnapshot {
  const statuses = new Map<string, JobStatus>();
  for (const item of items) if (item.kind === 'job') statuses.set(item.jobId, item.status);
  return statuses;
}

export function sameSnapshot(a: StatusSnapshot, b: StatusSnapshot): boolean {
  if (a.size !== b.size) return false;
  for (const [id, status] of a) if (b.get(id) !== status) return false;
  return true;
}

/** Jobs that reached a final state since `before`; ones first seen already finished are skipped. */
export function finishedSince(before: StatusSnapshot, items: readonly SheetItem[]): JobItem[] {
  return items.filter((item): item is JobItem => {
    if (item.kind !== 'job' || !isTerminal(item.status)) return false;
    const was = before.get(item.jobId);
    return was !== undefined && !isTerminal(was);
  });
}
