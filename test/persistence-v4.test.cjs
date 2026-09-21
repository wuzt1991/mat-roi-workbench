'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('../server/store.cjs'),{createServer}=require('../server/index.cjs');
const M=require('../public/domain.js'),V3=require('../public/domain-v3.js');
const {SaveQueue}=require('../public/persistence.js');
const {SessionDrafts}=require('../public/session-draft.js');
const directory=()=>fs.mkdtempSync(path.join(os.tmpdir(),'mat-persistence-v4-'));
function fixture(t){const dir=directory();let store=new Store(dir);t.after(()=>{store?.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,get store(){return store;},reopen(){store.close();store=new Store(dir);return store;}};}
const mutationHeaders={'Content-Type':'application/json','X-Workbench':'1'};

test('first run is initialized once on server with stable workspace metadata',t=>{
  const f=fixture(t),first=f.store.read();assert.equal(first.state.version,4);assert.equal(first.revision,0);assert.equal(first.storageEpoch,0);assert.ok(first.workspaceId);
  const next=f.reopen().read();assert.deepEqual(next,first);const state=structuredClone(next.state);state.plans[0].name='已修改';const saved=f.store.write(state,0);assert.equal(saved.storageEpoch,0);assert.equal(saved.workspaceId,first.workspaceId);
});
test('v3 upgrade is a single transaction and preserves exact original text',t=>{
  const f=fixture(t),old=V3.seed(),raw=JSON.stringify(old,null,2);f.store.db.prepare('UPDATE workspace SET revision=7,data=? WHERE id=1').run(raw);
  const store=f.reopen(),result=store.read();assert.equal(result.revision,8);assert.equal(result.state.version,4);assert.deepEqual(result.state.records,old.records);assert.equal(store.backupRaw(store.backups().find(x=>x.reason==='schema-upgrade-original').id),raw);
  assert.equal(f.reopen().read().revision,8);
});
test('malformed JSON remains downloadable and explicit restore is atomic and idempotent',t=>{
  const f=fixture(t),original=f.store.read(),raw=' { invalid JSON \n';f.store.db.prepare('UPDATE workspace SET revision=9,data=? WHERE id=1').run(raw);const store=f.reopen();
  assert.throws(()=>store.read(),e=>e.code==='INVALID_JSON');assert.equal(store.recoveryStatus().revision,9);assert.equal(store.rawCurrent(),raw);
  assert.throws(()=>store.restore(original.state,8,'restore-a'),e=>e.status===409);assert.equal(store.rawCurrent(),raw);
  const result=store.restore(original.state,9,'restore-a');assert.equal(result.storageEpoch,1);assert.equal(result.revision,10);
  const count=store.backups().length;assert.equal(store.restore(original.state,9,'restore-a').replayed,true);assert.equal(store.backups().length,count);assert.equal(store.read().storageEpoch,1);
  const backup=store.backups().find(x=>x.reason==='before-recovery-original');assert.equal(store.backupRaw(backup.id),raw);
  const changed=structuredClone(original.state);changed.plans[0].name='后续编辑';store.write(changed,10);
  assert.throws(()=>store.restore(original.state,9,'restore-a'),e=>e.code==='RESTORE_REPLAY_CONFLICT');assert.equal(store.read().state.plans[0].name,'后续编辑');
});
test('future schema enters read-only recovery instead of guessed migration',t=>{
  const f=fixture(t),raw=JSON.stringify({version:99,plans:[]});f.store.db.prepare('UPDATE workspace SET data=? WHERE id=1').run(raw);const store=f.reopen();
  assert.equal(store.recoveryStatus().code,'FUTURE_SCHEMA');assert.equal(store.rawCurrent(),raw);assert.throws(()=>store.write(M.initialState(),0),e=>e.code==='FUTURE_SCHEMA');
});
test('restore failure rolls back raw data, checkpoint, receipt and epoch',t=>{
  const f=fixture(t),before=f.store.read(),backups=f.store.backups();
  f.store.db.exec("CREATE TRIGGER reject_write BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
  assert.throws(()=>f.store.restore(before.state,0,'disk-failure'));assert.deepEqual(f.store.read(),before);assert.deepEqual(f.store.backups(),backups);
  assert.equal(f.store.db.prepare('SELECT restore_receipt FROM workspace_meta').get().restore_receipt,null);
});
test('ordinary saves reject schema bypass and preserve frozen records after restore',t=>{
  const f=fixture(t),state=f.store.read().state;f.store.restore(state,0,'seed-records');
  assert.throws(()=>f.store.write(state,1,'migration'),e=>e.code==='INVALID_SAVE_REASON');assert.throws(()=>f.store.write(state,1,'restore'),e=>e.code==='INVALID_SAVE_REASON');assert.throws(()=>f.store.write(V3.seed(),1),e=>e.code==='SCHEMA_REFRESH_REQUIRED');
  assert.equal(f.store.read().revision,1);
});
test('HTTP recovery works with broken JSON; restore releases broker admission on failure',async t=>{
  const dir=directory();let before=0,after=0;const running=createServer({dataDir:dir,port:0,fileServiceFactory:()=>({handle:async()=>false,beforeRestore:async()=>{before++;},afterRestore:async()=>{after++;},canQuit:()=>true,close:()=>{}})}),url=await running.listen();
  t.after(async()=>{await running.close();fs.rmSync(dir,{recursive:true,force:true});});
  const state=running.store.read().state;running.store.db.prepare('UPDATE workspace SET data=? WHERE id=1').run('{bad');
  assert.equal((await fetch(url+'/api/state')).status,422);assert.equal(await(await fetch(url+'/api/recovery/current/raw')).text(),'{bad');assert.equal((await(await fetch(url+'/api/recovery/status')).json()).revision,0);
  const send=(body,route='/api/restore',method='POST')=>fetch(url+route,{method,headers:mutationHeaders,body:JSON.stringify(body)});
  assert.equal((await send({state,revision:0,reason:'migration'},'/api/state','PUT')).status,400);
  assert.equal((await send({state,expectedRevision:9,operationId:'api'})).status,409);assert.equal(after,1);
  const restored=await send({state,expectedRevision:0,operationId:'api'});assert.equal(restored.status,200);assert.equal((await restored.json()).storageEpoch,1);assert.equal(before,2);assert.equal(after,2);
  assert.equal((await send({state,revision:1,storageEpoch:0},'/api/state','PUT')).status,409);
});
test('queue reconciles a lost response before sending newer edits',async()=>{
  let database={state:{value:0},revision:0,workspaceId:'w',storageEpoch:0},calls=0;const sent=[];
  const queue=new SaveQueue({revision:0,workspaceId:'w',storageEpoch:0,delay:60000,read:async()=>structuredClone(database),send:async(state,revision)=>{calls++;sent.push(state.value);assert.equal(revision,database.revision);database={...database,state,revision:revision+1};if(calls===1)throw Error('response lost');return database;}});
  queue.enqueue({value:1});assert.equal(await queue.flush(),false);queue.enqueue({value:2});assert.equal(await queue.flush(),true);queue.dispose();assert.deepEqual(sent,[1,2]);assert.equal(queue.revision,2);
});
test('queue never overwrites another window during ambiguous response recovery',async()=>{
  const queue=new SaveQueue({delay:60000,read:async()=>({state:{value:3},revision:2}),send:async()=>{throw Error('offline');}});queue.enqueue({value:1});await queue.flush();queue.enqueue({value:2});assert.equal(await queue.flush(),false);assert.equal(queue.blocked,true);assert.equal(queue.pending.state.value,2);queue.dispose();
});
test('old queue responses cannot overwrite a new session and restore cannot leak into save',async()=>{
  let release;const queue=new SaveQueue({delay:60000,send:()=>new Promise(resolve=>release=resolve)});assert.throws(()=>queue.enqueue({},'restore'));queue.enqueue({value:1});const saving=queue.flush();await Promise.resolve();queue.dispose();release({revision:1});assert.equal(await saving,false);assert.equal(queue.revision,0);
});
test('cache failures preserve draft input and do not claim recoverability',async()=>{
  const drafts=new SessionDrafts({workspaceId:'w',storageEpoch:2,sessionId:'tab',indexedDB:null});await assert.rejects(drafts.save('material',{name:'未提交'},{}));assert.equal(drafts.status().preserved,false);assert.equal((await drafts.read('material')).value.name,'未提交');assert.match(drafts.exportJSON(),/未提交/);
  assert.equal((await drafts.read('material',{baseRevision:9})).stale,true);await drafts.close();
});
test('session draft metadata is bounded, explicit to reopen, and epoch fenced',async()=>{
  const first=new SessionDrafts({workspaceId:'w',storageEpoch:2,sessionId:'import-1',ownerToken:'owner-a',baseRevision:7,indexedDB:null});
  const saved=await first.saveSession({filename:'商品源.xlsx'});assert.deepEqual(saved,{...saved,key:saved.key,kind:'file-session'});assert.equal(saved.sessionId,'import-1');assert.equal(saved.ownerToken,'owner-a');assert.equal(saved.revision,7);assert.equal(saved.storageEpoch,2);
  const reopened=new SessionDrafts({workspaceId:'w',storageEpoch:2,sessionId:'import-1',ownerToken:'owner-b',indexedDB:null});assert.equal(await reopened.restoreSession(),null);
  await assert.rejects(reopened.restoreSession('import-1',{workspaceId:'w',storageEpoch:3}),e=>e.code==='WORKSPACE_EPOCH_CHANGED');
  await assert.rejects(first.saveSession({filename:'/tmp/secret.xlsx'}),/文件名无效/);
  const exported=JSON.parse(first.exportJSON());assert.equal(exported.version,2);assert.equal(exported.session.filename,'商品源.xlsx');
});
test('asynchronous draft clearing cannot erase edits typed while save acknowledgement waits',async()=>{
  let releaseWrite,cached;const queue=new SaveQueue({delay:60000,cache:{write:async value=>{if(value.state.value===1)await new Promise(resolve=>releaseWrite=resolve);cached=value;},clear:async()=>{cached=null;}},send:async(state,revision)=>({revision:revision+1})});
  queue.enqueue({value:1});const saving=queue.flush();await new Promise(resolve=>setImmediate(resolve));queue.enqueue({value:2});releaseWrite();await saving;queue.dispose();assert.equal(queue.revision,2);assert.equal(queue.pending,null);assert.equal(cached,null);
});

test('文件名尚未取得时先登记会话，上传后仍可恢复同一商品复核',async()=>{
  const drafts=new SessionDrafts({workspaceId:'w',storageEpoch:2,sessionId:'new-upload',ownerToken:'owner-a',indexedDB:null});
  await drafts.saveSession({filename:'',fileKind:'product'});
  await drafts.touchSession({filename:'新商品.xlsx',revision:3});
  const listed=await drafts.listSessions();assert.equal(listed.length,1);assert.equal(listed[0].fileKind,'product');
  const restored=await drafts.restoreSession('new-upload',{ownerToken:'owner-a'});
  assert.equal(restored.filename,'新商品.xlsx');assert.equal(restored.revision,3);assert.equal(restored.ownerToken,'owner-a');
  await assert.rejects(drafts.saveSession({filename:'../坏文件.xlsx'}),/文件名无效/);
});
