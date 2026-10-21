#!/usr/bin/env node
// Grafana graphs of the chaos runs for perf/reports/stage-6.md: the Jobs and API rows of the
// Overview dashboard over each run, from the start of the load to a minute after the queues
// drained, with the time the failure was active shaded.
//
//   GRAFANA_URL=http://grafana.pdp.localhost:19080 node scripts/chaos-graphs.mjs \
//     [--raw perf/reports/raw/stage-6] [--out perf/reports/stage-6]
//
// Takes the latest run of each scenario with a failure in its `timeline` (scripts/chaos.sh).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { latestRuns, parseTimeline } from './chaos-logs.mjs';

const DASHBOARD = 'd/pdp-overview/overview';
const PANELS = [
  'Throughput',
  'Error rate',
  'End-to-end latency',
  'Queue wait',
  'Gateway requests',
  'Gateway latency',
];
const AFTER_DRAIN_MS = 60_000;

/**
 * When the failure stopped: a one-shot experiment ends after its `spec.duration`, a `Schedule`
 * or an `openai-mock` fault lasts until scripts/chaos.sh removes it.
 */
export function faultEnd(timeline, manifest) {
  const off = Date.parse(timeline['fault-off']);
  const duration = manifest?.match(/^ {2}duration: (\d+)s$/m);
  if (!duration || /^kind: Schedule$/m.test(manifest)) return off;
  return Math.min(off, Date.parse(timeline['fault-on']) + Number(duration[1]) * 1000);
}

/** The run's time range and its failure as fractions of it. */
export function graphWindow(timeline, manifest) {
  const from = Date.parse(timeline.start);
  const to = Date.parse(timeline.end) + AFTER_DRAIN_MS;
  const at = (ms) => (ms - from) / (to - from);
  return {
    from,
    to,
    fault: [at(Date.parse(timeline['fault-on'])), at(faultEnd(timeline, manifest))],
  };
}

async function shoot(page, grafana, { from, to, fault }, path) {
  const url = `${grafana}/${DASHBOARD}?from=${from}&to=${to}&timezone=utc&theme=light&kiosk`;
  await page.goto(url, { waitUntil: 'networkidle' });
  const panels = PANELS.map((title) =>
    page.locator(`section[data-testid="data-testid Panel header ${title}"]`),
  );
  for (const panel of panels) {
    await panel.locator('.u-over').or(panel.getByText('No data')).first().waitFor();
  }
  // uPlot's overlay is exactly the plotting area, and its x axis is the dashboard range.
  await page.locator('.u-over').evaluateAll((overs, [start, end]) => {
    for (const over of overs) {
      const shade = over.ownerDocument.createElement('div');
      shade.style.cssText =
        `position:absolute;top:0;bottom:0;left:${100 * start}%;width:${100 * (end - start)}%;` +
        'background:rgba(220,38,38,0.1);border-inline:1px dashed rgba(220,38,38,0.6);' +
        'pointer-events:none';
      over.append(shade);
    }
  }, fault);
  const boxes = await Promise.all(panels.map((panel) => panel.boundingBox()));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const clip = {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
  await page.screenshot({ path, clip });
}

async function main() {
  const { values } = parseArgs({
    options: {
      raw: { type: 'string', default: 'perf/reports/raw/stage-6' },
      out: { type: 'string', default: 'perf/reports/stage-6' },
    },
  });
  const grafana = process.env.GRAFANA_URL ?? 'http://grafana.pdp.localhost:19080';
  const timelines = readdirSync(values.raw)
    .filter((name) => existsSync(join(values.raw, name, 'timeline')))
    .map((name) => ({
      name,
      timeline: parseTimeline(readFileSync(join(values.raw, name, 'timeline'), 'utf8')),
    }))
    .filter(({ timeline }) => timeline['fault-on'] && timeline['fault-off']);
  const byName = new Map(timelines.map((t) => [t.name, t.timeline]));
  mkdirSync(values.out, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 2400 },
      deviceScaleFactor: 1.5,
      reducedMotion: 'reduce',
    });
    for (const run of latestRuns([...byName.keys()])) {
      const scenario = run.replace(/-\d{8}-\d{6}$/, '');
      const manifest = join('deploy/chaos', `${scenario}.yaml`);
      const text = existsSync(manifest) ? readFileSync(manifest, 'utf8') : undefined;
      const path = join(values.out, `${scenario}.png`);
      await shoot(page, grafana, graphWindow(byName.get(run), text), path);
      console.log(path);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
