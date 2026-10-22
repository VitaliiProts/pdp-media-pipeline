#!/usr/bin/env node
// The version and notes of a release, from the conventional commits since the current one
// (docs/plan/stage-7.1.md). `scripts/aws.sh release` puts them into S3 and a GitHub release.
//
//   node scripts/release-notes.mjs --from <sha> --to <sha> [--release <id>] [--images "web ..."]
//     # {"version": "v0.3.0", "notes": "## [0.3.0](...) (2026-10-22)\n..."}
//
// A breaking change bumps the major version, a feature the minor, anything else the patch: a
// deploy is never without a version. The previous version is the highest `v*` tag.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance'],
];

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** `type(scope)!: subject`; null for a subject that is not a conventional commit. */
export function parseCommit(subject, body = '') {
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject);
  if (!m) return null;
  return {
    type: m[1],
    scope: m[2] ?? null,
    subject: m[4].replace(/ \(#\d+\)$/, ''),
    breaking: m[3] === '!' || /^BREAKING[ -]CHANGE:/m.test(body),
  };
}

/** The highest `v<major>.<minor>.<patch>` tag, or null before the first. */
export function latestVersion(cwd = process.cwd()) {
  return (
    git(cwd, 'tag', '--list', 'v*', '--sort=-v:refname')
      .split('\n')
      .find((t) => /^v\d+\.\d+\.\d+$/.test(t)) ?? null
  );
}

export function nextVersion(previous, commits) {
  const [major, minor, patch] = (previous ?? 'v0.0.0').slice(1).split('.').map(Number);
  if (commits.some((c) => c.breaking)) return `v${major + 1}.0.0`;
  if (commits.some((c) => c.type === 'feat')) return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

/**
 * The commits in `from..to`, oldest first, merges left out: each with its pull request, from the
 * merge commit that brought it in or a squash subject ending in `(#<n>)`.
 */
export function commitsBetween(from, to, cwd = process.cwd()) {
  const range = from ? `${from}..${to}` : to;
  const log = git(cwd, 'log', '--reverse', '--format=%H%x1f%P%x1f%s%x1f%b%x1e', range);
  const entries = log
    .split('\x1e')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const [sha, parents, subject, body] = e.split('\x1f');
      return { sha, parents: parents.split(' '), subject, body: body ?? '' };
    });
  const pr = new Map();
  for (const merge of entries.filter((e) => e.parents.length > 1)) {
    const n = /^Merge pull request #(\d+)/.exec(merge.subject)?.[1];
    if (!n) continue;
    const [base, head] = merge.parents;
    for (const sha of git(cwd, 'rev-list', `${base}..${head}`).split('\n').filter(Boolean)) {
      pr.set(sha, Number(n));
    }
  }
  return entries
    .filter((e) => e.parents.length === 1)
    .map((e) => {
      const squash = / \(#(\d+)\)$/.exec(e.subject)?.[1];
      return {
        sha: e.sha,
        pr: pr.get(e.sha) ?? (squash ? Number(squash) : null),
        ...(parseCommit(e.subject, e.body) ?? {
          type: null,
          scope: null,
          subject: e.subject,
          breaking: false,
        }),
      };
    });
}

/** Markdown in the conventional-changelog layout, linked to the repository. */
export function renderNotes({ version, previous, date, repo, commits, first, release, images }) {
  const url = `https://github.com/${repo}`;
  const number = version.slice(1);
  const lines = [
    previous
      ? `## [${number}](${url}/compare/${previous}...${version}) (${date})`
      : `## ${number} (${date})`,
  ];
  // Under "Other changes" the type is not in the heading, so it stays in the label.
  const label = (c, withType) => {
    const name = withType && c.type ? `${c.type}${c.scope ? `(${c.scope})` : ''}` : c.scope;
    return name ? `**${name}:** ` : '';
  };
  const item = (c, withType = false) =>
    [
      '- ',
      label(c, withType),
      c.subject,
      c.pr ? ` ([#${c.pr}](${url}/pull/${c.pr}))` : '',
      ` ([${c.sha.slice(0, 7)}](${url}/commit/${c.sha}))`,
    ].join('');
  const section = (title, list) => {
    if (list.length > 0) lines.push('', `### ${title}`, '', ...list.map((c) => item(c)));
  };
  section(
    '⚠ Breaking Changes',
    commits.filter((c) => c.breaking),
  );
  for (const [type, title] of SECTIONS)
    section(
      title,
      commits.filter((c) => c.type === type),
    );
  const other = commits.filter((c) => !SECTIONS.some(([type]) => type === c.type));
  if (other.length > 0) {
    lines.push(
      '',
      `<details><summary>Other changes (${other.length})</summary>`,
      '',
      ...other.map((c) => item(c, true)),
      '',
      '</details>',
    );
  }
  if (first) lines.push('', 'The first recorded release.');
  else if (commits.length === 0) lines.push('', 'No new commits: the code of the current release.');
  lines.push('', '---', '');
  lines.push(`Images: ${images.length > 0 ? images.join(', ') : 'none changed'}`);
  if (release) lines.push(`Release: \`${release}\` (\`scripts/aws.sh rollback ${release}\`)`);
  return `${lines.join('\n')}\n`;
}

function repoOf(cwd) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  // `git@github.com:o/r.git`, an SSH host alias, or `https://github.com/o/r`.
  const origin = git(cwd, 'remote', 'get-url', 'origin').trim();
  return /([^/:]+\/[^/:]+?)(\.git)?$/.exec(origin)[1];
}

function main() {
  const { values } = parseArgs({
    options: {
      from: { type: 'string', default: '' },
      to: { type: 'string', default: 'HEAD' },
      release: { type: 'string' },
      images: { type: 'string', default: '' },
    },
  });
  const cwd = process.cwd();
  const commits = values.from ? commitsBetween(values.from, values.to, cwd) : [];
  const previous = latestVersion(cwd);
  const version = nextVersion(previous, commits);
  const notes = renderNotes({
    version,
    previous,
    date: new Date().toISOString().slice(0, 10),
    repo: repoOf(cwd),
    commits,
    first: !values.from,
    release: values.release,
    images: values.images.split(' ').filter(Boolean),
  });
  console.log(JSON.stringify({ version, notes }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
