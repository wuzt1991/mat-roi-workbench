'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_VERSION = '1.2.7';

// This is the only application-file allowlist used by both supported packagers.
// Keep entries explicit: a newly added runtime module must be reviewed here before
// it can enter an installer.
const RUNTIME_FILES = Object.freeze([
  'package.json',
  'common/runtime-dependencies.json',
  'desktop.cjs',
  'preload.cjs',
  'update-service.cjs',
  'update-ipc.cjs',
  'common/runtime-manifest.cjs',
  'common/update-config.cjs',

  'server/index.cjs',
  'server/store.cjs',
  'server/file-service.cjs',
  'server/auxiliary-file-jobs.cjs',
  'server/sales-size-import.cjs',
  'server/file-job-broker.cjs',
  'server/file-job-child.cjs',
  'server/import-session-store.cjs',
  'server/xlsx-stream-reader.cjs',
  'server/product-stream-export.cjs',

  'public/index.html',
  'public/app.js',
  'public/domain.js',
  'public/domain-v3.js',
  'public/legacy-domain.js',
  'public/pricing-rules.js',
  'public/reusable-rules.js',
  'public/promotion-rules.js',
  'public/sales-import.js',
  'public/sales-import-ui.js',
  'public/sales-import-ui.css',
  'public/trends.js',
  'public/operating-records.js',
  'public/operating-records.css',
  'public/trends-v3.js',
  'public/transfer.js',
  'public/transfer-v3.js',
  'public/product-recognition.js',
  'public/product-transfer.js',
  'public/product-transfer-ui.js',
  'public/product-transfer-ui.css',
  'public/lattice-loader.js',
  'public/lattice-loader.css',
  'public/licenses/react-bits-lattice-loader.txt',
  'public/workbook.js',
  'public/workbook-v3.js',
  'public/persistence.js',
  'public/session-draft.js',
  'public/file-jobs.js',
  'public/scope-pickers.js',

  'public/styles.css',
  'public/revision.css',
  'public/workspace.css',
  'public/update.css',
  'public/responsive.css',
  'public/construction.css',

  'public/ui-appearance.js',
  'public/ui-refinement.css',
  'public/ui-material-studies.css',
  'public/ui-side-rays.js',
  'public/ui-material-studies.js',
  'public/ui-cursor-trails.css',
  'public/ui-cursor-trails.js',
  'public/ui-refinement-motion.js',
  'public/licenses/react-bits-side-rays.txt',

  'public/assets/InterVariable.woff2',
  'public/assets/LICENSE',
  'public/assets/app-icon.png',
  'public/assets/brand-mark.svg',
  'public/assets/exceljs.min.js',
  'public/assets/lucide.min.js',
  'public/assets/product-template.xlsx'
]);

const PRODUCTION_DEPENDENCIES = Object.freeze({
  'electron-updater': '6.6.2',
  sax: '1.6.1',
  yauzl: '3.4.0',
  yazl: '3.3.1'
});
const BUILD_INPUT_FILES = Object.freeze(['package-lock.json']);

const DYNAMIC_BROWSER_PATHS = new Set(['app-config.js']);
const REQUIRED_VISUAL_FILES = Object.freeze([
  'public/ui-appearance.js',
  'public/ui-refinement.css',
  'public/ui-material-studies.css',
  'public/ui-side-rays.js',
  'public/ui-material-studies.js',
  'public/ui-cursor-trails.css',
  'public/ui-cursor-trails.js',
  'public/ui-refinement-motion.js',
  'public/licenses/react-bits-side-rays.txt'
]);

const FORBIDDEN_PATH_PATTERNS = Object.freeze([
  /^public\/review-20260918(?:[-.\/]|$)/i,
  /^public\/thickness-review-20260918(?:[-.\/]|$)/i,
  /^public\/pricing-(?:prototype|inline-model|plan-model)(?:[-.\/]|$)/i,
  /^public\/large-import-prototype(?:[-.\/]|$)/i,
  /^public\/ui-refinement-(?:preview|frame|sandbox)(?:[-.\/]|$)/i,
  /^(?:docs|test|tests|outputs|dist|dist-builder|\.git|\.runtime-archives)(\/|$)/i,
  /^(?!node_modules\/)(?:.*\/)?(?:\.proto-[^/]*\.log|[^/]+\.(?:log|sqlite|sqlite3|db|db-wal|db-shm|xlsx~))$/i
]);

