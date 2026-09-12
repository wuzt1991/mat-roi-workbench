const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const M=require('../public/domain.js');
const Legacy=require('../public/legacy-domain.js');
const {Store}=require('../server/store.cjs');
const {createServer}=require('../server/index.cjs');
const {SaveQueue}=require('../public/persistence.js');
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'mat-workbench-test-'));}
function cleanup(t,directory,close){t.after(async()=>{await close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});});}
function closeServer(server){return new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});}

test('展示保本 ROI 向上保留两位，不因四舍五入低估保本线',()=>{
  assert.equal(M.ceilRoi(2.5347942334),2.54);assert.equal(M.ceilRoi(2.53),2.53);assert.equal(M.ceilRoi(null),null);
  const s=M.seed(),r=M.calculate(s,s.plans[0]);assert.ok(M.ceilRoi(r.roi)>=r.roi);
});

test('改坏利润、单价、用料、厚度比例的历史备份均被拒绝',()=>{
  const M=Legacy;
  const state=M.seed(),p=state.plans[0];p.history.push(M.createRecord(state,p,'2026-09-08'));
  for(const change of [h=>h.profit=999999,h=>h.materialPrice=1,h=>h.items[0].material=0,h=>h.items[0].thicknessFactor=2,h=>h.items[0].billingArea=5,h=>h.items[0].share=150,h=>h.params.refund=101]){
    const invalid=structuredClone(state);change(invalid.plans[0].history.at(-1));assert.equal(M.validateBackup(invalid),false);
  }
  assert.ok(M.validateBackup(state));
});
test('无穷大、超大数与类型伪装无法生成可用盈亏',()=>{
  for(const bad of [1e308,Infinity,NaN,true,' ']){
    const s=M.seed();s.plans[0].params.actualRoi=bad;
    const r=M.calculate(s,s.plans[0]);assert.equal(r.valid,false);assert.equal(r.profit,null);
  }
});
test('作废不改变原始数值，原日期可重新记账',()=>{
  const M=Legacy;
  const s=M.seed(),p=s.plans[0],h=M.createRecord(s,p,'2026-09-08');p.history.push(h);
  h.voided=true;p.history.push(M.createRecord(s,p,'2026-09-08'));
  assert.ok(M.validateBackup(s));assert.equal(p.history.filter(h=>h.kind==='daily'&&!h.voided).length,1);
});
test('新工作区没有虚构销量、每日记录或预估利润',()=>{
  const s=M.initialState();assert.ok(M.validateBackup(s));assert.equal(s.plans.length,1);assert.equal(s.records.length,0);assert.equal(s.plans[0].items.length,0);assert.equal(M.calculate(s,s.plans[0]).profit,null);
});
test('SQLite 重启仍保留数据；旧版本、改账和坏数据不能覆盖',t=>{
  const dir=temp();let store=new Store(dir);cleanup(t,dir,()=>store.close());
  const s=M.seed(),p=s.plans[0];M.confirmRecord(s,{frame:M.makeFrame(s,p),date:'2026-09-08'});
  assert.equal(store.write(s,0).revision,1);store.close();store=new Store(dir);
  assert.deepEqual(store.read().state,s);
  const changed=structuredClone(s);changed.materials[0].price=20;
  assert.equal(store.write(changed,1).revision,2);
  assert.deepEqual(store.read().state.records,s.records);
  assert.throws(()=>store.write(s,1),e=>e.status===409);
  const dropped=structuredClone(changed);dropped.records=[];
  assert.throws(()=>store.write(dropped,2),e=>e.status===422);
  const broken=structuredClone(changed);broken.records.at(-1).result.profit=999999;
  assert.throws(()=>store.write(broken,2),e=>e.status===422);
  assert.equal(store.read().revision,2);
  const previous=store.backup(store.backups()[0].id);assert.deepEqual(previous,s);
  assert.equal(store.write(previous,2,'restore').revision,3);
  assert.deepEqual(store.read().state,s);
});
test('HTTP 保存、冲突、备份、来源限制与私有文件隔离',async t=>{
  const directory=temp(),running=createServer({dataDir:directory,port:0}),url=await running.listen();
  cleanup(t,directory,()=>closeServer(running.server));
  const headers={'Content-Type':'application/json','X-Workbench':'1'};
  assert.equal((await (await fetch(url+'/api/state')).json()).revision,0);
  const state=M.seed();let response=await fetch(url+'/api/state',{method:'PUT',headers,body:JSON.stringify({state,revision:0})});assert.equal(response.status,200);
  response=await fetch(url+'/api/state',{method:'PUT',headers,body:JSON.stringify({state,revision:0})});assert.equal(response.status,409);
  response=await fetch(url+'/api/state',{method:'PUT',headers:{...headers,Origin:'https://example.com'},body:JSON.stringify({state,revision:1})});assert.equal(response.status,403);
  const deniedHost=await new Promise((resolve,reject)=>require('node:http').get(url+'/api/state',{headers:{Host:'example.com'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(deniedHost,403);
  assert.equal((await fetch(url+'/server/store.cjs')).status,404);
  assert.equal((await fetch(url+'/../workbench.sqlite')).status,404);
  const backups=await (await fetch(url+'/api/backups')).json();assert.ok(backups.items.length);
  assert.deepEqual(await (await fetch(url+'/api/backups/'+backups.items[0].id)).json(),state);
  assert.match((await fetch(url+'/')).headers.get('content-security-policy'),/script-src 'self'/);
});
test('保存队列等待数据库确认，再清草稿；输入中途改变时保存最后一版',async()=>{
  const writes=[],statuses=[];let release;
  const q=new SaveQueue({delay:60000,cache:{write:x=>writes.push(structuredClone(x)),clear:()=>writes.push('clear')},status:s=>statuses.push(s),send:async(state,revision)=>{if(revision===0)await new Promise(r=>release=r);return{revision:revision+1};}});
  q.enqueue({value:1});const saving=q.flush();await Promise.resolve();q.enqueue({value:2});
  assert.equal(writes.includes('clear'),false);release();assert.equal(await saving,true);q.dispose();
  assert.equal(q.revision,2);assert.equal(q.pending,null);assert.equal(writes.at(-1),'clear');assert.equal(statuses.at(-1),'saved');
});
test('失败保存保留草稿并可重试；冲突不会自动覆盖',async()=>{
  let fail=true,calls=0;const q=new SaveQueue({delay:60000,send:async()=>{calls++;if(fail)throw new Error('offline');return{revision:1};}});
  q.enqueue({value:1});assert.equal(await q.flush(),false);assert.ok(q.pending);fail=false;assert.equal(await q.flush(),true);q.dispose();
  assert.equal(calls,2);
  const conflict=new SaveQueue({delay:60000,send:async()=>{const e=new Error('conflict');e.status=409;throw e;}});
  conflict.enqueue({value:1});await conflict.flush();assert.equal(conflict.blocked,true);assert.ok(conflict.pending);conflict.enqueue({value:2});assert.equal(await conflict.flush(),false);conflict.dispose();
});
