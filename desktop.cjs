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
let running,win,appUrl='',updateService,quitting=false,allowClose=false,checkingClose=false;
const brokerCanQuit=async()=>{
  try{if(running)return await running.canQuit();const status=await(await fetch(appUrl+'/api/file-jobs/status',{signal:AbortSignal.timeout(1500)})).json();return status.canQuit===true&&!status.busy&&!status.restoring;}catch{return false;}
};
const rendererCanQuitForUpdate=async()=>{
  if(!win||win.isDestroyed()||!await brokerCanQuit())return false;
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
    if(!info){running=createServer({dataDir,port});try{url=await running.listen();}catch(error){await running.close();running=null;throw Error(error.code==='EADDRINUSE'?'本机工作台端口被占用，请退出旧版工作台或本地预览后重试。':error.message);}}
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
    // Closing and updating read the same renderer and broker state. Unknown means unsafe.
    win.on('close',event=>{
      if(allowClose)return;
      event.preventDefault();if(checkingClose)return;checkingClose=true;
      (async()=>{
        try{
          await win.webContents.executeJavaScript("typeof window.__matPrepareClose==='function' ? window.__matPrepareClose() : undefined",true);
          if(await rendererCanQuitForUpdate()){allowClose=true;win.close();return;}
          const choice=await dialog.showMessageBox(win,{type:'warning',buttons:['继续处理','仍然关闭'],defaultId:0,cancelId:0,message:'还有未提交输入、未确认保存或正在进行的文件任务。',detail:'关闭会停止当前文件任务。仅已成功写入数据库或草稿存储的内容可以恢复；未保留的输入可能丢失。'});
          if(choice.response===1){allowClose=true;await running?.fileService?.close?.();win.destroy();}
        }catch(error){dialog.showErrorBox('暂时无法安全关闭','无法确认保存状态。请继续处理并导出未保存的输入后重试。');}
        finally{checkingClose=false;}
      })();
    });
    win.webContents.on('will-prevent-unload',event=>{
      if(allowClose){event.preventDefault();return;}
      const choice=dialog.showMessageBoxSync(win,{type:'warning',buttons:['继续处理','仍然关闭'],defaultId:0,cancelId:0,message:'还有内容尚未确认保存。',detail:'仅已成功保留的内容可以恢复，未保存的输入可能丢失。'});
      if(choice===1)event.preventDefault();
    });
    win.webContents.session.on('will-download',(_event,item)=>{
      item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),item.getFilename())});
    });
    await win.loadURL(url);
    updateService.start();
  }).catch(error=>{dialog.showErrorBox('工作台启动失败',error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',event=>{
    if(quitting)return;
    updateService?.dispose();
    if(!running){quitting=true;return;}
    // Wait for file children and SQLite handles before the process exits.
    event.preventDefault();
    running.close().then(()=>{quitting=true;app.quit();}).catch(error=>{dialog.showErrorBox('工作台暂未退出',error.message);});
  });
}
