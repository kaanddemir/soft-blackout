import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];
const fail = (message) => problems.push(message);

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('[verify] dist/manifest.json is missing. Run npm run build first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.version !== pkg.version) fail(`manifest ${manifest.version} does not match package ${pkg.version}`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) fail(`invalid manifest version ${JSON.stringify(manifest.version)}`);

const approvedPermissions = ['activeTab', 'scripting', 'storage'];
const actualPermissions = [...(manifest.permissions ?? [])].sort();
if (JSON.stringify(actualPermissions) !== JSON.stringify([...approvedPermissions].sort())) {
  fail(`permissions must be exactly ${approvedPermissions.join(', ')}; found ${actualPermissions.join(', ')}`);
}
if (manifest.minimum_chrome_version !== '116') fail(`minimum_chrome_version must be 116 (the esbuild target and the CSS Custom Highlight baseline); found ${manifest.minimum_chrome_version}`);
if (manifest.host_permissions?.length) fail('host_permissions must be absent or empty');
if (manifest.optional_host_permissions?.length) fail('optional_host_permissions must be absent or empty');
if (manifest.content_scripts?.length) fail('content_scripts must be absent; injection is user initiated');
if (manifest.background) fail('background must be absent; Soft Blackout has no service worker');

const referenced = [manifest.action?.default_popup, ...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {})].filter(Boolean);
for (const file of referenced) if (!existsSync(join(dist, file))) fail(`manifest reference is missing: ${file}`);

const files = [];
const walk = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(relative(dist, path));
  }
};
walk(dist);

const expected = [
  'BUILD_ID',
  'content/runtime.js', 'content/styles.css',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  'manifest.json', 'popup/index.html', 'popup/popup.css', 'popup/popup.js',
];
for (const file of expected) if (!files.includes(file)) fail(`required production file is missing: ${file}`);
// Each icon's PNG header must match its declared size (catches a wrong or stale render).
for (const size of [16, 32, 48, 128]) {
  const file = join(dist, `icons/icon${size}.png`);
  if (!existsSync(file)) continue;
  const png = readFileSync(file);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) fail(`icons/icon${size}.png is ${png.readUInt32BE(16)}×${png.readUInt32BE(20)}, expected ${size}×${size}`);
}
for (const file of files) if (!expected.includes(file)) fail(`unexpected production file: ${file}`);
for (const file of files) {
  if (file.endsWith('.map')) fail(`source map in production: ${file}`);
  if (/\.(?:ts|tsx)$/.test(file)) fail(`TypeScript source in production: ${file}`);
  if (/(?:^|\/)(?:tests?|fixtures?|node_modules)(?:\/|$)/i.test(file)) fail(`development artifact in production: ${file}`);
  if (/\.(?:js|html)$/.test(file)) {
    const source = readFileSync(join(dist, file), 'utf8');
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) fail(`dynamic code execution in ${file}`);
    if (/https?:\/\//.test(source) && file.endsWith('.js')) fail(`possible remote code or URL in JavaScript: ${file}`);
  }
}

if (problems.length) {
  console.error(`[verify] dist/ is NOT valid:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`[verify] dist/ OK (${files.length} files, MV3, permissions: ${actualPermissions.join(', ')})`);
