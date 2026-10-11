// Soft Blackout build: src/ -> dist/ (load dist/ as the unpacked extension).
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const buildId = watch ? `${pkg.version}+dev.${Date.now().toString(36)}` : pkg.version;

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: watch ? 'linked' : false,
  minify: false,
  logLevel: 'info',
  legalComments: 'none',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
};

const entries = [
  { entryPoints: [join(src, 'content/index.ts')], outfile: join(dist, 'content/runtime.js'), format: 'iife' },
  { entryPoints: [join(src, 'ui/popup/popup.ts')], outfile: join(dist, 'popup/popup.js'), format: 'esm' },
];

async function copyStatic() {
  await mkdir(join(dist, 'content'), { recursive: true });
  await mkdir(join(dist, 'popup'), { recursive: true });
  await cp(join(src, 'content/styles.css'), join(dist, 'content/styles.css'));
  await cp(join(src, 'ui/popup/index.html'), join(dist, 'popup/index.html'));
  await cp(join(src, 'ui/popup/popup.css'), join(dist, 'popup/popup.css'));
  await mkdir(join(dist, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await cp(join(root, `icons/icon${size}.png`), join(dist, `icons/icon${size}.png`));
  }
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dist, 'BUILD_ID'), `${buildId}\n`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(entries.map((entry) => context({ ...common, ...entry })));
  await Promise.all(contexts.map((entry) => entry.watch()));
  console.log(`[build] watching (build ${buildId}); restart after editing static assets`);
} else {
  await Promise.all(entries.map((entry) => build({ ...common, ...entry })));
  console.log(`[build] done -> dist/ (build ${buildId})`);
}
