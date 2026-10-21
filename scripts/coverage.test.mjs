import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import libCoverage from 'istanbul-lib-coverage';
import { shortfalls, summarise } from './coverage.mjs';

const ROOT = '/repo';

/** A file of `lines` one-statement lines, the first `hit` of them run, by the run's own count. */
const file = (relative, lines, hit, extraHits = {}) => {
  const statementMap = {};
  const s = {};
  for (let i = 0; i < lines; i++) {
    statementMap[i] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } };
    s[i] = extraHits[i] ?? (i < hit ? 1 : 0);
  }
  const p = `${ROOT}/${relative}`;
  return { [p]: { path: p, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} } };
};

describe('summarise', () => {
  it('counts a line once when either run covered it', () => {
    const map = libCoverage.createCoverageMap({});
    map.merge(file('apps/a/src/x.ts', 4, 2));
    map.merge(file('apps/a/src/x.ts', 4, 0, { 3: 1 }));
    assert.deepEqual(summarise(map, ROOT), { files: 1, lines: 75, branches: 100 });
  });

  it('takes only the files of the area', () => {
    const map = libCoverage.createCoverageMap({
      ...file('apps/a/src/auth/login.ts', 2, 2),
      ...file('apps/a/src/jobs/jobs.ts', 2, 0),
    });
    assert.deepEqual(summarise(map, ROOT, [/\/auth\//]), { files: 1, lines: 100, branches: 100 });
  });
});

describe('shortfalls', () => {
  it('names every metric below its floor', () => {
    assert.deepEqual(
      shortfalls('login', { files: 3, lines: 70, branches: 50 }, { lines: 80, branches: 40 }),
      ['login: lines 70% < 80%'],
    );
  });

  it('fails an area no file matched, so a moved file cannot pass unnoticed', () => {
    assert.deepEqual(
      shortfalls('library', { files: 0, lines: 100, branches: 100 }, { lines: 80 }),
      ['library: no files matched'],
    );
  });
});
