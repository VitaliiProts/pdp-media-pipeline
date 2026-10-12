/** The trace may start a little before the job row's `createdAt` (upload, auth). */
const LOOKBACK_MS = 5 * 60_000;

export type TraceTarget = {
  jobId: string;
  traceId: string | null;
  createdAt: string;
};

/** The "Job" dashboard: the trace, the job's logs from every service, and all its traces. */
export function jobTraceUrl(grafanaUrl: string, { jobId, traceId, createdAt }: TraceTarget) {
  const url = new URL(`${grafanaUrl}/d/pdp-job/job`);
  url.searchParams.set('var-job_id', jobId);
  if (traceId) url.searchParams.set('var-trace_id', traceId);
  url.searchParams.set('from', String(Date.parse(createdAt) - LOOKBACK_MS));
  url.searchParams.set('to', 'now');
  return url.toString();
}
