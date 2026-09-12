const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {version,productName}=require('../package.json');
(async()=>{
  const {packager}=await import('@electron/packager');
  for(const [platform,arch] of [['darwin','arm64'],['win32','x64']]){
    const result=await packager({
      dir:path.join(__dirname,'..'),out:path.join(__dirname,'..','dist',version),name:productName,executableName:productName,
      platform,arch,electronVersion:'42.6.1',icon:path.join(__dirname,'..','build',platform==='darwin'?'app.icns':'app.ico'),
      electronZipDir:process.env.MAT_ELECTRON_ZIPS||undefined,appBundleId:'local.mat.workbench',appVersion:version,
      overwrite:false,asar:false,prune:true,
      ignore:[/^\/build($|\/)/,/^\/dist($|\/)/,/^\/test($|\/)/,/^\/docs($|\/)/,/^\/scripts($|\/)/,/^\/\.runtime-archives($|\/)/,/^\/\.git/],
      win32metadata:{CompanyName:productName,FileDescription:productName,ProductName:productName},usageDescription:{}
    });
    if(platform==='darwin'&&process.platform==='darwin')execFileSync('codesign',['--force','--deep','--sign','-','--entitlements',path.join(__dirname,'..','desktop.entitlements.plist'),path.join(result[0],productName+'.app')],{stdio:'inherit'});
    console.log('已打包',result.join(', '));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