function normalize(relativePath) {
  return String(relativePath).replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isForbidden(relativePath) {
  const value = normalize(relativePath);
  return FORBIDDEN_PATH_PATTERNS.some(pattern => pattern.test(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function localRequires(file, root) {
  if (!/\.(?:c?js)$/.test(file)) return [];
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const matches = source.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g);
  const found = [];
  for (const match of matches) {
    const base = path.resolve(root, path.dirname(file), match[1]);
    const candidates = [base, `${base}.js`, `${base}.cjs`, path.join(base, 'index.js'), path.join(base, 'index.cjs')];
    const target = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (target) found.push(normalize(path.relative(root, target)));
  }
  return found;
}

function browserReferences(root) {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const references = [];
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const raw = match[1].split(/[?#]/, 1)[0];
    if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const clean = normalize(raw);
    if (DYNAMIC_BROWSER_PATHS.has(clean)) continue;
    references.push(`public/${clean}`);
  }
  return references;
}

function validateSource(rootDirectory, { allowMissing = [] } = {}) {
  const root = path.resolve(rootDirectory);
  const allowedMissing = new Set(allowMissing.map(normalize));
  const errors = [];
  const runtimeSet = new Set(RUNTIME_FILES);

  for (const file of RUNTIME_FILES) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) && !allowedMissing.has(file)) errors.push(`missing runtime file: ${file}`);
    if (isForbidden(file)) errors.push(`forbidden path in runtime allowlist: ${file}`);
  }
  for (const file of BUILD_INPUT_FILES) {
    if (!fs.existsSync(path.join(root, file))) errors.push(`missing build input: ${file}`);
  }

  for (const file of REQUIRED_VISUAL_FILES) {
    if (!runtimeSet.has(file)) errors.push(`approved visual resource is not allowlisted: ${file}`);
  }

  const packageFile = path.join(root, 'package.json');
  const lockFile = path.join(root, 'package-lock.json');
  if (fs.existsSync(packageFile) && fs.existsSync(lockFile)) {
    const packageJson = readJson(packageFile);
    const packageLock = readJson(lockFile);
    if (packageJson.version !== APP_VERSION) errors.push(`package.json version ${packageJson.version} != ${APP_VERSION}`);
    if (packageLock.version !== APP_VERSION) errors.push(`package-lock.json version ${packageLock.version} != ${APP_VERSION}`);
    if (packageLock.packages?.['']?.version !== APP_VERSION) errors.push(`package-lock root version ${packageLock.packages?.['']?.version} != ${APP_VERSION}`);
    for (const [name, expected] of Object.entries(PRODUCTION_DEPENDENCIES)) {
      if (packageJson.dependencies?.[name] !== expected) errors.push(`package dependency ${name} must be exactly ${expected}`);
      const locked = packageLock.packages?.[`node_modules/${name}`]?.version;
      if (locked !== expected) errors.push(`lock dependency ${name} ${locked || '(missing)'} != ${expected}`);
    }
    const snapshotFile = path.join(root, 'common/runtime-dependencies.json');
    if (fs.existsSync(snapshotFile)) {
      const snapshot = readJson(snapshotFile);
      const expectedPackages = Object.fromEntries(productionPackageNames(packageLock).map(name => {
        const dependency = packageLock.packages?.[`node_modules/${name}`] || {};
        return [name, { version: dependency.version, integrity: dependency.integrity || null, license: dependency.license || null }];
      }));
      if (snapshot.formatVersion !== 1) errors.push('runtime dependency snapshot format must be 1');
      if (snapshot.appVersion !== APP_VERSION) errors.push(`runtime dependency snapshot version ${snapshot.appVersion} != ${APP_VERSION}`);
      if (JSON.stringify(snapshot.roots) !== JSON.stringify(PRODUCTION_DEPENDENCIES)) errors.push('runtime dependency snapshot roots do not match package.json');
      if (JSON.stringify(snapshot.packages) !== JSON.stringify(expectedPackages)) errors.push('runtime dependency snapshot does not match package-lock.json');
    }
  }

  for (const file of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(root, file))) continue;
    for (const dependency of localRequires(file, root)) {
      if (!runtimeSet.has(dependency)) errors.push(`${file} requires non-allowlisted runtime file: ${dependency}`);
    }
  }

  if (fs.existsSync(path.join(root, 'public/index.html'))) {
    for (const reference of browserReferences(root)) {
      if (!runtimeSet.has(reference)) errors.push(`public/index.html references non-allowlisted file: ${reference}`);
      if (!fs.existsSync(path.join(root, reference)) && !allowedMissing.has(reference)) errors.push(`public/index.html references missing file: ${reference}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function assertSource(rootDirectory, options) {
  const result = validateSource(rootDirectory, options);
  if (!result.ok) throw new Error(`Runtime manifest validation failed:\n- ${result.errors.join('\n- ')}`);
  return result;
}

function builderFilePatterns() {
  return [...RUNTIME_FILES];
}

function productionPackageNames(lock) {
  const packages = lock?.packages || {};
  const names = new Set();
  const queue = Object.keys(PRODUCTION_DEPENDENCIES);
  while (queue.length) {
    const name = queue.shift();
    if (names.has(name)) continue;
    names.add(name);
    const entry = packages[`node_modules/${name}`];
    if (!entry) continue;
    for (const dependency of Object.keys(entry.dependencies || {})) queue.push(dependency);
    for (const dependency of Object.keys(entry.optionalDependencies || {})) queue.push(dependency);
  }
  return [...names].sort();
}

module.exports = {
  APP_VERSION,
  BUILD_INPUT_FILES,
  DYNAMIC_BROWSER_PATHS,
  FORBIDDEN_PATH_PATTERNS,
  PRODUCTION_DEPENDENCIES,
  REQUIRED_VISUAL_FILES,
  RUNTIME_FILES,
  assertSource,
  browserReferences,
  builderFilePatterns,
  isForbidden,
  normalize,
  productionPackageNames,
  validateSource
};
