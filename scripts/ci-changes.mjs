#!/usr/bin/env node
// Which CI jobs a change needs (docs/plan/stage-7.1.md): the images whose tag changed, for the
// `docker` matrix, and a flag per area for the other jobs. Prints `key=value` lines for
// $GITHUB_OUTPUT and, in Actions, a table into the job summary.
//
//   node scripts/ci-changes.mjs --base <commit> [--head <commit>]
//
// Compares `head` with its merge base with `base`. Without a usable base, or when the selection
// itself changes, everything runs: a bug in it must not hide itself.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { IMAGES, imageTags, matrixEntry } from './image-tags.mjs';

/** A change here runs every job. */
const SELF = [
  /^\.github\/workflows\/ci\.yml$/,
  /^\.github\/actions\//,
  /^scripts\/(ci-changes|image-tags)\.mjs$/,
];

/** Files no Node job reads: everything else is a reason to lint, build and test. */
const NOT_NODE = [
  /^docs\//,
  /^perf\/reports\//,
  /^spikes\//,
  /^deploy\//,
  /^apps\/audio-separate\//,
  /^\.github\//,
  /^\.husky\//,
  /^docker-compose\.yml$/,
  /^\.gitignore$/,
  /\.md$/,
];

/** What the E2E stack runs (scripts/e2e.sh, e2e/docker-bake.hcl). */
const E2E_IMAGES = [
  'api-gateway',
  'metadata',
  'scheduler',
  'worker',
  'video-worker',
  'video-dub',
  'web',
];

const AREAS = {
  python: [/^apps\/audio-separate\//],
  helm: [/^deploy\/helm\//, /^deploy\/observability\//, /^scripts\/helm-check\.sh$/],
  terraform: [/^deploy\/terraform\//],
  alerts: [/^deploy\/observability\/vmalert\//],
  audit: [/(^|\/)package\.json$/, /^pnpm-lock\.yaml$/],
  e2e: [/^e2e\//, /^docker-compose\.yml$/, /^scripts\/e2e\.sh$/],
  actions: [/^\.github\//],
};

const any = (files, patterns) => files.some((f) => patterns.some((p) => p.test(f)));

/** Jobs for the changed files and images; `null` files means a change of unknown extent. */
export function select(files, images) {
  if (files === null || any(files, SELF)) {
    return {
      all: true,
      images: Object.keys(IMAGES),
      node: true,
      ...Object.fromEntries(Object.keys(AREAS).map((area) => [area, true])),
    };
  }
  const areas = Object.fromEntries(Object.entries(AREAS).map(([area, p]) => [area, any(files, p)]));
  return {
    all: false,
    images,
    node: files.some((f) => !NOT_NODE.some((p) => p.test(f))),
    ...areas,
    e2e: areas.e2e || images.some((image) => E2E_IMAGES.includes(image)),
  };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** The files and images that differ between `head` and its merge base with `base`. */
export function changes(base, head = 'HEAD') {
  let from;
  try {
    from = execFileSync('git', ['merge-base', base, head], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return { files: null, images: Object.keys(IMAGES) };
  }
  const files = git('diff', '--name-only', from, head).split('\n').filter(Boolean);
  const [before, after] = [imageTags(from), imageTags(head)];
  return { files, images: Object.keys(after).filter((image) => before[image] !== after[image]) };
}

/** `key=value` lines for $GITHUB_OUTPUT. */
export function outputs(selection) {
  const { images, ...flags } = selection;
  return [
    `images=${JSON.stringify(images.map(matrixEntry))}`,
    ...Object.entries(flags).map(([k, v]) => `${k}=${v}`),
  ].join('\n');
}

function summary(selection, files) {
  const { images, all, ...flags } = selection;
  const on = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return [
    '## Changes',
    '',
    all
      ? '**Everything runs**: no usable base, or the selection itself changed.'
      : `${files.length} files changed.`,
    '',
    `- images: ${images.length > 0 ? images.join(', ') : 'none'}`,
    `- areas: ${on.length > 0 ? on.join(', ') : 'none'}`,
    '',
  ].join('\n');
}

function main() {
  const { values } = parseArgs({
    options: { base: { type: 'string' }, head: { type: 'string', default: 'HEAD' } },
  });
  const { files, images } = values.base
    ? changes(values.base, values.head)
    : { files: null, images: Object.keys(IMAGES) };
  const selection = select(files, images);
  console.log(outputs(selection));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(selection, files ?? []));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
