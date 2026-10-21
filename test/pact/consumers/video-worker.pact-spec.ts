import { VideoFramesInputV1 } from '@pdp/contracts';
import { describeJobRunner, describeProgress, type RunnerContract } from '../support/job-runner';
import { EXAMPLE, pactBetween } from '../support/pact';

const pact = pactBetween('video-worker', 'metadata');

const frames: RunnerContract = {
  type: 'video.frames',
  consumer: 'video-cpu',
  inputSchema: VideoFramesInputV1,
  input: { sourceKey: `uploads/${EXAMPLE.userId}/a.mp4`, intervalSeconds: 2, maxFrames: 10 },
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
