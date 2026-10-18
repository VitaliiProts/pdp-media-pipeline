import { type JobClass, type JobPriority, type JobType } from './jobs';

export const PRIORITY_THRESHOLD = 8;

const CLASS_BY_TYPE: Record<JobType, JobClass> = {
  'image.resize': 'cpu',
  'video.frames': 'cpu',
  'video.transcode': 'cpu',
  'video.dub': 'cpu',
  'webhook.deliver': 'io',
};

/**
 * Routing table shared by the scheduler, which dispatches into the class stream,
 * and the gateway, which sheds load when that stream is too deep.
 *
 * The priority lane exists to jump the CPU queue; I/O work waits on the network, not on CPU,
 * so it always stays in its own class.
 */
export function selectClass(job: { type: JobType; priority: JobPriority }): JobClass {
  const byType = CLASS_BY_TYPE[job.type];
  if (byType === 'cpu' && job.priority >= PRIORITY_THRESHOLD) return 'priority';
  return byType;
}
