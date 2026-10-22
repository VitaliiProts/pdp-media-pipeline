import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IMAGES } from './image-tags.mjs';
import { outputs, select } from './ci-changes.mjs';

/** The flags that are on. */
const on = (selection) =>
  Object.entries(selection)
    .filter(([k, v]) => k !== 'images' && v === true)
    .map(([k]) => k)
    .sort();

describe('select', () => {
  it('runs nothing but the always-on jobs for documentation', () => {
    const s = select(
      ['docs/plan/x.md', 'README.md', 'apps/web/README.md', 'perf/reports/stage-6/01.png'],
      [],
    );
    assert.deepEqual(on(s), []);
    assert.deepEqual(s.images, []);
  });

  it('runs Node jobs, the image and E2E for a web change', () => {
    const s = select(['apps/web/src/main.tsx'], ['web']);
    assert.deepEqual(on(s), ['e2e', 'node']);
    assert.deepEqual(s.images, ['web']);
  });

  it('runs only the Python job and its image for audio-separate', () => {
    const s = select(['apps/audio-separate/audio_separate/app.py'], ['audio-separate']);
    assert.deepEqual(on(s), ['python']);
  });

  it('runs Helm checks without Node jobs for a chart change', () => {
    assert.deepEqual(on(select(['deploy/helm/web/values.yaml'], [])), ['helm']);
  });

  it('runs alert tests and Helm checks for an alert rule', () => {
    const s = select(['deploy/observability/vmalert/rules/alerts.yml'], []);
    assert.deepEqual(on(s), ['alerts', 'helm']);
  });

  it('runs audit and Node jobs for a dependency change', () => {
    assert.deepEqual(on(select(['apps/metadata/package.json', 'pnpm-lock.yaml'], [])), [
      'audit',
      'node',
    ]);
  });

  it('runs Node jobs for tests and scripts, which no image contains', () => {
    assert.deepEqual(on(select(['test/redelivery.int-spec.ts'], [])), ['node']);
    assert.deepEqual(on(select(['scripts/chaos-audit.mjs'], [])), ['node']);
  });

  it('runs E2E for the compose file without Node jobs', () => {
    assert.deepEqual(on(select(['docker-compose.yml'], [])), ['e2e']);
  });

  it('only lints the deploy workflow', () => {
    assert.deepEqual(on(select(['.github/workflows/deploy.yml'], [])), ['actions']);
  });

  it('runs everything when the selection itself changes', () => {
    for (const file of [
      '.github/workflows/ci.yml',
      'scripts/image-tags.mjs',
      '.github/actions/setup/action.yml',
    ]) {
      const s = select([file], []);
      assert.equal(s.all, true, file);
      assert.deepEqual(s.images, Object.keys(IMAGES));
    }
  });

  it('runs everything when the extent of the change is unknown', () => {
    assert.equal(select(null, []).all, true);
  });
});

describe('outputs', () => {
  it('gives the docker matrix the Dockerfile and target of each image', () => {
    const lines = outputs(select(['apps/video-worker/src/x.ts'], ['video-worker', 'video-dub']));
    assert.match(
      lines,
      /^images=\[{"app":"video-worker","dockerfile":"video-worker"},{"app":"video-dub","dockerfile":"video-worker","target":"dub"}]$/m,
    );
    assert.match(lines, /^node=true$/m);
    assert.match(lines, /^python=false$/m);
  });
});
