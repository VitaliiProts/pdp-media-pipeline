import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  commitsBetween,
  latestVersion,
  nextVersion,
  parseCommit,
  renderNotes,
} from './release-notes.mjs';

const c = (type, extra = {}) => ({
  sha: 'a'.repeat(40),
  pr: null,
  type,
  scope: null,
  subject: `a ${type}`,
  breaking: false,
  ...extra,
});

describe('parseCommit', () => {
  it('reads type, scope and subject', () => {
    assert.deepEqual(parseCommit('fix(web): keep the banner sized'), {
      type: 'fix',
      scope: 'web',
      subject: 'keep the banner sized',
      breaking: false,
    });
  });

  it('marks a breaking change by ! or by the body', () => {
    assert.equal(parseCommit('feat!: drop v0')?.breaking, true);
    assert.equal(parseCommit('feat: x', 'BREAKING CHANGE: the field is gone')?.breaking, true);
  });

  it('drops the pull request number of a squash merge from the subject', () => {
    assert.equal(parseCommit('feat: x (#12)')?.subject, 'x');
  });

  it('is null for a subject that is not conventional', () => {
    assert.equal(parseCommit('Update README.md'), null);
  });
});

describe('nextVersion', () => {
  it('bumps the major for a breaking change, the minor for a feature, else the patch', () => {
    assert.equal(nextVersion('v1.4.2', [c('fix'), c('feat', { breaking: true })]), 'v2.0.0');
    assert.equal(nextVersion('v1.4.2', [c('fix'), c('feat')]), 'v1.5.0');
    assert.equal(nextVersion('v1.4.2', [c('docs')]), 'v1.4.3');
    assert.equal(nextVersion('v1.4.2', []), 'v1.4.3');
  });

  it('starts from v0.0.0', () => {
    assert.equal(nextVersion(null, [c('feat')]), 'v0.1.0');
  });
});

describe('renderNotes', () => {
  const notes = renderNotes({
    version: 'v0.3.0',
    previous: 'v0.2.0',
    date: '2026-10-22',
    repo: 'o/r',
    commits: [
      c('fix', { scope: 'web', subject: 'keep the banner sized', pr: 28 }),
      c('feat', { subject: 'partial rollback' }),
      c('feat', { scope: 'scripts', subject: 'release notes' }),
      c('ci'),
      c(null, { subject: 'Update README.md' }),
    ],
    release: '20261022T143000Z-d36130c',
    images: ['web'],
  });

  it('heads with the version, its compare link and the date', () => {
    assert.match(
      notes,
      /^## \[0\.3\.0\]\(https:\/\/github\.com\/o\/r\/compare\/v0\.2\.0\.\.\.v0\.3\.0\) \(2026-10-22\)/,
    );
  });

  it('groups features and fixes, with links to the pull request and the commit', () => {
    assert.ok(notes.indexOf('### Features') < notes.indexOf('### Bug Fixes'));
    assert.match(notes, /- \*\*scripts:\*\* release notes /);
    assert.match(
      notes,
      /- \*\*web:\*\* keep the banner sized \(\[#28\]\(https:\/\/github\.com\/o\/r\/pull\/28\)\) \(\[aaaaaaa\]\(https:\/\/github\.com\/o\/r\/commit\/a{40}\)\)/,
    );
  });

  it('folds the rest away and names the images and the release', () => {
    assert.match(notes, /<details><summary>Other changes \(2\)<\/summary>/);
    assert.match(notes, /- \*\*ci:\*\* a ci /);
    assert.match(notes, /- Update README\.md /);
    assert.match(notes, /Images: web\n/);
    assert.match(notes, /scripts\/aws\.sh rollback 20261022T143000Z-d36130c/);
  });
});

describe('commitsBetween', () => {
  let dir;
  let git;
  const commit = (message) => {
    writeFileSync(join(dir, 'f'), message);
    git('add', '-A');
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    git = (...args) =>
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: dir, encoding: 'utf8' },
      ).trim();
    git('init', '-q', '-b', 'main');
  });
  after(() => rmSync(dir, { recursive: true }));

  it('finds the pull request of a merged branch, skips the merge, and reads versions', () => {
    const base = commit('feat: first');
    git('tag', 'v0.1.0');
    git('switch', '-qc', 'topic');
    const a = commit('fix(web): one');
    const b = commit('feat: two');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', 'topic', '-m', 'Merge pull request #7 from o/topic');
    const d = commit('docs: three (#9)');

    const commits = commitsBetween(base, 'HEAD', dir);
    assert.deepEqual(
      commits.map((x) => [x.sha, x.pr, x.type]),
      [
        [a, 7, 'fix'],
        [b, 7, 'feat'],
        [d, 9, 'docs'],
      ],
    );
    assert.equal(latestVersion(dir), 'v0.1.0');
    assert.equal(nextVersion(latestVersion(dir), commits), 'v0.2.0');
  });
});
