'use strict';
// Runs only in a disposable Windows runner. Never points at a user's workspace.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(process.env.RUNNER_TEMP, 'mat-upgrade-validation');
const artifacts = path.resolve(process.argv[2]);
const oldInstaller = path.resolve(process.argv[3]);
const installDir = path.join(root, 'installed');
const dataDir = path.join(root, 'data');
const executable = path.join(installDir, '地垫工作台.exe');
const base = 'http://127.0.0.1:4188';
const env = { ...process.env, MAT_DATA_DIR: dataDir, MAT_PORT: '4188' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MAT_UPDATE_OWNER;
delete env.MAT_UPDATE_REPO;
delete env.GH_REPO_OWNER;
delete env.GH_REPO_NAME;
const report = { candidateRun: process.env.CANDIDATE_RUN, source: process.env.CANDIDATE_SHA, steps: [] };
let feed, socket, wizard;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(name, details = {}) { report.steps.push({ name, ...details }); console.log(JSON.stringify({ name, ...details })); }
async function until(check, label, timeout = 90000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch (error) { last = error; } await sleep(500); }
  throw Error(`${label} timed out${last ? ': ' + last.message : ''}`);
}
async function json(url, options) { const response = await fetch(url, { signal: AbortSignal.timeout(10000), ...options }); if (!response.ok) throw Error(`${url}: ${response.status} ${await response.text()}`); return response.json(); }
async function run(file, args, timeout = 150000) {
  // NSIS is a GUI executable. Use the Windows shell launch path verified by the installer diagnostic.
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const command = `$taskProcess = Start-Process -FilePath ${quote(file)} -ArgumentList @(${args.map(quote).join(',')}) -Wait -PassThru; exit $taskProcess.ExitCode`;
  return new Promise((resolve, reject) => { const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { env, stdio: 'inherit' }); const timer = setTimeout(() => { child.kill(); reject(Error(`${file} timed out`)); }, timeout); child.on('error', reject); child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`${file} exited ${code}`)); }); });
}
function stopApp() { spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -eq '${executable.replaceAll("'", "''")}' } | Stop-Process -Force -ErrorAction SilentlyContinue`], { stdio: 'ignore' }); }
async function startApp(version) {
  spawn(executable, ['--remote-debugging-port=9225'], { env, stdio: 'ignore' }).unref();
  const health = await until(async () => { const h = await json(base + '/api/health'); return h.version === version && h; }, `v${version} health`);
  assert.equal(path.resolve(health.dataDir).toLowerCase(), dataDir.toLowerCase());
  return health;
}
async function connectRenderer() {
  const page = await until(async () => (await json('http://127.0.0.1:9225/json/list')).find(x => x.type === 'page' && x.url.startsWith(base)), 'renderer DevTools');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result); });
  socket.addEventListener('close', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Renderer disconnected')); } pending.clear(); });
  return async expression => { const requestId = ++id; const value = await new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Renderer expression timed out')); }, 180000); pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result?.value; };
}
async function main() {
  assert.equal(process.platform, 'win32'); assert.ok(process.env.RUNNER_TEMP);
  fs.mkdirSync(root, { recursive: true });
  const metadata = fs.readFileSync(path.join(artifacts, 'latest.yml'), 'utf8');
  const version = /^version:\s*(.+)$/m.exec(metadata)[1].trim();
  const file = /^path:\s*(.+)$/m.exec(metadata)[1].trim();
  const expected = /^sha512:\s*(.+)$/m.exec(metadata)[1].trim();
  assert.match(file, /^[a-zA-Z0-9.-]+\.exe$/);
  const installer = fs.readFileSync(path.join(artifacts, file));
  assert.equal(crypto.createHash('sha512').update(installer).digest('base64'), expected);
  report.installer = { file, size: installer.length, sha256: crypto.createHash('sha256').update(installer).digest('hex') };
  await run(oldInstaller, ['/S', '/D=' + installDir]);
  stopApp();
  assert.ok(fs.existsSync(executable));
  const configPath = path.join(installDir, 'resources', 'app-update.yml');
  const productionConfig = fs.readFileSync(configPath, 'utf8');
  assert.match(productionConfig, /provider: github/); assert.match(productionConfig, /repo: mat-roi-workbench/);
  // Only the disposable OLD installation's external feed is changed. ASAR and the candidate stay byte-identical.
  fs.writeFileSync(configPath, 'provider: generic\nurl: http://127.0.0.1:4199/\nupdaterCacheDirName: mat-upgrade-validation\n');
  const requests = [];
  feed = http.createServer((req, res) => { const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1); requests.push(name); if (!['latest.yml', file, file + '.blockmap'].includes(name)) { res.writeHead(404); return res.end(); } const input = path.join(artifacts, name); res.writeHead(200, { 'Content-Length': fs.statSync(input).size, 'Content-Type': 'application/octet-stream' }); fs.createReadStream(input).pipe(res); });
  await new Promise(resolve => feed.listen(4199, '127.0.0.1', resolve));
  await startApp('1.1.10');
  const state = await json(base + '/api/state');
  assert.ok(state.state?.shops?.length > 0);
  state.state.shops[0].name = 'CI-UPGRADE-DATA-PRESERVED';
  const saved = await json(base + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1', Origin: base }, body: JSON.stringify({ state: state.state, revision: state.revision, reason: 'save' }) });
  record('old-installed-and-saved', { version: '1.1.10', revision: saved.revision });
  // Relaunch ensures the renderer has the saved revision, with no injected bypass of the quit guard.
  stopApp(); await startApp('1.1.10');
  const evaluate = await connectRenderer();
  await until(() => evaluate("typeof window.__matUpdateCanQuit === 'function' && window.__matUpdateCanQuit()"), 'saved renderer');
  const available = await evaluate('window.matUpdates.checkForUpdates()');
  assert.equal(available.state, 'available'); assert.equal(available.version, version);
  record('old-client-detects-candidate', available);
  const downloaded = await evaluate('window.matUpdates.downloadUpdate()');
  assert.equal(downloaded.state, 'downloaded'); assert.equal(downloaded.version, version);
  assert.ok(requests.includes(file));
  record('old-client-downloads-candidate', { version, sha512: expected, requests });
  wizard = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'complete-test-installer.ps1')], { env, stdio: 'inherit' });
  // Invoke the exact production IPC method. The helper only operates the isolated NSIS wizard.
  evaluate('window.matUpdates.quitAndInstall()').catch(error => console.log('Renderer closed during update:', error.message));
  const upgraded = await until(async () => { const h = await json(base + '/api/health'); return h.version === version && h; }, 'updated application relaunch', 180000);
  const after = await json(base + '/api/state');
  assert.equal(after.state.shops[0].name, 'CI-UPGRADE-DATA-PRESERVED');
  assert.equal(after.state.version, 4);
  assert.ok(after.revision >= saved.revision);
  const backups = await json(base + '/api/backups');
  assert.ok(backups.items.some(x => x.reason === 'schema-upgrade-original'));
  assert.match(fs.readFileSync(configPath, 'utf8'), /provider: github/);
  record('production-restart-install-and-migration', { version: upgraded.version, schemaVersion: after.state.version, revision: after.revision, preservedShop: after.state.shops[0].name, originalCheckpoint: true, githubFeedRestored: true });
  socket?.close();
  const finalEval = await connectRenderer();
  await until(() => finalEval("typeof window.__matUpdateCanQuit === 'function' && window.__matUpdateCanQuit()"), 'updated renderer ready');
  record('updated-renderer', await finalEval("({version:WorkbenchConfig.version,dpr:devicePixelRatio,screen:[screen.width,screen.height],webgl:!!document.createElement('canvas').getContext('webgl2'),canQuit:window.__matUpdateCanQuit()})"));
  fs.writeFileSync(path.join(root, 'installed-path.txt'), installDir);
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
}
main().catch(error => {
  report.error = error.stack;
  report.installedExists = fs.existsSync(executable);
  report.windowsDiagnostics = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Where-Object { $_.ProviderName -match 'Application Error|Windows Error Reporting' } | Select-Object -First 3 | ForEach-Object { $_.Message }; Get-Process | Where-Object { $_.ProcessName -match '地垫|installer' } | Select-Object ProcessName,Path | Format-List"], { encoding: 'utf8', timeout: 15000 }).stdout;
  fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.error(error);
  console.log('::error::' + JSON.stringify(report).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')); process.exitCode = 1;
}).finally(() => { socket?.close(); feed?.close(); wizard?.kill(); stopApp(); });
