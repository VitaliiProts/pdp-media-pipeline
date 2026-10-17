import { readFileSync } from 'node:fs';

const toSeconds = (stamp) => {
  const [h, m, rest] = stamp.split(':');
  const [s, ms] = rest.split(',');
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
};

/** Cues as `{ id, start, end, text }`; lines in double quotes are on-screen captions, not speech. */
export function readSrt(path) {
  return readFileSync(path, 'utf8')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.trim().split('\n'))
    .filter((lines) => lines.length >= 3 && lines[1].includes('-->'))
    .map(([id, times, ...lines]) => {
      const [start, end] = times.split('-->').map((t) => toSeconds(t.trim()));
      const text = lines
        .filter((line) => !/^".*"$/.test(line.trim()))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { id: Number(id), start, end, text };
    })
    .filter((cue) => cue.text);
}

/** Cues that fall inside `[offset, offset + duration)`, shifted to clip time. */
export function clipCues(cues, offset, duration) {
  return cues
    .filter((c) => c.start >= offset && c.start < offset + duration)
    .map((c) => ({ ...c, start: c.start - offset, end: Math.min(c.end - offset, duration) }));
}
