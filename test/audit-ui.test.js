const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {appHarness}=require('./app-harness.cjs');
const M=require('../public/domain.js');
const {UpdateService}=require('../update-service.cjs');
const click=(dispatch,action)=>dispatch('click',{closest:()=>({dataset:{action}})});
test('P1 未修改弹窗直接关闭，修改后取消关闭保留输入，确认后关闭',()=>{
  let confirmations=0,accept=false;const {ui}=appHarness(undefined,{confirm:()=>{confirmations++;return accept;}});
  ui.open('shop',{draft:{name:'店'}});ui.close();assert.equal(confirmations,0);assert.equal(ui.modal,null);
  ui.open('shop',{draft:{name:'店'}});ui.modal.draft.name='新店';ui.close();assert.equal(confirmations,1);assert.equal(ui.modal.draft.name,'新店');accept=true;ui.close();assert.equal(confirmations,2);assert.equal(ui.modal,null);
});
test('P1 入账 pending 防双击，失败重试只保存同一记录',async()=>{
  const s=M.seed(),{ui,dispatch}=appHarness(s);let release,calls=0;ui.queue={enqueue(){},flush(){calls++;return new Promise(r=>release=r);}};
  ui.startEntry();const first=click(dispatch,'confirm-record');await Promise.resolve();const second=click(dispatch,'confirm-record');await Promise.resolve();
  assert.equal(calls,1);assert.equal(ui.modal.pending,true);const count=ui.state.records.length;release(false);await first;await second;
  assert.equal(ui.modal.pending,false);const retry=click(dispatch,'confirm-record');await Promise.resolve();assert.equal(calls,2);release(true);await retry;assert.equal(ui.state.records.length,count);assert.equal(ui.modal,null);
});
test('P1 恢复 pending 防双击，关闭在保存完成前被阻止',async()=>{
  const s=M.initialState(),{ui,dispatch}=appHarness(s);let release,calls=0;ui.queue={enqueue(){},flush(){calls++;return new Promise(r=>release=r);}};
  ui.open('restore',{data:M.clone(s)});const first=click(dispatch,'confirm-restore');await Promise.resolve();ui.close();assert.equal(ui.modal.pending,true);await click(dispatch,'confirm-restore');assert.equal(calls,1);release(true);await first;assert.equal(ui.modal,null);
});
test('P1 更新服务异常只对外显示可行动提示，原始信息留在日志',async()=>{
  const updater=new EventEmitter(),logs=[];updater.checkForUpdates=async()=>{throw Error('/Users/private/token-secret network failure');};
  const service=new UpdateService({updater,logger:{warn:(...args)=>logs.push(args)}});service.start();await service.checkForUpdates();
  assert.doesNotMatch(service.status.message,/private|token-secret/);assert.match(service.status.message,/重试/);assert.ok(logs.length);
  updater.emit('error',Error('secret-path'));assert.doesNotMatch(service.status.message,/secret-path/);
});
test('P1 macOS 更新入口禁用并说明限制，版本来自注入配置',()=>{
  const {ui,elements}=appHarness(undefined,{WorkbenchConfig:{version:'9.8.7',platform:'darwin',updatesSupported:false},matUpdates:{}});
  assert.match(ui.updateAction(),/disabled/);assert.match(ui.updateStatusText(),/Windows/);ui.render();assert.match(elements.get('#app').innerHTML,/9\.8\.7/);assert.doesNotMatch(elements.get('#app').innerHTML,/1\.1\.1/);
});
