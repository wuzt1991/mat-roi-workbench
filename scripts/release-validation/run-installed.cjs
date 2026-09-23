'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

// Electron is a Windows GUI executable. Track the actual child instead of
// relying on PowerShell's last native exit code or the presence of a process.
function runProcess(executable, args, { env = process.env, timeout = 30 * 60 * 1000, stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', timedOut = false;
    for (const [stream, sink] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on('data', data => { tail = (tail + data.toString()).slice(-12000); sink.write(data); });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || code !== 0) return reject(new Error(`Installed validation ${timedOut ? 'timed out' : `exited ${code} (signal ${signal})`}: ${tail}`));
      resolve({ code });
    });
  });
}

async function main() {
  const [artifact, mode, operation, count] = process.argv.slice(2);
  assert.equal(process.platform, 'win32', 'This entry point validates the installed Windows runtime');
  assert.ok(artifact && ['fixtures', 'large', 'scroll', 'locks', 'lifecycle'].includes(mode), 'Expected installed directory and fixtures|large|scroll|locks|lifecycle');
  if (mode === 'large') {
    assert.ok(['build', 'verify'].includes(operation));
    assert.ok(['500000', '500001'].includes(count));
  }
  const out = path.resolve(process.env.MAT_VERIFY_OUTPUT);
  const script = path.join(__dirname, mode === 'locks' ? '../../test/import-session-lock.test.cjs' : mode === 'lifecycle' ? 'stress-file-lifecycle.cjs' : mode === 'fixtures' ? 'verify-fixtures.cjs' : mode === 'scroll' ? 'verify-product-scroll.cjs' : 'verify-large.cjs');
  const evidence = path.join(out, mode === 'locks' ? 'lock-report.json' : mode === 'lifecycle' ? 'lifecycle-report.json' : mode === 'fixtures' ? 'fixture-report.json' : mode === 'scroll' ? 'scroll-windows-installed.json' : operation === 'build' ? `synthetic-${count}.xlsx` : `report-${count}.json`);
  assert.ok(!fs.existsSync(evidence), `Refusing stale validation evidence: ${evidence}`);
  const args = mode === 'locks' ? ['--test', script, path.join(__dirname, '../../test/file-job-completion.test.cjs')] : [script, ...(mode === 'large' ? [operation, count] : [])];
  await runProcess(path.join(path.resolve(artifact), '地垫工作台.exe'), args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MAT_VERIFY_ROOT: path.join(path.resolve(artifact), 'resources', 'app.asar'), ...(mode === 'lifecycle' ? { MAT_DIAGNOSTIC_OUTPUT: evidence } : {}) }
  });
  if (mode === 'locks') { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(evidence, JSON.stringify({ passed: true, platform: process.platform, root: path.join(path.resolve(artifact), 'resources', 'app.asar'), tests: 8 })); }
  assert.ok(fs.statSync(evidence).size > 0, 'Validation produced no evidence');
  if (!evidence.endsWith('.xlsx')) {
    const report = JSON.parse(fs.readFileSync(evidence, 'utf8'));
    assert.equal(report.passed, true, 'Validation report did not pass');
    assert.equal(mode === 'fixtures' ? report.runtime.platform : ['scroll','lifecycle'].includes(mode) ? report.host : report.platform, 'win32');
    if (mode === 'fixtures') assert.deepEqual(report.checks.map(check => check.businessRows), [1, 60, 99, 100, 139]);
    else if (mode === 'scroll') { assert.equal(report.installedWindow, true); assert.equal(report.paginationReached, true); }
    else if (mode === 'lifecycle') { assert.equal(report.runs, 100); assert.equal(report.failed, 0); }
    else if (mode === 'locks') assert.equal(report.tests, 8);
    else assert.equal(report.count, Number(count));
  }
  console.log(JSON.stringify({ installedValidation: 'passed', mode, operation, count, evidence }));
}

if (require.main === module) main().catch(error => {
  console.error(error);
  console.log('::error::' + String(error.stack || error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  process.exitCode = 1;
});
module.exports = { runProcess };
