'use strict';

const CHANNELS = Object.freeze({
  check: 'updates:check',
  download: 'updates:download',
  quitAndInstall: 'updates:quit-and-install',
  status: 'updates:status'
});

function registerUpdateIpc({ ipcMain, service, getWindow, isTrustedSender }) {
  if (!ipcMain || !service) throw new TypeError('ipcMain and service are required');
  const trust = typeof isTrustedSender === 'function' ? isTrustedSender : () => false;
  const handlers = [
    [CHANNELS.check, async event => {
      if (!trust(event)) throw new Error('不允许的更新请求来源');
      return service.checkForUpdates();
    }],
    [CHANNELS.download, async event => {
      if (!trust(event)) throw new Error('不允许的更新请求来源');
      return service.downloadUpdate();
    }],
    [CHANNELS.quitAndInstall, async event => {
      if (!trust(event)) throw new Error('不允许的更新请求来源');
      if (!getWindow?.()) throw new Error('工作台窗口不可用');
      return service.quitAndInstall();
    }]
  ];
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler?.(channel);
  };
}

module.exports = { CHANNELS, registerUpdateIpc };
