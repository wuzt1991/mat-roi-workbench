'use strict';

const path = require('node:path');
const owner = String(process.env.MAT_UPDATE_OWNER || process.env.GH_REPO_OWNER || '').trim();
const repo = String(process.env.MAT_UPDATE_REPO || process.env.GH_REPO_NAME || '').trim();

module.exports = {
  appId: 'local.mat.workbench',
  productName: '地垫工作台',
  executableName: '地垫工作台',
  directories: {
    output: 'dist-builder',
    buildResources: 'build'
  },
  files: [
    '**/*',
    '!test{,/**/*}',
    '!scripts{,/**/*}',
    '!docs{,/**/*}',
    '!dist{,/**/*}',
    '!dist-builder{,/**/*}',
    '!outputs{,/**/*}',
    '!build{,/**/*}',
    '!地垫工作台-*{,/**/*}'
  ],
  asar: true,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: path.join('build', 'app.ico'),
    artifactName: '${productName}-${version}-windows-${arch}.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo, private: false, releaseType: 'release' }] : []
};
