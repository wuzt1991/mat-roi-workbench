const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const M=require('../public/domain.js');
const {Store}=require('../server/store.cjs');
const {CHANNELS,registerUpdateIpc}=require('../update-ipc.cjs');
const {UpdateService,resolveUpdateConfig}=require('../update-service.cjs');

class FakeUpdater extends EventEmitter {
  constructor(){super();this.checkCalls=0;this.downloadCalls=0;this.installCalls=0;}
  async checkForUpdates(){this.checkCalls++;}
  async downloadUpdate(){this.downloadCalls++;}
  quitAndInstall(){this.installCalls++;}
  setFeedURL(config){this.feedURL=config;}
}

test('更新事件标准化为 checking、available、uptodate、downloading、downloaded 和 error',async()=>{
  const updater=new FakeUpdater(),statuses=[];
  const service=new UpdateService({updater,config:{provider:'github',owner:'owner',repo:'repo',private:false},onStatus:s=>statuses.push(s)});
  service.start();assert.equal(updater.checkCalls,0);
  assert.deepEqual(updater.feedURL,{provider:'github',owner:'owner',repo:'repo',private:false});
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);
  await service.checkForUpdates();assert.equal(updater.checkCalls,1);assert.equal(statuses.at(-1).state,'checking');
  updater.emit('update-available',{version:'1.1.2'});assert.deepEqual(statuses.at(-1),{state:'available',version:'1.1.2',percent:null,message:'发现新版本 v1.1.2'});
  await service.downloadUpdate();assert.equal(updater.downloadCalls,1);
  updater.emit('download-progress',{percent:42.6});assert.deepEqual(statuses.at(-1),{state:'downloading',version:'1.1.2',percent:42.6,message:'正在后台下载 42.6%'});
  updater.emit('update-downloaded',{version:'1.1.2'});assert.deepEqual(statuses.at(-1),{state:'downloaded',version:'1.1.2',percent:100,message:'已下载，重启安装'});
  updater.emit('update-not-available',{version:'1.1.1'});assert.deepEqual(statuses.at(-1),{state:'uptodate',version:'1.1.1',percent:null,message:'当前已是最新版'});
  updater.emit('error',new Error('GitHub 不可用'));assert.deepEqual(statuses.at(-1),{state:'error',version:null,percent:null,message:'GitHub 不可用'});
  service.dispose();
});

test('更新 IPC 只接受可信窗口和固定动作',async()=>{
  const handlers=new Map(),ipcMain={handle:(channel,handler)=>handlers.set(channel,handler),removeHandler:channel=>handlers.delete(channel)};
  const calls=[];const service={checkForUpdates:async()=>{calls.push('check');return 'checking';},downloadUpdate:async()=>{calls.push('download');return 'downloading';},quitAndInstall:async()=>{calls.push('quit');return 'downloaded';}};
  const window={};const dispose=registerUpdateIpc({ipcMain,service,getWindow:()=>window,isTrustedSender:event=>event.allowed===true});
  await assert.rejects(handlers.get(CHANNELS.check)({allowed:false}),/不允许的更新请求来源/);
  assert.equal(await handlers.get(CHANNELS.check)({allowed:true}), 'checking');
  assert.equal(await handlers.get(CHANNELS.download)({allowed:true}), 'downloading');
  assert.equal(await handlers.get(CHANNELS.quitAndInstall)({allowed:true}), 'downloaded');
  assert.deepEqual(calls,['check','download','quit']);dispose();assert.equal(handlers.size,0);
});

test('未保存修改阻止重启安装，保存完成后允许',async()=>{
  const updater=new FakeUpdater(),canQuit=()=>false;
  const service=new UpdateService({updater,enabled:true,canQuit,config:{provider:'github',owner:'owner',repo:'repo'}});
  service.start();updater.emit('update-downloaded',{version:'1.1.2'});
  await assert.rejects(service.quitAndInstall(),/请先完成保存/);assert.equal(updater.installCalls,0);
  service.canQuit=()=>true;await service.quitAndInstall();assert.equal(updater.installCalls,1);
});

test('更新服务不改写 SQLite 数据目录和工作区文件',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-update-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),state=M.seed();store.write(state,0);store.close();
  const dbPath=path.join(dir,'workbench.sqlite'),before=fs.readFileSync(dbPath);
  const updater=new FakeUpdater(),service=new UpdateService({updater,config:null,canQuit:()=>true});service.start();updater.emit('update-downloaded',{version:'1.1.2'});await service.quitAndInstall();
  assert.equal(path.basename(dbPath),'workbench.sqlite');assert.deepEqual(fs.readFileSync(dbPath),before);
  const db=new DatabaseSync(dbPath);assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM workspace').get().data),state);db.close();
});

test('GitHub 更新源必须由环境变量提供，不生成虚构仓库',()=>{
  assert.equal(resolveUpdateConfig({}),null);
  assert.deepEqual(resolveUpdateConfig({MAT_UPDATE_OWNER:'acme',MAT_UPDATE_REPO:'workbench'}),{provider:'github',owner:'acme',repo:'workbench',private:false});
});
