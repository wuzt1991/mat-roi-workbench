const test = require('node:test');
const assert = require('node:assert/strict');
const { runProcess } = require('../scripts/release-validation/run-installed.cjs');

test('installed validation waits for delayed child completion and forwards output', async () => {
  let output = '';
  const sink = { write: data => { output += data; } };
  await runProcess(process.execPath, ['-e', 'setTimeout(()=>console.log("completed"),100)'], { stdout: sink, stderr: sink });
  assert.match(output, /completed/);
});

test('installed validation reports the actual delayed failure exit and diagnostics', async () => {
  const sink = { write() {} };
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(()=>{console.error("fixture failed");process.exit(7)},100)'], { stdout: sink, stderr: sink }), /exited 7.*fixture failed/s);
});

test('installed validation rejects a missing executable and a timed out child', async () => {
  const sink = { write() {} };
  await assert.rejects(runProcess('mat-validation-missing-executable', [], { stdout: sink, stderr: sink }), { code: 'ENOENT' });
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdout: sink, stderr: sink, timeout: 150 }), /timed out/);
});
