'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
function check(root) {
  const acceptance = JSON.parse(fs.readFileSync(path.join(root, 'validation/release-acceptance.json')));
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'validation/candidate/sha256.json')));
  assert.equal(acceptance.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  assert.equal(acceptance.installerSha256, candidate.sha256, 'Manual evidence must match final installer');
  for (const key of ['windows8GiB', 'windowsOffice']) {
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
