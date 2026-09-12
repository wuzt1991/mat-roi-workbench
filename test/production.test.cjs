const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const M=require('../public/domain.js'),L=require('../public/legacy-domain.js'),T=require('../public/transfer.js');
const {Store}=require('../server/store.cjs'),{createServer}=require('../server/index.cjs');
const {SaveQueue}=require('../public/persistence.js');
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'mat-release-test-'));}
function cleanup(t,dir,close=()=>{}){t.after(async()=>{await close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});}
function closeServer(server){return new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});}
function seed(){const s=M.seed();s.records=[];return s;}
function entry(s,date='2026-09-01'){return M.confirmRecord(s,{frame:M.makeFrame(s,s.plans[0]),date});}
function legacyDB(dir,state){const store=new Store(dir);store.db.prepare('INSERT INTO workspace VALUES(1,7,?,?)').run(JSON.stringify(state),'2026-09-01T00:00:00Z');store.close();}

test('独立安装使用独立编号，两台新电脑的店铺可以合并而不会撞号',()=>{
  const a=M.initialState(),b=M.initialState();assert.ok(M.validateBackup(a));assert.ok(M.validateBackup(b));assert.notEqual(a.shops[0].id,b.shops[0].id);assert.notEqual(a.plans[0].id,b.plans[0].id);
  const result=T.merge(a,b);assert.equal(result.state.shops.length,2);assert.equal(result.state.plans.length,2);assert.equal(result.report.conflicts.length,0);assert.equal(a.materials[0].history[0].date,M.today());assert.equal(a.records.length,0);
});

