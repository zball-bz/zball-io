#!/usr/bin/env node
// Engine vendoring: unpack the Typesetter rolling dist into vendor/typesetter.
//   node scripts/fetch-engine.mjs          → download the engine-dist release
//   node scripts/fetch-engine.mjs --local  → pack from ../Typesetter (dev)
import { rm, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'vendor/typesetter');
const local = process.argv.includes('--local');
await rm(vendor, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });

if (local) {
  const ts = join(root, '../Typesetter');
  execFileSync('node', [join(ts, 'tools/pack-dist.mjs')], { stdio: 'inherit' });
  execFileSync('tar', ['xzf', join(ts, 'dist/typesetter-dist.tgz'), '-C', vendor]);
} else {
  const url = 'https://github.com/zball-bz/Typesetter/releases/download/engine-dist/typesetter-dist.tgz';
  execFileSync('curl', ['-fsSL', url, '-o', join(root, 'vendor/dist.tgz')], { stdio: 'inherit' });
  execFileSync('tar', ['xzf', join(root, 'vendor/dist.tgz'), '-C', vendor]);
  await rm(join(root, 'vendor/dist.tgz'));
}
const { default: pkg } = await import(join(vendor, 'package.json'), { with: { type: 'json' } });
console.log('vendored @zball/typesetter', pkg.version, local ? '(local)' : '(release)');
