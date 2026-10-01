'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
function check(root) {
  const acceptance = JSON.parse(fs.readFileSync(path.join(root, 'validation/release-acceptance.json')));
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'validation/candidate/sha256.json')));
  assert.equal(acceptance.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  assert.equal(acceptance.installerSha256, candidate.sha256, 'Acceptance must match final installer');
  const manualChecks = ['windows8GiB', 'windowsOffice'];
  if (acceptance.releaseScope?.mode === 'github-windows-ci') {
    // This exception is bound to one release and its exact installer. The release
    // workflow still requires all four Windows jobs for the exact tagged commit.
    assert.equal(acceptance.version, '1.2.18', 'CI-only scope is approved only for 1.2.18');
    assert.equal(candidate.sha256, 'd7e123fbb58042e5fdfaedecf079ca803b5535a7186dff539f6381b0af3595af', 'CI-only scope is bound to the approved installer');
    const approvalPath = acceptance.releaseScope.approval;
    assert.match(approvalPath || '', /^validation\/acceptance\/[a-zA-Z0-9._-]+\.json$/, 'Release scope approval required');
    const approval = JSON.parse(fs.readFileSync(path.join(root, approvalPath)));
    assert.equal(approval.version, acceptance.version);
    assert.equal(approval.installerSha256, candidate.sha256);
    assert.equal(approval.authorizedBy, 'user');
    assert.equal(approval.decision, 'release-with-github-windows-ci');
    assert.ok(approval.checkedAt && approval.statement);
    assert.deepEqual(approval.notCovered, manualChecks);
    for (const key of manualChecks) {
      assert.equal(acceptance[key]?.passed, false, `Unperformed check must remain false: ${key}`);
      assert.equal(acceptance[key]?.evidence, null);
      assert.equal(acceptance[key]?.status, 'not-covered');
    }
    return { passed: true, version: acceptance.version, installerSha256: candidate.sha256, scope: 'github-windows-ci', notCovered: manualChecks };
  }
  assert.ok(!acceptance.releaseScope || acceptance.releaseScope.mode === 'manual', 'Unknown release acceptance scope');
  for (const key of manualChecks) {
    const item = acceptance[key];
    assert.equal(item?.passed, true, `Formal release acceptance remains pending: ${key}`);
    assert.ok(typeof item.evidence === 'string' && /^validation\/acceptance\/[a-zA-Z0-9._-]+\.json$/.test(item.evidence), `Missing evidence: ${key}`);
    const evidence = JSON.parse(fs.readFileSync(path.join(root, item.evidence)));
    assert.equal(evidence.passed, true); assert.equal(evidence.installerSha256, candidate.sha256);
    assert.equal(evidence.platform, 'win32'); assert.ok(evidence.checkedAt && evidence.method);
    if (key === 'windows8GiB') assert.ok(evidence.physicalMemoryGiB >= 7 && evidence.physicalMemoryGiB <= 8.5 && evidence.physicalDevice === true, '8 GiB physical Windows evidence required');
    if (key === 'windowsOffice') assert.ok(/Excel|WPS/.test(evidence.application) && evidence.manuallyOpened === true && evidence.noRepairDialog === true && evidence.valuesAndLayoutVerified === true, 'Windows Excel/WPS manual evidence required');
  }
  return { passed: true, version: acceptance.version, installerSha256: candidate.sha256 };
}
if (require.main === module) { try { console.log(JSON.stringify(check(path.resolve(__dirname, '../..')))); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { check };