test('旧数据库只迁移一次；更正和作废前原值保留，可取回完整旧备份',t=>{
  const dir=temp(),old=L.seed(),p=old.plans[0];let store;cleanup(t,dir,()=>store?.close());p.history.push(L.createRecord(old,p,'2026-09-01'));p.history.at(-1).voided=true;p.history.push(L.createRecord(old,p,'2026-09-01'));
  legacyDB(dir,old);store=new Store(dir);const result=store.read();assert.equal(result.revision,8);assert.equal(result.state.version,3);assert.equal(M.ledger(result.state).count,1);
  assert.deepEqual(store.backup(store.backups().find(x=>x.reason==='schema-upgrade-original').id),old);
  const before=JSON.stringify(result.state.records);result.state.materials[0].price=50;store.write(result.state,8);assert.equal(JSON.stringify(store.read().state.records),before);store.close();
  store=new Store(dir);assert.equal(store.read().revision,9);assert.equal(store.backups().filter(x=>x.reason==='schema-upgrade-original').length,1);
});
test('坏旧账升级失败后，SQLite 原始数据与版本号不变',t=>{
  const dir=temp(),old=L.seed(),p=old.plans[0];cleanup(t,dir);p.history.push(L.createRecord(old,p,'2026-09-01'));p.history.at(-1).profit=999999;legacyDB(dir,old);
  assert.throws(()=>new Store(dir));const db=new DatabaseSync(path.join(dir,'workbench.sqlite'));assert.equal(db.prepare('SELECT revision FROM workspace').get().revision,7);assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM workspace').get().data),old);db.close();
});
test('账目更正、作废和删除计划可保存；删账、改成本和复活旧版本被拒绝',t=>{
  const dir=temp(),store=new Store(dir);cleanup(t,dir,()=>store.close());const s=seed(),a=entry(s);store.write(s,0);
  const frame=M.clone(a.frame);frame.materials[0].price=12;const b=M.confirmRecord(s,{frame,date:a.date,previousId:a.id,reason:'实际批次价'});store.write(s,1);
  assert.equal(M.ledger(store.read().state).profit,b.result.profit);
  b.status='void';b.voidedAt=new Date().toISOString();s.plans[0].deleted=true;store.write(s,2);assert.equal(M.ledger(store.read().state).count,0);
  const resurrect=M.clone(s);resurrect.records.at(-1).status='confirmed';assert.throws(()=>store.write(resurrect,3),e=>e.status===422);
  const removed=M.clone(s);removed.records=[];assert.throws(()=>store.write(removed,3),e=>e.status===422);
  const rewritten=M.clone(s);rewritten.records[0].frame.materials[0].price=1;rewritten.records[0].result=M.summarize(M.calculate(rewritten.records[0].frame,rewritten.records[0].frame.plan));assert.ok(M.validateBackup(rewritten));assert.throws(()=>store.write(rewritten,3),e=>e.status===422);
});
test('普通编辑每个日期最多一个恢复点；滚动保留 30 个，导入前保留 10 个，账目不裁剪',t=>{
  let date='2026-07-01T12:00:00Z';const dir=temp(),store=new Store(dir,{now:()=>date});cleanup(t,dir,()=>store.close());const s=seed();entry(s);let revision=store.write(s,0).revision;
  for(let day=0;day<45;day++){date=new Date(Date.UTC(2026,6,1+day,12)).toISOString();for(let i=0;i<5;i++){s.plans[0].params.spend=day*100+i;revision=store.write(s,revision).revision;}}
  assert.equal(store.backups().filter(x=>x.reason==='daily-v3').length,30);assert.equal(store.read().state.records.length,1);
  for(let i=0;i<15;i++)revision=store.write(s,revision,'restore').revision;
  assert.equal(store.backups().filter(x=>x.reason==='before-restore-v3').length,10);assert.ok(store.backups().some(x=>x.reason==='initial-import'));assert.equal(store.read().state.records.length,1);
});
test('同范围更正链合并通过数据库保护，重复导入无重复账目',t=>{
  const dir=temp(),store=new Store(dir);cleanup(t,dir,()=>store.close());const local=seed(),a=entry(local);store.write(local,0);
  const remote=M.clone(local),frame=M.clone(a.frame);frame.plan.params.refund=12;M.confirmRecord(remote,{frame,date:a.date,previousId:a.id,reason:'退货率修正'});
  let merged=T.merge(local,remote).state;store.write(merged,1);merged=T.merge(merged,remote).state;store.write(merged,2);assert.equal(M.ledger(store.read().state).count,1);assert.equal(store.read().state.records.length,2);
});
test('孤立更正、循环更正、店铺错配和旧账金额伪装不允许恢复',()=>{
  const s=seed(),a=entry(s),b=M.confirmRecord(s,{frame:M.clone(a.frame),date:a.date,previousId:a.id,reason:'修正'});assert.ok(M.validateBackup(s));
  for(const edit of [x=>x.records[0].replacedBy='missing',x=>x.records[1].shopId=x.shops[1].id,x=>{x.records[0].previousId=b.id;x.records[1].status='superseded';x.records[1].replacedBy=a.id;}]){const invalid=M.clone(s);edit(invalid);assert.equal(M.validateBackup(invalid),false);}
  const old=L.seed();old.plans[0].history.push(L.createRecord(old,old.plans[0],'2026-09-01'));const migrated=M.migrate(old);migrated.records.find(h=>h.kind==='daily').result.price=999;assert.equal(M.validateBackup(migrated),false);
});
test('正式服务正确提供版本、字体、Excel 库；CSP 与无缓存生效',async t=>{
  const dir=temp(),running=createServer({dataDir:dir,port:0}),url=await running.listen();cleanup(t,dir,()=>closeServer(running.server));
  assert.equal((await(await fetch(url+'/api/health')).json()).version,require('../package.json').version);
  for(const file of ['assets/InterVariable.woff2','assets/exceljs.min.js','persistence.js','revision.css']){const r=await fetch(url+'/'+file);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');}
  assert.match((await fetch(url+'/assets/InterVariable.woff2')).headers.get('content-type'),/font\/woff2/);
  const html=await(await fetch(url)).text();assert.match(html,/persistence.js/);assert.doesNotMatch(html,/交互原型/);
});
test('导入后立即继续改数，队列保留恢复语义并最终写入最后一次输入',async()=>{
  let release;const writes=[];const q=new SaveQueue({delay:60000,send:async(state,revision,reason)=>{writes.push({state,reason});if(!revision)await new Promise(r=>release=r);return{revision:revision+1};}});
  q.enqueue({value:1},'restore');const promise=q.flush();await Promise.resolve();q.enqueue({value:2});release();assert.equal(await promise,true);q.dispose();assert.deepEqual(writes.map(x=>x.reason),['restore','restore']);assert.equal(writes.at(-1).state.value,2);
});
