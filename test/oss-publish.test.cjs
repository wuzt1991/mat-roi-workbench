'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { publish, preflight, verifyPublic, parseMetadata } = require('../scripts/publish-oss-update.cjs');
const env = { OSS_ACCESS_KEY_ID: 'test-key', OSS_ACCESS_KEY_SECRET: 'test-secret' };
const digest = (b, a, e) => crypto.createHash(a).update(b).digest(e);
function bundle(version = '1.2.18') {
  const name = `mat-roi-workbench-setup-${version}.exe`, bytes = Buffer.from('verified-installer'), map = Buffer.from('verified-blockmap');
  const sha512 = digest(bytes, 'sha512', 'base64');
  const metadata = Buffer.from(`version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\n`);
  return { version, name, metadata, assets: [{ name, bytes }, { name: name + '.blockmap', bytes: map }] };
}
function mock({ current = '1.2.0', blocked = false, corruptHead = false, corruptDownload = false, existing = false } = {}) {
  const b = bundle(), objects = new Map([['latest.yml', bundle(current).metadata]]), calls = [];
  if (existing) for (const a of b.assets) objects.set(a.name, a.bytes);
  return { calls, objects, request: async (url, options = {}) => {
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1)), method = options.method || 'GET';
    const authenticated = Boolean(options.headers?.Authorization);
    calls.push({ method, name, authenticated, headers: options.headers });
    if (blocked) return new Response('<Error><Code>UserDisable</Code></Error>', { status: 403 });
    if (authenticated) {
      const headers = options.headers;
      const canonical = Object.keys(headers).filter(k => k.startsWith('x-oss-')).sort().map(k => k + ':' + headers[k] + '\n').join('');
      const message = [method, headers['Content-MD5'] || '', headers['Content-Type'] || '', headers.Date,
        canonical + '/mat-roi-workbench-updates-2026/updates/windows/' + name].join('\n');
      assert.equal(headers.Authorization, 'OSS test-key:' + crypto.createHmac('sha1', env.OSS_ACCESS_KEY_SECRET).update(message).digest('base64'));
    }
    if (method === 'PUT') {
      if (objects.has(name) && options.headers['x-oss-forbid-overwrite'] === 'true') return new Response('', { status: 409 });
      objects.set(name, options.body);
    }
    const bytes = objects.get(name);
    if (!bytes) return new Response('', { status: 404 });
    const body = corruptDownload && name.endsWith('.exe') && !authenticated ? Buffer.from('bad') : bytes;
    return new Response(method === 'HEAD' ? null : body, { status: 200, headers: {
      'content-length': String(bytes.length), etag: corruptHead ? 'bad' : digest(bytes, 'md5', 'hex'),
      'cache-control': name === 'latest.yml' ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable'
    } });
  } };
}
test('OSS publishes immutable verified assets before the public manifest and verifies all public bytes', async () => {
  const m = mock(), b = bundle(); const result = await publish(b, { env, request: m.request });
  assert.equal(result.published, true); assert.equal(result.anonymousDownloads, true);
  assert.deepEqual(m.calls.filter(x => x.method === 'PUT').map(x => x.name), [b.name, b.name + '.blockmap', 'latest.yml']);
  const manifestIndex = m.calls.findIndex(x => x.method === 'PUT' && x.name === 'latest.yml');
  for (const a of b.assets) assert.ok(m.calls.slice(0, manifestIndex).some(x => !x.authenticated && x.method === 'GET' && x.name === a.name));
  assert.equal(m.calls[manifestIndex].headers['Cache-Control'], 'no-cache, max-age=0');
});
test('OSS UserDisable and missing credentials prevent every upload', async () => {
  const m = mock({ blocked: true });
  await assert.rejects(publish(bundle(), { env, request: m.request }), /403 \/ UserDisable/);
  assert.ok(!m.calls.some(x => x.method === 'PUT'));
  await assert.rejects(publish(bundle(), { env: {}, request: m.request }), /credentials/);
});
test('OSS corruption fails before manifest publication', async () => {
  for (const options of [{ corruptHead: true }, { corruptDownload: true }]) {
    const m = mock(options);
    await assert.rejects(publish(bundle(), { env, request: m.request }), /checksum|size mismatch/);
    assert.ok(!m.calls.some(x => x.method === 'PUT' && x.name === 'latest.yml'));
  }
});
test('OSS refuses downgrades and a changed already-published version', async () => {
  const newer = mock({ current: '1.2.19' });
  await assert.rejects(preflight(bundle(), { request: newer.request }), /downgrade/);
  const same = mock({ current: '1.2.18' }); same.objects.set('latest.yml', Buffer.concat([bundle().metadata, Buffer.from('releaseDate: altered\n')]));
  await assert.rejects(preflight(bundle(), { request: same.request }), /different metadata/);
});
test('OSS existing immutable files are verified and never overwritten', async () => {
  const m = mock({ existing: true }), b = bundle();
  const result = await publish(b, { env, request: m.request, onlyAssets: true });
  assert.equal(result.published, false); assert.equal(result.assetsStaged, true);
  assert.ok(!m.calls.some(x => x.method === 'PUT'));
  m.objects.set(b.name, Buffer.from('different build'));
  await assert.rejects(publish(b, { env, request: m.request }), /size mismatch|checksum mismatch/);
  assert.ok(!m.calls.some(x => x.method === 'PUT'));
});
test('OSS final public verification detects manifest and installer corruption', async () => {
  const wrong = mock({ existing: true });
  await assert.rejects(verifyPublic(bundle(), { request: wrong.request }), /manifest mismatch/);
  const m = mock({ current: '1.2.18', existing: true, corruptDownload: true });
  await assert.rejects(verifyPublic(bundle(), { request: m.request }), /size mismatch|checksum mismatch/);
});
test('update metadata rejects a different per-file digest or unsafe installer name', () => {
  const b = bundle(); assert.equal(parseMetadata(b.metadata).version, b.version);
  assert.throws(() => parseMetadata(Buffer.from(b.metadata.toString().replace('    sha512: ', '    sha512: altered'))), /fields differ/);
  assert.throws(() => parseMetadata(Buffer.from(b.metadata.toString().replace('path: mat', 'path: ../mat'))), /filename/);
});
