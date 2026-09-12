const {readdirSync}=require('node:fs');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
let failed=false;
for(const dir of ['public','server','scripts','test'])for(const name of readdirSync(dir)){
  if(!/\.(js|cjs)$/.test(name))continue;
  const result=spawnSync(process.execPath,['--check',join(dir,name)],{stdio:'inherit'});
  if(result.status!==0)failed=true;
}
for(const file of ['desktop.cjs','preload.cjs','update-service.cjs','update-ipc.cjs','electron-builder.config.cjs']){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
if(!failed)console.log('JavaScript 语法检查通过');
