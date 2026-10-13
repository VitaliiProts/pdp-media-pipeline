#!/usr/bin/env node
// Charts for perf/reports/stage-5.md from the samples of scripts/autoscale-demo.sh:
// replicas, consumer lag and per-job e2e latency over the run, with the demo's events marked.
//
//   node scripts/autoscale-report.mjs                     # perf/reports/raw → perf/reports/stage-5
//   node scripts/autoscale-report.mjs <raw dir> <out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [RAW = 'perf/reports/raw', OUT = 'perf/reports/stage-5'] = process.argv.slice(2);

const rows = (file) => {
  const [header, ...lines] = readFileSync(`${RAW}/${file}`, 'utf8').trim().split('\n');
  const keys = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? '']));
  });
};
const numeric = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v || 0)]));

const samples = rows('autoscale-samples.csv').map(numeric);
const allEvents = readFileSync(`${RAW}/autoscale-events.csv`, 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const [t, ...label] = line.split(',');
    return { t: Number(t), label: label.join(',') };
  });
const marks = allEvents.flatMap(({ t, label }) => {
  if (label.startsWith('load ends')) return [{ t, text: 'кінець' }];
  if (!label.startsWith('rollout restart')) return [];
  return [{ t, text: label.includes('interrupted') ? 'restart, 2 с' : 'restart' }];
});
const jobs = rows('autoscale-e2e.csv')
  .filter((j) => j.e2e_s !== '')
  .map((j) => ({ type: j.type, created: Number(j.created_s), e2e: Number(j.e2e_s) }));

const tEnd = Math.max(...samples.map((s) => s.t));

function niceMax(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

/** `ticks` horizontal grid lines; for counts pass `yMax` so that every tick is an integer. */
function chart({ title, yLabel, series, step = false, yMax, ticks = 4 }) {
  const W = 900;
  const H = 340;
  const L = 60;
  const R = 160;
  const T = 52;
  const B = 44;
  const top = yMax ?? niceMax(Math.max(1, ...series.flatMap((s) => s.points.map(([, v]) => v))));
  const x = (t) => Math.round((L + (t / tEnd) * (W - L - R)) * 10) / 10;
  const y = (v) => Math.round((T + (1 - v / top) * (H - T - B)) * 10) / 10;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${W}" height="${H}" fill="white"/>`,
    `<text x="${L}" y="20" font-size="14" font-weight="600">${title}</text>`,
    `<text x="14" y="${(T + H - B) / 2}" transform="rotate(-90 14 ${(T + H - B) / 2})" text-anchor="middle">${yLabel}</text>`,
  ];
  for (let i = 0; i <= ticks; i++) {
    const v = (top / ticks) * i;
    out.push(
      `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/>`,
      `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`,
    );
  }
  for (let m = 0; m * 60 <= tEnd; m += tEnd > 1200 ? 2 : 1) {
    out.push(`<text x="${x(m * 60)}" y="${H - B + 16}" text-anchor="middle">${m}</text>`);
  }
  out.push(
    `<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">хвилини від старту навантаження</text>`,
  );
  for (const m of marks) {
    out.push(
      `<line x1="${x(m.t)}" x2="${x(m.t)}" y1="${T}" y2="${H - B}" stroke="#9ca3af" stroke-dasharray="4 3"/>`,
      `<text x="${x(m.t)}" y="${T - 6}" text-anchor="middle" fill="#6b7280" font-size="11">${m.text}</text>`,
    );
  }
  series.forEach((s, i) => {
    if (s.dots) {
      for (const [t, v] of s.points) {
        out.push(
          `<circle cx="${x(t)}" cy="${y(v)}" r="2.5" fill="${s.color}" fill-opacity="0.7"/>`,
        );
      }
    } else {
      const pts = s.points.map(([t, v], j) => {
        const prev = s.points[j - 1];
        return step && prev ? `${x(t)},${y(prev[1])} ${x(t)},${y(v)}` : `${x(t)},${y(v)}`;
      });
      out.push(
        `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts.join(' ')}"/>`,
      );
    }
    out.push(
      `<rect x="${W - R + 14}" y="${T + i * 20}" width="14" height="${s.dots ? 8 : 3}" fill="${s.color}"/>`,
      `<text x="${W - R + 34}" y="${T + i * 20 + 7}">${s.name}</text>`,
    );
  });
  out.push('</svg>');
  return out.join('\n');
}

