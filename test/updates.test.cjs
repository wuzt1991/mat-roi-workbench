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
  quitAndInstall(...args){this.installCalls++;this.installArgs=args;}
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
  updater.emit('error',new Error('GitHub 不可用'));assert.deepEqual(statuses.at(-1),{state:'error',version:null,percent:null,message:'更新失败，请检查网络后重试；可继续使用当前版本。'});
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
  service.canQuit=()=>true;await service.quitAndInstall();assert.equal(updater.installCalls,1);assert.deepEqual(updater.installArgs,[true,true]);
});

test('更新服务不改写 SQLite 数据目录和工作区文件',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-update-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const store=new Store(dir),state=M.seed();store.restore(state,0,'test-initial');store.close();
  const dbPath=path.join(dir,'workbench.sqlite'),before=fs.readFileSync(dbPath);
  const updater=new FakeUpdater(),service=new UpdateService({updater,config:null,canQuit:()=>true});service.start();updater.emit('update-downloaded',{version:'1.1.2'});await service.quitAndInstall();
  assert.equal(path.basename(dbPath),'workbench.sqlite');assert.deepEqual(fs.readFileSync(dbPath),before);
  const db=new DatabaseSync(dbPath);assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM workspace').get().data),state);db.close();
});

test('构建与运行时固定国内更新源，忽略旧 GitHub 环境变量，禁止降级',()=>{
 const expected={provider:'generic',url:'https://mat-roi-workbench-updates-2026.oss-cn-shanghai.aliyuncs.com/updates/windows/'};
 assert.deepEqual(resolveUpdateConfig({}),expected);
 assert.deepEqual(resolveUpdateConfig({MAT_UPDATE_OWNER:'acme',MAT_UPDATE_REPO:'workbench',MAT_UPDATE_URL:'https://example.com'}),expected);
 assert.deepEqual(require('../electron-builder.config.cjs').publish,[expected]);
 const updater=new FakeUpdater(),service=new UpdateService({updater});service.start();
 assert.deepEqual(updater.feedURL,expected);assert.equal(updater.allowDowngrade,false);
 assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);service.dispose();
});

test('断网、重置、附件缺失及校验失败显示可定位原因，并允许重试',async()=>{
 const updater=new FakeUpdater(),service=new UpdateService({updater,logger:{warn(){}}});service.start();
 for(const [code,message] of [['ERR_INTERNET_DISCONNECTED',/网络不可用/],['ECONNRESET',/连接中断/],['404',/暂未就绪/],['ERR_UPDATER_CHECKSUM_MISMATCH',/校验失败/]]){
   updater.emit('error',Object.assign(new Error(code),{code}));
   assert.equal(service.status.state,'error');assert.match(service.status.message,message);
   await service.checkForUpdates();assert.equal(service.status.state,'checking');
 }
 assert.equal(updater.installCalls,0);service.dispose();
});

test('正式界面保留更新服务已规范化的错误原因',()=>{
 const {appHarness}=require('./app-harness.cjs'),h=appHarness();
 h.ui.handleUpdateStatus({state:'error',message:'更新文件校验失败，请重新下载；当前版本可继续使用。'});
 assert.match(h.elements.get('#update-controls').innerHTML,/更新文件校验失败/);
 assert.match(h.elements.get('#toast').textContent,/更新文件校验失败/);
});
