'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { productName } = require('../package.json');
const { locatePayload } = require('./audit-release-package.cjs');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function findExecutable(artifact) {
  const root = path.resolve(artifact);
  const direct = process.platform === 'win32'
    ? path.join(root, `${productName}.exe`)
    : path.join(root, `${productName}.app`, 'Contents', 'MacOS', productName);
  if (fs.existsSync(direct)) return direct;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
    const candidate = path.join(root, entry.name, 'Contents', 'MacOS', path.basename(entry.name, '.app'));
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Packaged executable was not found under ${root}`);
}

const probe = String.raw`
const path = require('node:path');
const { fork } = require('node:child_process');
const appAsar = process.argv.at(-1);
const child = fork(path.join(appAsar, 'server/file-job-child.cjs'), [], {
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
const timer = setTimeout(() => { child.kill(); process.exit(2); }, 5000);
child.on('message', message => {
  clearTimeout(timer);
  child.kill();
  console.log(JSON.stringify(message));
  process.exit(message?.type === 'error' && message?.error?.code === 'UNKNOWN_FILE_JOB' ? 0 : 1);
});
child.send({ type: 'run', jobId: 'package-probe', jobType: 'package-probe', payload: {}, context: {} });
`;

try {
  const artifact = argument('--artifact');
  if (!artifact) throw new Error('Usage: node scripts/audit-packaged-child.cjs --artifact <unpacked-app-directory>');
  const executable = argument('--executable') || findExecutable(artifact);
  const payload = locatePayload(artifact);
  if (payload.type !== 'asar') throw new Error('Packaged child probe requires an app.asar payload');
  const result = spawnSync(executable, ['-e', probe, payload.path], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Packaged child probe exited ${result.status}: ${result.stderr || result.stdout}`);
  const message = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  if (message.error?.code !== 'UNKNOWN_FILE_JOB') throw new Error(`Unexpected child response: ${result.stdout}`);
  console.log(JSON.stringify({ executable, payload: payload.path, childProcess: 'passed', responseCode: message.error.code }, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
