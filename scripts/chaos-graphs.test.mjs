import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphWindow } from './chaos-graphs.mjs';

describe('graphWindow', () => {
  it('spans the load to a minute after the drain and places the failure in it', () => {
    const { from, to, fault } = graphWindow({
      start: '2026-10-21T12:00:00Z',
      'fault-on': '2026-10-21T12:01:00Z',
      'fault-off': '2026-10-21T12:05:00Z',
      end: '2026-10-21T12:09:00Z',
    });
    assert.equal(from, Date.parse('2026-10-21T12:00:00Z'));
    assert.equal(to, Date.parse('2026-10-21T12:10:00Z'));
    assert.deepEqual(fault, [0.1, 0.5]);
  });
});