const pick = (key) => samples.map((s) => [s.t, s[key]]);
const sum = (...keys) => samples.map((s) => [s.t, keys.reduce((a, k) => a + s[k], 0)]);
const peak = (key) => Math.max(...samples.map((s) => s[key]));
const replicasMax = peak('video-transcode-ready') + 1;

mkdirSync(OUT, { recursive: true });
writeFileSync(
  `${OUT}/replicas.svg`,
  chart({
    title: 'Репліки (готові поди)',
    yLabel: 'подів',
    step: true,
    yMax: replicasMax,
    ticks: replicasMax,
    series: [
      { name: 'video-transcode', color: '#2563eb', points: pick('video-transcode-ready') },
      { name: 'video-frames', color: '#16a34a', points: pick('video-frames-ready') },
    ],
  }),
);
writeFileSync(
  `${OUT}/lag.svg`,
  chart({
    title: 'Лаг консюмерів: num_pending + num_ack_pending',
    yLabel: 'повідомлень',
    series: [
      {
        name: 'video-transcode-*',
        color: '#2563eb',
        points: sum('lag-video-transcode-priority', 'lag-video-transcode-cpu'),
      },
      { name: 'video-*', color: '#16a34a', points: sum('lag-video-priority', 'lag-video-cpu') },
    ],
  }),
);
writeFileSync(
  `${OUT}/e2e.svg`,
  chart({
    title: 'e2e latency кожної задачі (створення → завершення) за часом створення',
    yLabel: 'секунд',
    series: [
      {
        name: 'video.transcode',
        color: '#2563eb',
        dots: true,
        points: jobs.filter((j) => j.type === 'video.transcode').map((j) => [j.created, j.e2e]),
      },
      {
        name: 'video.frames',
        color: '#16a34a',
        dots: true,
        points: jobs.filter((j) => j.type === 'video.frames').map((j) => [j.created, j.e2e]),
      },
    ],
  }),
);

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}
const restartAt = marks[0]?.t ?? tEnd;
const e2e = (type, from, to) => {
  const values = jobs
    .filter((j) => j.type === type && j.created >= from && j.created < to)
    .map((j) => j.e2e);
  return values.length
    ? { jobs: values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95) }
    : null;
};
const first = (pred) => samples.find(pred)?.t;
console.log(
  JSON.stringify(
    {
      durationS: tEnd,
      transcodePeak: peak('video-transcode-ready'),
      framesPeak: peak('video-frames-ready'),
      transcodeAtPeakS: first((s) => s['video-transcode-ready'] === peak('video-transcode-ready')),
      framesAtPeakS: first((s) => s['video-frames-ready'] === peak('video-frames-ready')),
      maxTranscodeLag: Math.max(
        ...sum('lag-video-transcode-priority', 'lag-video-transcode-cpu').map(([, v]) => v),
      ),
      maxFramesLag: Math.max(...sum('lag-video-priority', 'lag-video-cpu').map(([, v]) => v)),
      e2e: Object.fromEntries(
        ['video.transcode', 'video.frames'].map((type) => [
          type,
          {
            all: e2e(type, 0, Infinity),
            beforeRestart: e2e(type, 0, restartAt),
            afterRestart: e2e(type, restartAt, Infinity),
          },
        ]),
      ),
      events: allEvents.map(({ t, label }) => `${t},${label}`),
    },
    null,
    2,
  ),
);
