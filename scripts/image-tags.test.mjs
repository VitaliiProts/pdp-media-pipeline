import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { imageInputs, imageTags } from './image-tags.mjs';

/** A throwaway repository with the layout of this one: a few apps, libraries and root files. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'image-tags-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const pkg = (path, name, deps = {}) =>
    write(path, JSON.stringify({ name, dependencies: deps, devDependencies: {} }));
  const commit = (message) => {
    git('add', '-A');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      message,
    );
    return git('rev-parse', 'HEAD');
  };

  git('init', '-q');
  for (const f of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']) {
    write(f, f);
  }
  write('docs/a.md', 'a');
  pkg('libs/contracts/package.json', '@pdp/contracts');
  pkg('libs/messaging/package.json', '@pdp/messaging', { '@pdp/contracts': 'workspace:*' });
  pkg('libs/config/package.json', '@pdp/config');
  pkg('apps/api-gateway/package.json', '@pdp/api-gateway', {
    '@pdp/messaging': 'workspace:*',
    zod: '^3',
  });
  pkg('apps/metadata/package.json', '@pdp/metadata', { '@pdp/config': 'workspace:*' });
  pkg('apps/web/package.json', '@pdp/web');
  write('apps/web/src/main.tsx', '1');
  write('apps/audio-separate/pyproject.toml', 'x');
  return { dir, git, write, pkg, commit, cleanup: () => rmSync(dir, { recursive: true }) };
}

const IMAGES = {
  'api-gateway': { dir: 'apps/api-gateway' },
  metadata: { dir: 'apps/metadata' },
  web: { dir: 'apps/web' },
  'audio-separate': { dir: 'apps/audio-separate' },
};

/** The images whose tag differs between two commits. */
const changed = (r, a, b) => {
  const [x, y] = [imageTags(a, r.dir, IMAGES), imageTags(b, r.dir, IMAGES)];
  return Object.keys(y).filter((image) => x[image] !== y[image]);
};

describe('imageTags', () => {
  let r;
  let base;
  before(() => {
    r = repo();
    base = r.commit('base');
  });
  after(() => r.cleanup());

  it('takes the app, its libraries transitively and the root build files', () => {
    assert.deepEqual(imageInputs(base, r.dir, IMAGES)['api-gateway'], [
      '.dockerignore',
      '.npmrc',
      'apps/api-gateway',
      'libs/contracts',
      'libs/messaging',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'tsconfig.json',
    ]);
  });

  it('takes only its directory for an image without package.json', () => {
    assert.deepEqual(imageInputs(base, r.dir, IMAGES)['audio-separate'], ['apps/audio-separate']);
  });

  it('tags a one-directory image by the tree hash of that directory', () => {
    assert.equal(
      imageTags(base, r.dir, IMAGES)['audio-separate'],
      r.git('rev-parse', `${base}:apps/audio-separate`),
    );
  });

  it('changes nothing for documentation', () => {
    r.write('docs/a.md', 'b');
    assert.deepEqual(changed(r, base, r.commit('docs')), []);
  });

  it('changes only the web image for a change in the web app', () => {
    const from = r.git('rev-parse', 'HEAD');
    r.write('apps/web/src/main.tsx', '2');
    assert.deepEqual(changed(r, from, r.commit('web')), ['web']);
  });

  it('changes the apps that depend on a library, through other libraries too', () => {
    const from = r.git('rev-parse', 'HEAD');
    r.write('libs/contracts/src/index.ts', 'export {}');
    assert.deepEqual(changed(r, from, r.commit('contracts')), ['api-gateway']);
  });

  it('changes every Node image for the lockfile, and not the Python one', () => {
    const from = r.git('rev-parse', 'HEAD');
    r.write('pnpm-lock.yaml', 'new');
    assert.deepEqual(changed(r, from, r.commit('lockfile')), ['api-gateway', 'metadata', 'web']);
  });

  it('follows a new workspace dependency', () => {
    const from = r.git('rev-parse', 'HEAD');
    r.pkg('apps/web/package.json', '@pdp/web', { '@pdp/contracts': 'workspace:*' });
    r.commit('web uses contracts');
    assert.ok(imageInputs('HEAD', r.dir, IMAGES).web.includes('libs/contracts'));
    r.write('libs/contracts/src/index.ts', 'export const x = 1');
    const after = r.commit('contracts again');
    assert.notEqual(imageTags(from, r.dir, IMAGES).web, imageTags(after, r.dir, IMAGES).web);
    assert.deepEqual(changed(r, 'HEAD~1', after), ['api-gateway', 'web']);
  });

  it('fails on an image whose directory is missing', () => {
    assert.throws(
      () => imageTags('HEAD', r.dir, { gone: { dir: 'apps/gone' } }),
      /apps\/gone is not in/,
    );
  });
});
