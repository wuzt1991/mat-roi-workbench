'use strict';

const path = require('node:path');
const { APP_VERSION, assertSource, builderFilePatterns } = require('./common/runtime-manifest.cjs');
const { auditArtifact } = require('./scripts/audit-release-package.cjs');

const root = __dirname;
const owner = String(process.env.MAT_UPDATE_OWNER || process.env.GH_REPO_OWNER || '').trim();
const repo = String(process.env.MAT_UPDATE_REPO || process.env.GH_REPO_NAME || '').trim();

assertSource(root);

module.exports = {
  appId: 'local.mat.workbench',
  productName: '地垫工作台',
  executableName: '地垫工作台',
  directories: {
    output: 'dist-builder',
    buildResources: 'build'
  },
  files: builderFilePatterns(),
  extraMetadata: { version: APP_VERSION },
  asar: true,
  npmRebuild: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: path.join('build', 'app.ico'),
    artifactName: '${productName}-${version}-windows-${arch}.${ext}'
  },
  nsis: {
    include: path.join('build', 'installer.nsh'),
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo, private: false, releaseType: 'release' }] : [],
  afterPack: async context => {
    auditArtifact(context.appOutDir, { sourceRoot: root });
  }
};
