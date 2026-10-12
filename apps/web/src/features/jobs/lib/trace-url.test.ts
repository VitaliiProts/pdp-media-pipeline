import { jobTraceUrl } from './trace-url';

describe('jobTraceUrl', () => {
  const createdAt = '2026-10-09T10:00:00.000Z';

  it('opens the job dashboard from shortly before the job was created', () => {
    const url = new URL(
      jobTraceUrl('http://grafana.test', { jobId: 'job-1', traceId: 'abc', createdAt }),
    );
    expect(url.pathname).toBe('/d/pdp-job/job');
    expect(url.searchParams.get('var-job_id')).toBe('job-1');
    expect(url.searchParams.get('var-trace_id')).toBe('abc');
    expect(Number(url.searchParams.get('from'))).toBe(Date.parse(createdAt) - 5 * 60_000);
    expect(url.searchParams.get('to')).toBe('now');
  });

  it('still finds the logs by job id when the trace is unknown', () => {
    const url = new URL(
      jobTraceUrl('http://grafana.test', { jobId: 'job-1', traceId: null, createdAt }),
    );
    expect(url.searchParams.has('var-trace_id')).toBe(false);
    expect(url.searchParams.get('var-job_id')).toBe('job-1');
  });
});
