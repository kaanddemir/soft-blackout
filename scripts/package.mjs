// Packages the verified dist/ into the Chrome Web Store upload ZIP: release/soft-blackout-<version>.zip.
// Run after `npm run build && npm run verify`. The ZIP is checked against the same allowlist as dist/.
// Entries are sorted and timestamps fixed so identical dist/ contents give an identical ZIP.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const files = [];
const walk = (directory) => { for (const name of readdirSync(directory).sort()) { const path = join(directory, name); if (statSync(path).isDirectory()) walk(path); else files.push(relative(dist, path)); } };
walk(dist);
const fixed = new Date('2026-01-01T00:00:00Z');
for (const file of files) utimesSync(join(dist, file), fixed, fixed);
mkdirSync(join(root, 'release'), { recursive: true });
const zip = join(root, 'release', `soft-blackout-${version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-X', '-q', zip, ...files], { cwd: dist });
const listed = execFileSync('zipinfo', ['-1', zip]).toString().trim().split('\n').sort();
const expected = [...files].sort();
if (JSON.stringify(listed) !== JSON.stringify(expected)) { console.error('[package] ZIP contents differ from dist/'); process.exit(1); }
if (!listed.includes('manifest.json') || listed.some((file) => file.startsWith('/') || file.includes('..'))) { console.error('[package] manifest.json must be at the ZIP root'); process.exit(1); }
console.log(`[package] ${relative(root, zip)} (${listed.length} files)`);
