'use strict';
// Runs only in a disposable Windows runner. Never points at a user's workspace.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
assert.equal(process.platform, 'win32', 'Upgrade validation only runs on Windows');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Upgrade validation requires GitHub Actions');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Upgrade validation requires a disposable GitHub-hosted runner');
assert.ok(process.env.RUNNER_TEMP && process.env.LOCALAPPDATA, 'Runner paths are required');
const root = path.resolve(process.env.RUNNER_TEMP, 'mat-upgrade-validation');
const artifacts = path.resolve(process.argv[2]);
const installDir = path.join(root, 'installed', 'mat-roi-workbench');
const dataDir = path.resolve(process.env.LOCALAPPDATA, 'MatROIWorkbench');
const executable = path.join(installDir, '地垫工作台.exe');
const base = 'http://127.0.0.1:4173';
const env = { ...process.env };
// NSIS relaunches through the Windows shell. Use production defaults instead of
// depending on inheritance of test-only process environment or command-line flags.
for (const key of Object.keys(env)) {
  if (/^(?:ELECTRON_RUN_AS_NODE|MAT_DATA_DIR|MAT_PORT|MAT_UPDATE_OWNER|MAT_UPDATE_REPO|GH_REPO_OWNER|GH_REPO_NAME)$/i.test(key)) delete env[key];
}
const report = { candidateRun: process.env.CANDIDATE_RUN, source: process.env.CANDIDATE_SHA, steps: [] };
let feed, socket;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(name, details = {}) { report.steps.push({ name, ...details }); console.log(JSON.stringify({ name, ...details })); }
function annotation(level, details) { console.log(`::${level}::` + JSON.stringify(details).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')); }
function samePath(left, right) { return typeof left === 'string' && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase(); }
function powershell(command) {
  const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' + command;
  return spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 });
}
function inspectWindowsRuntime() {
  const target = executable.replaceAll("'", "''");
  const result = powershell(`$file = Get-Item -LiteralPath '${target}' -ErrorAction SilentlyContinue; $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(4173,4188,9225) } | Select-Object LocalAddress, LocalPort, OwningProcess); $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${target}' -or $_.Name -match '地垫|installer|setup|nsis' -or $_.CommandLine -match '--updated|mat-upgrade-validation' -or $_.ProcessId -in $listeners.OwningProcess } | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine); [pscustomobject]@{ executable = [pscustomobject]@{ path = '${target}'; exists = [bool]$file; productVersion = $file.VersionInfo.ProductVersion; fileVersion = $file.VersionInfo.FileVersion }; processes = $processes; listeners = $listeners } | ConvertTo-Json -Depth 5 -Compress`);
  if (result.error || result.status !== 0) throw Error(`Windows process inspection failed: ${result.error?.message || result.stderr || result.status}`);
  return JSON.parse(result.stdout.trim());
}
function assertRunningInstallation(health) {
  assert.equal(health.app, 'mat-roi-workbench');
  assert.ok(samePath(health.dataDir, dataDir), `Unexpected data directory: ${health.dataDir}`);
  const runtime = inspectWindowsRuntime();
  const owners = runtime.listeners.filter(item => item.LocalPort === 4173).map(item => item.OwningProcess);
  assert.ok(runtime.processes.some(item => owners.includes(item.ProcessId) && samePath(item.ExecutablePath, executable)), 'The health server must belong to the installed executable');
  return runtime;
}
function assertProductionFeed(config) {
  for (const [field, value] of Object.entries({ provider: 'github', owner: 'wuzt1991', repo: 'mat-roi-workbench' })) {
    assert.match(config, new RegExp(`^${field}:\\s*['\"]?${value}['\"]?\\s*$`, 'm'), `Unexpected production update ${field}`);
  }
}
async function until(check, label, timeout = 90000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch (error) { last = error; } await sleep(500); }
  throw Error(`${label} timed out${last ? ': ' + last.message : ''}`);
}
async function json(url, options) { const response = await fetch(url, { signal: AbortSignal.timeout(10000), ...options }); if (!response.ok) throw Error(`${url}: ${response.status} ${await response.text()}`); return response.json(); }
function stopApp() { powershell(`Get-Process | Where-Object { $_.Path -eq '${executable.replaceAll("'", "''")}' } | Stop-Process -Force -ErrorAction SilentlyContinue`); }
async function startApp(version) {
  const child = spawn(executable, ['--remote-debugging-port=9225'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const launch = { version, pid: child.pid, output: '' };
  (report.launches ||= []).push(launch);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { launch.output = (launch.output + data.toString('utf8')).slice(-24000); });
  child.on('exit', (code, signal) => { launch.exitCode = code; launch.signal = signal; });
  child.on('error', error => { report.launchError = error.message; });
  child.unref();
  const health = await until(async () => { const h = await json(base + '/api/health'); return h.version === version && h; }, `v${version} health`);
  assertRunningInstallation(health);
  return health;
}
async function stopForRelaunch() {
  stopApp();
  await until(async () => { try { await json(base + '/api/health', { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, 'previous application stopped', 15000);
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
  fs.mkdirSync(root, { recursive: true });
  // Never erase or overwrite a pre-existing workspace, even on a runner.
  assert.ok(!fs.existsSync(dataDir), `Default data directory already exists; refusing to change it: ${dataDir}`);
  const metadata = fs.readFileSync(path.join(artifacts, 'latest.yml'), 'utf8');
  const version = /^version:\s*(.+)$/m.exec(metadata)[1].trim();
  const file = /^path:\s*(.+)$/m.exec(metadata)[1].trim();
  const expected = /^sha512:\s*(.+)$/m.exec(metadata)[1].trim();
  assert.match(file, /^[a-zA-Z0-9.-]+\.exe$/);
  const installer = fs.readFileSync(path.join(artifacts, file));
  assert.equal(crypto.createHash('sha512').update(installer).digest('base64'), expected);
  report.installer = { file, size: installer.length, sha256: crypto.createHash('sha256').update(installer).digest('hex') };
  // The workflow installs the public baseline with the runner's native PowerShell host.
  stopApp();
  assert.ok(fs.existsSync(executable));
  const configPath = path.join(installDir, 'resources', 'app-update.yml');
  const productionConfig = fs.readFileSync(configPath, 'utf8');
  assertProductionFeed(productionConfig);
  // Only the disposable OLD installation's external feed is changed. ASAR and the candidate stay byte-identical.
  fs.writeFileSync(configPath, 'provider: generic\nurl: http://127.0.0.1:4199/\nupdaterCacheDirName: mat-upgrade-validation\n');
  const requests = [];
  feed = http.createServer((req, res) => { const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1); requests.push(name); if (!['latest.yml', file, file + '.blockmap'].includes(name)) { res.writeHead(404); return res.end(); } const input = path.join(artifacts, name); res.writeHead(200, { 'Content-Length': fs.statSync(input).size, 'Content-Type': 'application/octet-stream' }); fs.createReadStream(input).pipe(res); });
  await new Promise((resolve, reject) => { feed.once('error', reject); feed.listen(4199, '127.0.0.1', resolve); });
  await startApp('1.1.10');
  // v1.1.10 initializes its first workspace from the renderer after the HTTP server becomes healthy.
  const state = await until(async () => { const value = await json(base + '/api/state'); return value.state?.shops?.length > 0 && value; }, 'initial workspace saved');
  state.state.shops[0].name = 'CI-UPGRADE-DATA-PRESERVED';
  const saved = await json(base + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1', Origin: base }, body: JSON.stringify({ state: state.state, revision: state.revision, reason: 'save' }) });
  record('old-installed-and-saved', { version: '1.1.10', revision: saved.revision });
  // Relaunch ensures the renderer has the saved revision, with no injected bypass of the quit guard.
  await stopForRelaunch(); await startApp('1.1.10');
  const evaluate = await connectRenderer();
  await until(() => evaluate("typeof window.__matUpdateCanQuit === 'function' && window.__matUpdateCanQuit()"), 'saved renderer');
  const available = await evaluate('window.matUpdates.checkForUpdates()');
  assert.equal(available.state, 'available'); assert.equal(available.version, version);
  record('old-client-detects-candidate', available);
  const downloaded = await evaluate('window.matUpdates.downloadUpdate()');
  assert.equal(downloaded.state, 'downloaded'); assert.equal(downloaded.version, version);
  assert.ok(requests.includes(file));
  record('old-client-downloads-candidate', { version, sha512: expected, requests });
  // Invoke the unmodified v1.1.10 IPC method (quitAndInstall(false, true)).
  // The candidate installer handles its --updated flag, enters silent mode,
  // and honors --force-run. Do not inject candidate JS into the old client.
  report.installInvocation = { state: 'requested' };
  evaluate('window.matUpdates.quitAndInstall()').then(result => { report.installInvocation = { state: 'returned', result }; }).catch(error => { report.installInvocation = { state: 'renderer-disconnected-or-error', message: error.message }; console.log('Update IPC result:', error.message); });
  await sleep(3000);
  report.installRuntime = inspectWindowsRuntime();
  const upgraded = await until(async () => { const h = await json(base + '/api/health'); return h.version === version && h; }, 'updated application relaunch', 180000);
  // This assertion occurs before any manual launch of the new version.
  report.automaticRestart = assertRunningInstallation(upgraded);
  const after = await json(base + '/api/state');
  assert.equal(after.state.shops[0].name, 'CI-UPGRADE-DATA-PRESERVED');
  assert.equal(after.state.version, 4);
  assert.ok(after.revision >= saved.revision);
  const backups = await json(base + '/api/backups');
  assert.ok(backups.items.some(x => x.reason === 'schema-upgrade-original'));
  assertProductionFeed(fs.readFileSync(configPath, 'utf8'));
  record('production-restart-install-and-migration', { version: upgraded.version, dataDir: upgraded.dataDir, executable, schemaVersion: after.state.version, revision: after.revision, preservedShop: after.state.shops[0].name, originalCheckpoint: true, githubFeedRestored: true });
  socket?.close();
  // The genuine NSIS relaunch only passes --updated, not a DevTools port.
  // A separate, explicitly reported launch is used solely for renderer diagnostics.
  await stopForRelaunch();
  await startApp(version);
  record('diagnostic-relaunch-with-devtools', { version, executable, port: 9225, automaticRestartAlreadyVerified: true });
  const finalEval = await connectRenderer();
  await until(() => finalEval("typeof window.__matUpdateCanQuit === 'function' && window.__matUpdateCanQuit()"), 'updated renderer ready');
  record('updated-renderer', await finalEval("({version:WorkbenchConfig.version,dpr:devicePixelRatio,screen:[screen.width,screen.height],webgl:!!document.createElement('canvas').getContext('webgl2'),canQuit:window.__matUpdateCanQuit()})"));
  fs.writeFileSync(path.join(root, 'installed-path.txt'), installDir);
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  annotation('notice', { candidateRun: report.candidateRun, source: report.source, installer: report.installer, automaticRestart: true, schemaVersion: after.state.version, preservedShop: after.state.shops[0].name, originalCheckpoint: true, githubFeedRestored: true, renderer: report.steps.at(-1), wizard: report.wizard });
}
main().catch(async error => {
  report.error = error.stack;
  report.installedExists = fs.existsSync(executable);
  report.healthDiagnostics = await Promise.all([4173, 4188].map(async port => { try { return { port, health: await json(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) }) }; } catch (failure) { return { port, error: failure.message }; } }));
  try { report.runtimeDiagnostics = inspectWindowsRuntime(); } catch (failure) { report.runtimeDiagnostics = { error: failure.message }; }
  report.windowsDiagnostics = powershell("Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Where-Object { $_.ProviderName -match 'Application Error|Windows Error Reporting' } | Select-Object -First 3 | ForEach-Object { $_.Message }").stdout;
  fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.error(error);
  annotation('error', report); process.exitCode = 1;
}).finally(() => { socket?.close(); feed?.close(); stopApp(); });
