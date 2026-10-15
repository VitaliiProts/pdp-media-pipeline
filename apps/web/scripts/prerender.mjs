// Last build step (ADR-015): writes the public pages into dist from the server bundle.
// dist/index.html is the prerendered `/`, so the untouched shell becomes dist/app.html,
// nginx's fallback for every route that is not prerendered.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(web, 'dist');
const ssr = join(web, 'dist-ssr');

const template = await readFile(join(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(join(dist, '.vite', 'manifest.json'), 'utf8'));
await writeFile(join(dist, 'app.html'), template);

const { prerender } = await import(pathToFileURL(join(ssr, 'entry-server.js')).href);
for (const { file, html } of await prerender(template, manifest)) {
  const target = join(dist, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
  console.log(`prerendered dist/${file}`);
}

// Build artifacts, not something nginx should serve.
await rm(join(dist, '.vite'), { recursive: true, force: true });
await rm(ssr, { recursive: true, force: true });
