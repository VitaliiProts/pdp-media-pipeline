import { type JobClass, type JobPriority, type JobType } from './jobs';

export const PRIORITY_THRESHOLD = 8;

const CLASS_BY_TYPE: Record<JobType, JobClass> = {
  'image.resize': 'cpu',
  'video.frames': 'cpu',
  'video.transcode': 'cpu',
};

/**
 * Routing table shared by the scheduler, which dispatches into the class stream,
 * and the gateway, which sheds load when that stream is too deep.
 */
export function selectClass(job: { type: JobType; priority: JobPriority }): JobClass {
  if (job.priority >= PRIORITY_THRESHOLD) return 'priority';
  return CLASS_BY_TYPE[job.type];
}
