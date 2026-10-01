'use strict';
// Credentials are CI-only. A verified manifest is the final commit point.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { WINDOWS_UPDATE_URL } = require('../common/update-config.cjs');
const hash = (data, algorithm, encoding) => crypto.createHash(algorithm).update(data).digest(encoding);
function parseMetadata(bytes) {
  const yaml = bytes.toString('utf8');
  const field = name => new RegExp('^' + name + ':\\s*(.+)$', 'm').exec(yaml)?.[1].trim().replace(/^['"]|['"]$/g, '');
  const version = field('version'), name = field('path'), sha512 = field('sha512');
  assert.match(version || '', /^\d+\.\d+\.\d+$/);
  assert.equal(name, `mat-roi-workbench-setup-${version}.exe`, 'Invalid installer filename');
  const listed = /^\s+- url:\s*(.+)$/m.exec(yaml)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  assert.equal(listed, name, 'Metadata URL mismatch');
  const fileHash = /^\s+sha512:\s*(.+)$/m.exec(yaml)?.[1]?.trim();
  assert.equal(fileHash, sha512, 'Duplicate SHA-512 fields differ');
  assert.match(sha512 || '', /^[A-Za-z0-9+/]{86}==$/, 'Invalid SHA-512');
  const size = Number(/^\s+size:\s*(\d+)$/m.exec(yaml)?.[1]);
  assert.ok(Number.isSafeInteger(size) && size > 0, 'Invalid installer size');
  return { version, name, sha512, size };
}
function inspect(directory) {
  const metadata = fs.readFileSync(path.join(directory, 'latest.yml'));
  const info = parseMetadata(metadata);
  const bytes = fs.readFileSync(path.join(directory, info.name));
  const blockmap = fs.readFileSync(path.join(directory, info.name + '.blockmap'));
  assert.equal(hash(bytes, 'sha512', 'base64'), info.sha512, 'Installer SHA-512 mismatch');
  assert.equal(bytes.length, info.size, 'Installer size mismatch');
  assert.ok(blockmap.length > 0, 'Missing blockmap');
  return { ...info, assets: [{ name: info.name, bytes }, { name: info.name + '.blockmap', bytes: blockmap }], metadata };
}
function compareVersions(left, right) {
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
async function publicRequest(name, request) {
  const response = await request(new URL(encodeURIComponent(name), WINDOWS_UPDATE_URL), {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(300000)
  });
  if (!response.ok) {
    const body = await response.text();
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] || '';
    throw Error(`Public update feed ${name} failed (${response.status}${code ? ' / ' + code : ''})`);
  }
  return response;
}
async function preflight(bundle, { request = fetch } = {}) {
  const current = Buffer.from(await (await publicRequest('latest.yml', request)).arrayBuffer());
  const info = parseMetadata(current);
  assert.ok(compareVersions(bundle.version, info.version) >= 0, 'Refusing update feed downgrade');
  if (bundle.version === info.version) assert.deepEqual(current, bundle.metadata, 'Version already published with different metadata');
  return { currentVersion: info.version, targetVersion: bundle.version, feedReadable: true };
}
async function verifyPublic(bundle, { request = fetch } = {}) {
  const response = await publicRequest('latest.yml', request);
  const remote = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(remote, bundle.metadata, 'Public manifest mismatch');
  assert.match(response.headers.get('cache-control') || '', /(?:no-cache|no-store|max-age=0)/, 'Public manifest must not be cached');
  return { ...await verifyPublicAssets(bundle, { request }), manifestVerified: true };
}
async function verifyPublicAssets(bundle, { request = fetch } = {}) {
  const assets = [];
  for (const asset of bundle.assets) {
    const result = await publicRequest(asset.name, request);
    const digest = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of result.body) { size += chunk.length; digest.update(chunk); }
    const sha256 = digest.digest('hex');
    assert.equal(size, asset.bytes.length, 'Public download size mismatch');
    assert.equal(sha256, hash(asset.bytes, 'sha256', 'hex'), 'Public download checksum mismatch');
    assets.push({ name: asset.name, bytes: size, sha256 });
  }
  return { version: bundle.version, verified: true, anonymousDownloads: true, assets };
}
async function publish(bundle, { env = process.env, request = fetch, onlyAssets = false } = {}) {
  const key = env.OSS_ACCESS_KEY_ID, secret = env.OSS_ACCESS_KEY_SECRET;
  if (!key || !secret) throw Error('OSS CI credentials are not configured');
  // A successful authenticated upload does not prove existing clients can read the feed.
  await preflight(bundle, { request });
  const base = new URL(WINDOWS_UPDATE_URL), bucket = base.hostname.split('.')[0];
  async function signed(method, name, bytes, extra = {}) {
    const date = new Date().toUTCString();
    const md5 = bytes ? hash(bytes, 'md5', 'base64') : '', type = bytes ? 'application/octet-stream' : '';
    const ossHeaders = {
      ...(env.OSS_SECURITY_TOKEN ? { 'x-oss-security-token': env.OSS_SECURITY_TOKEN } : {}),
      ...Object.fromEntries(Object.entries(extra).filter(([name]) => name.startsWith('x-oss-')))
    };
    const canonical = Object.keys(ossHeaders).sort().map(k => k + ':' + ossHeaders[k] + '\n').join('');
    const resource = '/' + bucket + base.pathname + name;
    const signature = crypto.createHmac('sha1', secret).update([method, md5, type, date, canonical + resource].join('\n')).digest('base64');
    const response = await request(new URL(encodeURIComponent(name), base), {
      method, headers: { Date: date, Authorization: 'OSS ' + key + ':' + signature, ...ossHeaders,
        ...(bytes ? { 'Content-MD5': md5, 'Content-Type': type } : {}), ...extra },
      body: bytes, signal: AbortSignal.timeout(300000)
    });
    if (!response.ok) {
      const body = await response.text();
      const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] || '';
      throw Error(`OSS ${method} ${name} failed (${response.status}${code ? ' / ' + code : ''})`);
    }
    return response;
  }
  for (const asset of bundle.assets) {
    const url = new URL(encodeURIComponent(asset.name), base);
    const existing = await request(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    if (existing.status === 404) {
      await signed('PUT', asset.name, asset.bytes, { 'Cache-Control': 'public, max-age=31536000, immutable', 'x-oss-forbid-overwrite': 'true' });
    } else if (!existing.ok) throw Error(`Cannot inspect existing update asset (${existing.status})`);
    const remote = await signed('HEAD', asset.name);
    assert.equal(Number(remote.headers.get('content-length')), asset.bytes.length, 'Uploaded size mismatch');
    assert.equal(remote.headers.get('etag')?.replace(/"/g, '').toLowerCase(), hash(asset.bytes, 'md5', 'hex'), 'Uploaded checksum mismatch');
    // Read anonymously before making an installer discoverable.
    const publicAsset = await publicRequest(asset.name, request);
    const digest = crypto.createHash('sha256'); let count = 0;
    for await (const chunk of publicAsset.body) { count += chunk.length; digest.update(chunk); }
    assert.equal(count, asset.bytes.length, 'Public asset size mismatch');
    assert.equal(digest.digest('hex'), hash(asset.bytes, 'sha256', 'hex'), 'Public asset checksum mismatch');
  }
  if (onlyAssets) return { version: bundle.version, assetsStaged: true, published: false };
  // Re-check immediately before the mutable manifest; prevent another release being downgraded.
  await preflight(bundle, { request });
  await signed('PUT', 'latest.yml', bundle.metadata, { 'Cache-Control': 'no-cache, max-age=0' });
  const verified = await verifyPublic(bundle, { request });
  return { ...verified, published: true, installer: bundle.name };
}
if (require.main === module) (async () => {
  const directory = process.argv.find((v, i) => i > 1 && !v.startsWith('--')) || 'candidate';
  const bundle = inspect(directory);
  const result = process.argv.includes('--publish') ? await publish(bundle)
    : process.argv.includes('--stage-assets') ? await publish(bundle, { onlyAssets: true })
    : process.argv.includes('--preflight') ? await preflight(bundle)
    : process.argv.includes('--verify-public') ? await verifyPublic(bundle)
    : process.argv.includes('--verify-assets') ? await verifyPublicAssets(bundle)
    : { verified: true, published: false, version: bundle.version, installer: bundle.name };
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect, parseMetadata, compareVersions, preflight, publish, verifyPublic, verifyPublicAssets };
