'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BUILD_INPUT_FILES, RUNTIME_FILES, assertSource } = require('../common/runtime-manifest.cjs');
const { auditArtifact } = require('./audit-release-package.cjs');
const { version, productName } = require('../package.json');

const root = path.join(__dirname, '..');

function copyRuntime(stage) {
  for (const file of [...RUNTIME_FILES, ...BUILD_INPUT_FILES]) {
    const source = path.join(root, file);
    const destination = path.join(stage, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function main() {
  assertSource(root);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-roi-package-'));
  try {
    copyRuntime(stage);
    execFileSync(npmExecutable(), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: stage,
      stdio: 'inherit'
    });
    fs.rmSync(path.join(stage, 'package-lock.json'));

    const { packager } = await import('@electron/packager');
    for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64']]) {
      const result = await packager({
        dir: stage,
        out: path.join(root, 'dist', version),
        name: productName,
        executableName: productName,
        platform,
        arch,
        electronVersion: '42.6.1',
        icon: path.join(root, 'build', platform === 'darwin' ? 'app.icns' : 'app.ico'),
        electronZipDir: process.env.MAT_ELECTRON_ZIPS || undefined,
        appBundleId: 'local.mat.workbench',
        appVersion: version,
        overwrite: false,
        asar: true,
        prune: false,
        win32metadata: { CompanyName: productName, FileDescription: productName, ProductName: productName },
        usageDescription: {}
      });
      for (const artifact of result) {
        const report = auditArtifact(artifact, { sourceRoot: root });
        console.log(`Package audit passed: ${report.files} files, ${report.payloadBytes} payload bytes`);
      }
      if (platform === 'darwin' && process.platform === 'darwin') {
        execFileSync('codesign', [
          '--force', '--deep', '--sign', '-', '--entitlements',
          path.join(root, 'desktop.entitlements.plist'),
          path.join(result[0], `${productName}.app`)
        ], { stdio: 'inherit' });
      }
      console.log('Packaged', result.join(', '));
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
