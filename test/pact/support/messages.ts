import { MatchersV3 } from '@pact-foundation/pact';
import {
  AssetDeletedV1,
  dispatchSubject,
  JobCreatedV1,
  type JobClass,
  type JobType,
  selectClass,
} from '@pdp/contracts';
import { EXAMPLE, timestamp } from './pact';

const { integer, like, regex, uuid } = MatchersV3;

/**
 * Inputs as Metadata stores them. The scheduler passes them through, so both sides of the
 * dispatch contracts use the same examples.
 */
export const DISPATCH_INPUTS: Record<JobType, Record<string, unknown>> = {
  'image.resize': { sourceKey: EXAMPLE.sourceKey, presets: ['thumb'] },
  'webhook.deliver': {
    endpointId: EXAMPLE.endpointId,
    messageId: 'msg_2f6a1c9e',
    payload: {
      type: 'job.succeeded',
      timestamp: '2026-10-21T12:00:00.000Z',
      data: {
        jobId: EXAMPLE.jobId,
        jobType: 'image.resize',
        status: 'succeeded',
        attempts: 1,
        deadReason: null,
        lastError: null,
        output: { results: [] },
        finishedAt: '2026-10-21T12:00:00.000Z',
      },
    },
  },
  'video.frames': {
    sourceKey: `uploads/${EXAMPLE.userId}/a.mp4`,
    intervalSeconds: 2,
    maxFrames: 10,
  },
  'video.transcode': { sourceKey: `uploads/${EXAMPLE.userId}/a.mp4`, renditions: ['480p'] },
  'video.dub': {
    sourceKey: `uploads/${EXAMPLE.userId}/a.mp4`,
    targetLanguage: 'uk',
    sourceLanguage: 'auto',
  },
};

export const DISPATCH_PRIORITY = 5;
export const classOf = (type: JobType): JobClass =>
  selectClass({ type, priority: DISPATCH_PRIORITY });

export const dispatchDescription = (type: JobType) => `a ${type} dispatch`;

/** What the scheduler publishes for a job; the subject routes it to a durable consumer. */
export const dispatchMessage = (type: JobType) => ({
  content: {
    version: 1,
    jobId: uuid(EXAMPLE.jobId),
    type,
    class: classOf(type),
    priority: integer(DISPATCH_PRIORITY),
    input: like(DISPATCH_INPUTS[type]),
    attemptBase: integer(0),
    dispatchedAt: timestamp,
  },
  metadata: { subject: dispatchSubject(classOf(type), type) },
});

const envelope = (type: string, payload: Record<string, unknown>) => ({
  eventId: uuid('3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f'),
  type,
  version: 1,
  occurredAt: timestamp,
  payload,
});

export const JOB_CREATED = 'a job.created event of an image job';
export const jobCreatedMessage = {
  content: envelope(JobCreatedV1.type, {
    jobId: uuid(EXAMPLE.jobId),
    userId: uuid(EXAMPLE.userId),
    type: 'image.resize',
    priority: integer(DISPATCH_PRIORITY),
    input: like(DISPATCH_INPUTS['image.resize']),
    attemptBase: integer(0),
  }),
  metadata: { subject: JobCreatedV1.subject },
};

export const ASSET_DELETED = 'an asset.deleted event of a file the user deleted';
export const assetDeletedMessage = {
  content: envelope(AssetDeletedV1.type, {
    assetId: uuid(EXAMPLE.assetId),
    userId: uuid(EXAMPLE.userId),
    key: like(EXAMPLE.sourceKey),
    reason: regex('^(user|unused)$', 'user'),
  }),
  metadata: { subject: AssetDeletedV1.subject },
};

/** The bytes a consumer gets from NATS for a message of a pact. */
export const messageBytes = (content: unknown) =>
  new TextEncoder().encode(typeof content === 'string' ? content : JSON.stringify(content));
