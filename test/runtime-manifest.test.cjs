'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  APP_VERSION,
  REQUIRED_VISUAL_FILES,
  RUNTIME_FILES,
  isForbidden,
  productionPackageNames,
  validateSource
} = require('../common/runtime-manifest.cjs');

const root = path.join(__dirname, '..');

test('runtime allowlist contains only reviewed production resources', () => {
  assert.equal(new Set(RUNTIME_FILES).size, RUNTIME_FILES.length);
  assert.deepEqual(RUNTIME_FILES.filter(isForbidden), []);
  for (const file of REQUIRED_VISUAL_FILES) assert.ok(RUNTIME_FILES.includes(file), file);
  assert.equal(isForbidden('public/review-20260918.html'), true);
  assert.equal(isForbidden('public/ui-refinement-frame.html'), true);
  assert.equal(isForbidden('outputs/private.sqlite'), true);
  assert.equal(isForbidden('node_modules/js-yaml/dist/js-yaml.js'), false);
});

test('package metadata and runtime references agree with manifest', () => {
  const result = validateSource(root);
  assert.deepEqual(result.errors, []);
  assert.equal(require('../package.json').version, APP_VERSION);
});

test('production dependency closure includes streaming transitive packages', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const packages = productionPackageNames(lock);
  for (const name of ['sax', 'yauzl', 'pend', 'yazl', 'buffer-crc32']) assert.ok(packages.includes(name), name);
  assert.ok(packages.includes('electron-updater'));
  assert.ok(!packages.includes('electron-builder'));
});
