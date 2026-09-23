'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BUILD_INPUT_FILES, RUNTIME_FILES, assertSource } = require('../common/runtime-manifest.cjs');
const { auditArtifact } = require('./audit-release-package.cjs');
const { version, productName, devDependencies } = require('../package.json');

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
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  for(let i=0;i<args.length;i+=2)if(!['--platform','--output'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Expected --platform darwin|win32 and/or --output DIRECTORY');
  const selected=value('--platform');
  if(selected&&!['darwin','win32'].includes(selected))throw new Error('--platform must be darwin or win32');
  const output=path.resolve(value('--output')||path.join(root,'dist',version));
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
      if(selected&&platform!==selected)continue;
      const result = await packager({
        dir: stage,
        out: output,
        name: productName,
        executableName: productName,
        platform,
        arch,
        electronVersion: devDependencies.electron,
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
