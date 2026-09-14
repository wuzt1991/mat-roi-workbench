'use strict';

const UPDATE_STATES = Object.freeze([
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'uptodate',
  'error'
]);

function errorMessage(error) {
  return '更新失败，请检查网络后重试；可继续使用当前版本。';
}

function percentValue(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
}

function normalizeStatus(state, patch = {}) {
  const normalizedState = UPDATE_STATES.includes(state) ? state : 'error';
  return Object.freeze({
    state: normalizedState,
    version: patch.version ? String(patch.version) : null,
    percent: patch.percent === null || patch.percent === undefined ? null : percentValue(patch.percent),
    message: patch.message ? String(patch.message) : ''
  });
}

function resolveUpdateConfig(env = process.env) {
  const owner = String(env.MAT_UPDATE_OWNER || env.GH_REPO_OWNER || '').trim();
  const repo = String(env.MAT_UPDATE_REPO || env.GH_REPO_NAME || '').trim();
  if (!owner || !repo) return null;
  return { provider: 'github', owner, repo, private: false };
}

class UpdateService {
  constructor({ updater, config = resolveUpdateConfig(), onStatus = () => {}, canQuit = () => false, enabled = true, logger = console } = {}) {
    this.updater = updater;
    this.config = config;
    this.onStatus = onStatus;
    this.canQuit = canQuit;
    this.enabled = enabled;
    this.logger = logger;
    this.status = normalizeStatus('idle');
    this.started = false;
    this.listeners = new Set();
    this.handlers = {
      checking: () => this.emit('checking', { message: '正在检查更新…' }),
      'update-available': info => this.emit('available', { version: info?.version, message: `发现新版本 v${info?.version || ''}`.trim() }),
      'update-not-available': info => this.emit('uptodate', { version: info?.version, message: '当前已是最新版' }),
      'download-progress': progress => this.emit('downloading', { version: this.status.version, percent: progress?.percent, message: `正在后台下载 ${percentValue(progress?.percent) ?? 0}%` }),
      'update-downloaded': info => this.emit('downloaded', { version: info?.version || this.status.version, percent: 100, message: '已下载，重启安装' }),
      error: error => { this.logger.warn?.('updater error', error); return this.emit('error', { message: errorMessage(error) }); }
    };
  }

  emit(state, patch = {}) {
    this.status = normalizeStatus(state, patch);
    try { this.onStatus(this.status); } catch (error) { this.logger.warn?.('update status callback failed', error); }
    for (const listener of this.listeners) {
      try { listener(this.status); } catch (error) { this.logger.warn?.('update listener failed', error); }
    }
    return this.status;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.started || !this.updater) return;
    this.started = true;
    for (const [event, handler] of Object.entries(this.handlers)) this.updater.on(event, handler);
    try {
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      if (this.enabled && this.config) this.updater.setFeedURL(this.config);
    } catch (error) {
      this.logger.warn?.('update provider configuration failed', error);
      this.emit('error', { message: errorMessage(error) });
    }
  }

  async checkForUpdates() {
    if (!this.enabled) return this.emit('error', { message: '自动更新仅支持 Windows x64 桌面版' });
    if (!this.updater || typeof this.updater.checkForUpdates !== 'function') return this.emit('error', { message: '更新服务暂时不可用' });
    this.emit('checking', { message: '正在检查更新…' });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.logger.warn?.('update request failed', error);
      this.emit('error', { message: errorMessage(error) });
    }
    return this.status;
  }

  async downloadUpdate() {
    if (!this.enabled) return this.emit('error', { message: '自动更新仅支持 Windows x64 桌面版' });
    if (!this.updater || typeof this.updater.downloadUpdate !== 'function') return this.emit('error', { message: '更新服务暂时不可用' });
    if (this.status.state !== 'available') return this.status;
    this.emit('downloading', { version: this.status.version, percent: 0, message: '正在后台下载 0%' });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.logger.warn?.('update request failed', error);
      this.emit('error', { version: this.status.version, message: errorMessage(error) });
    }
    return this.status;
  }

  async quitAndInstall() {
    if (!this.enabled) throw new Error('自动更新仅支持 Windows x64 桌面版');
    if (this.status.state !== 'downloaded') throw new Error('请先下载更新');
    if (!(await this.canQuit())) throw new Error('请先完成保存后再重启安装');
    if (!this.updater || typeof this.updater.quitAndInstall !== 'function') throw new Error('更新服务暂时不可用');
    this.updater.quitAndInstall(false, true);
    return this.status;
  }

  dispose() {
    if (!this.updater || !this.started || typeof this.updater.removeListener !== 'function') return;
    for (const [event, handler] of Object.entries(this.handlers)) this.updater.removeListener(event, handler);
    this.started = false;
  }
}

module.exports = { UPDATE_STATES, UpdateService, errorMessage, normalizeStatus, percentValue, resolveUpdateConfig };
