import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphWindow } from './chaos-graphs.mjs';

const timeline = {
  start: '2026-10-21T12:00:00Z',
  'fault-on': '2026-10-21T12:01:00Z',
  'fault-off': '2026-10-21T12:05:00Z',
  end: '2026-10-21T12:09:00Z',
};

describe('graphWindow', () => {
  it('spans the load to a minute after the drain', () => {
    const { from, to } = graphWindow(timeline);
    assert.equal(from, Date.parse('2026-10-21T12:00:00Z'));
    assert.equal(to, Date.parse('2026-10-21T12:10:00Z'));
  });

  it('shades a schedule or a mock fault until it is removed', () => {
    const schedule = 'kind: Schedule\nspec:\n  schedule: "@every 40s"\n    duration: 20s\n';
    assert.deepEqual(graphWindow(timeline, schedule).fault, [0.1, 0.5]);
    assert.deepEqual(graphWindow(timeline).fault, [0.1, 0.5]);
  });

  it('shades a one-shot experiment for its own duration', () => {
    const partition = 'kind: NetworkChaos\nspec:\n  action: partition\n  duration: 60s\n';
    assert.deepEqual(graphWindow(timeline, partition).fault, [0.1, 0.2]);
  });
});
