import { VideoDubInputV1, VideoFramesInputV1, VideoTranscodeInputV1 } from '@pdp/contracts';
import {
  describeDispatches,
  describeJobRunner,
  describeProgress,
  type RunnerContract,
} from '../support/job-runner';
import { DISPATCH_INPUTS } from '../support/messages';
import { pactBetween } from '../support/pact';

const pact = pactBetween('video-worker', 'metadata');
const fromScheduler = pactBetween('video-worker', 'scheduler');

const frames: RunnerContract = {
  type: 'video.frames',
  consumer: 'video-cpu',
  inputSchema: VideoFramesInputV1,
  input: DISPATCH_INPUTS['video.frames'],
  output: {
    durationSeconds: 10,
    frames: [
      { key: 'results/job/frame-0.webp', atSeconds: 0, width: 640, height: 360, bytes: 8192 },
    ],
  },
};

describe('video-worker → metadata', () => {
  describeJobRunner(pact, frames);
  describeProgress(pact, frames);
});

describe('video-worker ← scheduler', () => {
  describeDispatches(fromScheduler, [
    { type: 'video.frames', inputSchema: VideoFramesInputV1 },
    { type: 'video.transcode', inputSchema: VideoTranscodeInputV1 },
    { type: 'video.dub', inputSchema: VideoDubInputV1 },
  ]);
});
