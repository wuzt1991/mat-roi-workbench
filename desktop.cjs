'use strict';
const { app, BrowserWindow, dialog, shell, ipcMain }=require('electron');
const path=require('node:path');
const { createServer, defaultDirectory }=require('./server/index.cjs');
const {version,productName}=require('./package.json');
const { autoUpdater }=require('electron-updater');
const { UpdateService, resolveUpdateConfig }=require('./update-service.cjs');
const { registerUpdateIpc }=require('./update-ipc.cjs');
const dataDir=path.resolve(process.env.MAT_DATA_DIR||defaultDirectory());
// Preserve pre-rename window drafts and the single-instance lock across upgrades.
app.setPath('userData',process.env.MAT_DATA_DIR?path.join(dataDir,'desktop-profile'):path.join(app.getPath('appData'),'mat-roi-workbench'));
app.setName(productName);
if(process.platform==='win32')app.setAppUserModelId('local.mat.workbench');
let running,win,appUrl='',updateService,quitting=false;
const rendererCanQuitForUpdate=async()=>{
  if(!win||win.isDestroyed())return false;
  try{return await win.webContents.executeJavaScript("typeof window.__matUpdateCanQuit==='function' && window.__matUpdateCanQuit()===true",true);}catch{return false;}
};
const isTrustedUpdateSender=event=>{
  if(!win||event?.sender!==win.webContents)return false;
  const senderUrl=event.senderFrame?.url||event.sender.getURL?.()||'';
  return !!appUrl&&(senderUrl===appUrl||senderUrl.startsWith(appUrl+'/'));
};
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
  app.whenReady().then(async()=>{
    // A stable local origin lets desktop drafts survive relaunches.
    const port=Number(process.env.MAT_PORT||4173);let url=`http://127.0.0.1:${port}`,info;
    try{info=await (await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)})).json();}catch{}
    if(info&&(info.app!=='mat-roi-workbench'||info.version!==version||info.dataDir!==dataDir))throw Error('另一个版本或测试服务正在使用工作台端口。请退出旧版工作台后重新打开。');
    if(!info){running=createServer({dataDir,port});try{url=await running.listen();}catch(error){running.store.close();running=null;throw Error(error.code==='EADDRINUSE'?'本机工作台端口被占用，请退出旧版工作台或本地预览后重试。':error.message);}}
    appUrl=url;
    win=new BrowserWindow({width:1440,height:960,minWidth:1100,minHeight:740,title:productName,icon:path.join(__dirname,'public','assets','app-icon.png'),backgroundColor:'#f5f6f8',autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
    autoUpdater.autoDownload=false;
    autoUpdater.autoInstallOnAppQuit=false;
    updateService=new UpdateService({
      updater:autoUpdater,
      config:resolveUpdateConfig(),
      enabled:process.platform==='win32',
      canQuit:rendererCanQuitForUpdate,
      onStatus:status=>{if(win&&!win.isDestroyed())win.webContents.send('updates:status',status);}
    });
    registerUpdateIpc({ipcMain,service:updateService,getWindow:()=>win,isTrustedSender:isTrustedUpdateSender});
    win.webContents.setWindowOpenHandler(({url:target})=>{if(target.startsWith('https://'))shell.openExternal(target);return{action:'deny'};});
    win.webContents.on('will-navigate',(event,target)=>{if(!target.startsWith(url+'/'))event.preventDefault();});
    win.webContents.on('did-finish-load',()=>{if(updateService&&!win.isDestroyed())win.webContents.send('updates:status',updateService.status);});
    // Renderer keeps its per-window draft before a close; ask if the DB has not acknowledged it.
    win.webContents.on('will-prevent-unload',event=>{
      const choice=dialog.showMessageBoxSync(win,{type:'warning',buttons:['继续编辑','保留草稿并关闭'],defaultId:0,cancelId:0,message:'还有修改尚未存入数据库。',detail:'建议先继续编辑并重试保存。关闭后可从草稿恢复。'});
      if(choice===1)event.preventDefault();
    });
    win.webContents.session.on('will-download',(_event,item)=>{
      item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),item.getFilename())});
    });
    await win.loadURL(url);
    updateService.start();
  }).catch(error=>{dialog.showErrorBox('工作台启动失败',error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',()=>{if(quitting)return;quitting=true;updateService?.dispose();running?.server.close();});
}
