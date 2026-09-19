'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertSource } = require('../common/runtime-manifest.cjs');

const root = path.join(__dirname, '..');
let failed = false;

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (/\.(?:js|cjs)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

for (const directory of ['public', 'server', 'scripts', 'test', 'common']) {
  for (const file of walk(path.join(root, directory))) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
  }
}

for (const file of ['desktop.cjs', 'preload.cjs', 'update-service.cjs', 'update-ipc.cjs', 'electron-builder.config.cjs']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

try {
  assertSource(root);
} catch (error) {
  console.error(error.message || error);
  failed = true;
}

process.exitCode = failed ? 1 : 0;
if (!failed) console.log('JavaScript syntax and runtime manifest checks passed');
