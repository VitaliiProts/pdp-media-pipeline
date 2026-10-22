#!/usr/bin/env node
// Image tags from what goes into each image, read from git without a build (docs/plan/stage-7.1.md).
// The same content gives the same tag, so an unchanged image is neither rebuilt nor rolled out.
//
//   node scripts/image-tags.mjs [--ref <commit>]           # {"api-gateway": "<tag>", ...}
//   node scripts/image-tags.mjs [--ref <commit>] --matrix  # [{app, dockerfile, target, tag}]
//   node scripts/image-tags.mjs [--ref <commit>] --inputs  # the paths behind each tag
//
// A Node image is its app, the workspace libraries it depends on, transitively, as
// `pnpm --filter "<app>..."` in its Dockerfile builds them, and the root build files. An image
// without package.json (audio-separate) is its directory alone, tagged by that tree's hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Every image CI builds: its app directory and, if not the default, the Dockerfile target. */
export const IMAGES = {
  'api-gateway': { dir: 'apps/api-gateway' },
  metadata: { dir: 'apps/metadata' },
  scheduler: { dir: 'apps/scheduler' },
  worker: { dir: 'apps/worker' },
  'video-worker': { dir: 'apps/video-worker' },
  'video-dub': { dir: 'apps/video-worker', target: 'dub' },
  'webhook-receiver': { dir: 'apps/webhook-receiver' },
  web: { dir: 'apps/web' },
  'audio-separate': { dir: 'apps/audio-separate' },
};

/** Root files a Node image is built with: its Dockerfile copies the repository root. */
export const ROOT_FILES = [
  '.dockerignore',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
];

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Object hash of each path at `ref` that exists there. */
function objects(cwd, ref, paths) {
  const out = git(cwd, 'ls-tree', '--full-tree', ref, '--', ...paths);
  return new Map(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, path] = line.split('\t');
        return [path, meta.split(' ')[2]];
      }),
  );
}

/** Workspace packages at `ref` by name: their directory and the workspace packages they use. */
function workspace(cwd, ref) {
  const files = git(cwd, 'ls-tree', '-r', '--name-only', '--full-tree', ref, '--', 'apps', 'libs')
    .split('\n')
    .filter((f) => /^(apps|libs)\/[^/]+\/package\.json$/.test(f));
  const packages = new Map();
  for (const file of files) {
    const pkg = JSON.parse(git(cwd, 'show', `${ref}:${file}`));
    const deps = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(([, version]) => String(version).startsWith('workspace:'))
      .map(([name]) => name);
    packages.set(pkg.name, { dir: dirname(file), deps });
  }
  return packages;
}

/** The paths behind each image's tag at `ref`, sorted. */
export function imageInputs(ref = 'HEAD', cwd = process.cwd(), images = IMAGES) {
  const packages = workspace(cwd, ref);
  const byDir = new Map([...packages].map(([name, p]) => [p.dir, name]));
  const result = {};
  for (const [image, { dir }] of Object.entries(images)) {
    const name = byDir.get(dir);
    if (name === undefined) {
      result[image] = [dir];
      continue;
    }
    const dirs = new Set();
    const queue = [name];
    while (queue.length > 0) {
      const pkg = packages.get(queue.shift());
      if (!pkg || dirs.has(pkg.dir)) continue;
      dirs.add(pkg.dir);
      queue.push(...pkg.deps);
    }
    result[image] = [...dirs, ...ROOT_FILES].sort();
  }
  return result;
}

/**
 * The tag of each image at `ref`: the tree hash of a one-directory image, otherwise a hash of
 * its inputs' object hashes. A root file the repository does not have counts as absent.
 */
export function imageTags(ref = 'HEAD', cwd = process.cwd(), images = IMAGES) {
  const inputs = imageInputs(ref, cwd, images);
  const hashes = objects(cwd, ref, [...new Set(Object.values(inputs).flat())]);
  const tags = {};
  for (const [image, paths] of Object.entries(inputs)) {
    const dir = images[image].dir;
    if (!hashes.has(dir)) throw new Error(`${image}: ${dir} is not in ${ref}`);
    if (paths.length === 1) {
      tags[image] = hashes.get(dir);
      continue;
    }
    const lines = paths.map((p) => `${p} ${hashes.get(p) ?? '-'}`).join('\n');
    tags[image] = createHash('sha256').update(lines).digest('hex').slice(0, 40);
  }
  return tags;
}

/** A build matrix entry of an image: what docker/build-push-action needs besides the tag. */
export function matrixEntry(image) {
  const { dir, target } = IMAGES[image];
  return { app: image, dockerfile: dir.split('/').pop(), ...(target && { target }) };
}

function main() {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string', default: 'HEAD' },
      inputs: { type: 'boolean' },
      matrix: { type: 'boolean' },
    },
  });
  if (values.inputs) {
    console.log(JSON.stringify(imageInputs(values.ref), null, 2));
    return;
  }
  const tags = imageTags(values.ref);
  const result = values.matrix
    ? Object.entries(tags).map(([image, tag]) => ({ ...matrixEntry(image), tag }))
    : tags;
  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
