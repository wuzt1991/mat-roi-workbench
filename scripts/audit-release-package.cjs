'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  APP_VERSION,
  RUNTIME_FILES,
  assertSource,
  isForbidden,
  normalize,
} = require('../common/runtime-manifest.cjs');

function walk(directory, base = directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, base, result);
    else if (entry.isFile() || entry.isSymbolicLink()) result.push(normalize(path.relative(base, absolute)));
  }
  return result;
}

function locatePayload(artifact) {
  const absolute = path.resolve(artifact);
  if (!fs.existsSync(absolute)) throw new Error(`Artifact does not exist: ${absolute}`);
  if (fs.statSync(absolute).isFile()) {
    if (path.extname(absolute) !== '.asar') throw new Error('Pass an app.asar file or an unpacked application directory');
    return { type: 'asar', path: absolute };
  }
  const directAsar = [
    path.join(absolute, 'resources', 'app.asar'),
    path.join(absolute, 'Contents', 'Resources', 'app.asar')
  ].find(candidate => fs.existsSync(candidate));
  if (directAsar) return { type: 'asar', path: directAsar };
  const nestedAsar = walk(absolute).find(file => /(?:^|\/)resources\/app\.asar$/i.test(file));
  if (nestedAsar) return { type: 'asar', path: path.join(absolute, nestedAsar) };
  if (fs.existsSync(path.join(absolute, 'package.json'))) return { type: 'directory', path: absolute };
  throw new Error(`No packaged application payload found under ${absolute}`);
}

function readPayload(payload) {
  if (payload.type === 'directory') {
    return {
      files: walk(payload.path),
      read: file => fs.readFileSync(path.join(payload.path, file))
    };
  }
  const asar = require('@electron/asar');
  const entries = asar.listPackage(payload.path).map(listedPath => {
    const normalizedPath = normalize(listedPath);
    const nativePath = normalizedPath.split('/').join(path.sep);
    const leadingNativePath = `${path.sep}${nativePath}`;
    const candidates = process.platform === 'win32'
      ? [listedPath, leadingNativePath, nativePath, normalizedPath]
      : [normalizedPath, listedPath, nativePath];
    let lastError;
    for (const archivePath of [...new Set(candidates)]) {
      try {
        return { normalizedPath, archivePath, stat: asar.statFile(payload.path, archivePath) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }).filter(entry => !entry.stat.files);
  const files = entries.map(entry => entry.normalizedPath);
  const archivePaths = new Map(entries.map(entry => [entry.normalizedPath, entry.archivePath]));
  return {
    files,
    read: file => asar.extractFile(payload.path, archivePaths.get(normalize(file)) || file)
  };
}

function auditArtifact(artifact, { sourceRoot = path.join(__dirname, '..') } = {}) {
  assertSource(sourceRoot);
  const payloadLocation = locatePayload(artifact);
  const payload = readPayload(payloadLocation);
  const fileSet = new Set(payload.files);
  const expected = new Set(RUNTIME_FILES);
  const dependencySnapshot = JSON.parse(payload.read('common/runtime-dependencies.json').toString('utf8'));
  const packageJson = JSON.parse(payload.read('package.json').toString('utf8'));
  const allowedPackages = Object.keys(dependencySnapshot.packages).sort();
  const errors = [];
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));

  if (packageJson.version !== APP_VERSION) errors.push(`packaged version ${packageJson.version} != ${APP_VERSION}`);
  if (dependencySnapshot.appVersion !== APP_VERSION) errors.push(`packaged dependency snapshot ${dependencySnapshot.appVersion} != ${APP_VERSION}`);
  for (const field of ['name', 'productName', 'version', 'main', 'license']) {
    if (packageJson[field] !== sourcePackage[field]) errors.push(`packaged package.json field ${field} does not match source`);
  }
  if (JSON.stringify(packageJson.dependencies) !== JSON.stringify(sourcePackage.dependencies)) errors.push('packaged dependencies do not match source package.json');
  for (const file of RUNTIME_FILES) {
    if (!fileSet.has(file)) {
      errors.push(`packaged runtime file missing: ${file}`);
      continue;
    }
    if (file === 'package.json') continue;
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, file))).digest('hex');
    const packagedHash = crypto.createHash('sha256').update(payload.read(file)).digest('hex');
    if (sourceHash !== packagedHash) errors.push(`packaged runtime file differs from source: ${file}`);
  }
  for (const file of payload.files) {
    if (expected.has(file)) continue;
    if (file === 'node_modules/.package-lock.json' || file.startsWith('node_modules/.bin/')) continue;
    if (file.startsWith('node_modules/')) {
      const allowed = allowedPackages.some(name => file === `node_modules/${name}` || file.startsWith(`node_modules/${name}/`));
      if (!allowed) errors.push(`non-production dependency in package: ${file}`);
      continue;
    }
    if (isForbidden(file)) {
      errors.push(`forbidden packaged path: ${file}`);
      continue;
    }
    errors.push(`non-allowlisted application file in package: ${file}`);
  }
  const payloadBytes = payload.files.reduce((total, file) => {
    try { return total + payload.read(file).byteLength; } catch { return total; }
  }, 0);
  if (payloadBytes > 30 * 1024 * 1024) errors.push(`application payload ${payloadBytes} bytes exceeds 30 MiB budget`);
  for (const name of allowedPackages) {
    const packagePath = `node_modules/${name}/package.json`;
    if (!fileSet.has(packagePath)) {
      errors.push(`production dependency missing from package: ${name}`);
      continue;
    }
    const dependency = JSON.parse(payload.read(packagePath).toString('utf8'));
    if (dependency.version !== dependencySnapshot.packages[name].version) errors.push(`production dependency ${name} version ${dependency.version} does not match snapshot`);
    if (!dependency.license && !dependency.licenses) errors.push(`production dependency has no license metadata: ${name}`);
  }
  if (errors.length) throw new Error(`Release package audit failed:\n- ${errors.join('\n- ')}`);

  return {
    artifact: path.resolve(artifact),
    payload: payloadLocation.path,
    version: packageJson.version,
    files: payload.files.length,
    payloadBytes,
    productionPackages: allowedPackages
  };
}

function parseArtifact(argv) {
  const index = argv.indexOf('--artifact');
  return index >= 0 ? argv[index + 1] : null;
}

if (require.main === module) {
  try {
    const sourceRoot = path.join(__dirname, '..');
    const artifact = parseArtifact(process.argv.slice(2));
    if (!artifact) {
      assertSource(sourceRoot);
      console.log(`Runtime source manifest passed (${RUNTIME_FILES.length} application files, version ${APP_VERSION})`);
    } else {
      const report = auditArtifact(artifact, { sourceRoot });
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { auditArtifact, locatePayload, readPayload };
