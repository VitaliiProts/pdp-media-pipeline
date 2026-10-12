import { PRIORITY_THRESHOLD, selectClass } from './job-class';
import { DEFAULT_JOB_PRIORITY, JOB_TYPES } from './jobs';

describe('selectClass', () => {
  it.each(JOB_TYPES)('routes %s with default priority to cpu', (type) => {
    expect(selectClass({ type, priority: DEFAULT_JOB_PRIORITY })).toBe('cpu');
  });

  it.each([PRIORITY_THRESHOLD, 9])('routes priority %i to the priority class', (priority) => {
    expect(selectClass({ type: 'image.resize', priority })).toBe('priority');
  });

  it('keeps priority just below the threshold in its type class', () => {
    expect(selectClass({ type: 'image.resize', priority: PRIORITY_THRESHOLD - 1 })).toBe('cpu');
  });

  it('routes low priority to its type class', () => {
    expect(selectClass({ type: 'video.transcode', priority: 0 })).toBe('cpu');
  });
});
