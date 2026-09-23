'use strict';

// One production feed for the installer and runtime; legacy GitHub environment
// variables must not silently change an installed client's update source.
const WINDOWS_UPDATE_URL='https://mat-roi-workbench-updates-2026.oss-cn-shanghai.aliyuncs.com/updates/windows/';
const updateConfig=()=>({provider:'generic',url:WINDOWS_UPDATE_URL});
module.exports={WINDOWS_UPDATE_URL,updateConfig};
