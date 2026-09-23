'use strict';

const path = require('node:path');
const { APP_VERSION, assertSource, builderFilePatterns } = require('./common/runtime-manifest.cjs');
const { auditArtifact } = require('./scripts/audit-release-package.cjs');

const root = __dirname;
const { updateConfig } = require('./common/update-config.cjs');

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
  publish: [updateConfig()],
  afterPack: async context => {
    auditArtifact(context.appOutDir, { sourceRoot: root });
  }
};
