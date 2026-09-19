'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {fork}=require('node:child_process');
const {once}=require('node:events');
const {createServer}=require('../server/index.cjs');

test('awaiting server shutdown waits for the file child to release SQLite before closing the workspace',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-shutdown-'));
  const entry=path.join(dir,'child.cjs');
  fs.writeFileSync(entry,`const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.argv[2]);db.exec('CREATE TABLE held(value TEXT)');
process.on('message',message=>{if(message==='release'){db.close();process.exit(0);}});
process.send('ready');`);
  const child=fork(entry,[path.join(dir,'child.sqlite')],{stdio:['ignore','ignore','ignore','ipc']});
  const childExited=once(child,'exit');
  let closeCalls=0,closed=false,startClose;
  const closeStarted=new Promise(resolve=>startClose=resolve);
  const running=createServer({dataDir:dir,port:0,fileServiceFactory:({store})=>({
    handle:async()=>false,
    close:async()=>{closeCalls++;startClose();await childExited;assert.ok(store.db);assert.equal(store.read().revision,0);}
  })});
  t.after(async()=>{
    if(child.connected)child.send('release');
    if(running.close)await running.close();
    else {if(running.server.listening)await new Promise(resolve=>running.server.close(resolve));await childExited;await new Promise(resolve=>setImmediate(resolve));}
    fs.rmSync(dir,{recursive:true,force:true});
  });
  assert.equal((await once(child,'message'))[0],'ready');
  await running.listen();
  // The legacy callback only observes HTTP closure, which previously raced SQLite cleanup.
  const closing=running.close?running.close():new Promise(resolve=>running.server.close(resolve));
  closing.then(()=>{closed=true;});
  await closeStarted;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,false,'shutdown must remain pending while the file child still owns SQLite');
  assert.equal(running.server.listening,false);
  assert.ok(running.store.db);
  assert.equal(running.close(),closing,'concurrent close callers share the same completion');
  child.send('release');
  await closing;
  assert.equal(closeCalls,1);
  assert.equal(running.store.db,null);
  fs.rmSync(dir,{recursive:true,force:true});
  assert.equal(fs.existsSync(dir),false);
});

test('shutdown before listen is idempotent and still releases the workspace after a synchronous cleanup failure',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-shutdown-error-'));
  let calls=0;
  const expected=new Error('file cleanup failed');
  const running=createServer({dataDir:dir,port:0,fileServiceFactory:()=>({close:()=>{calls++;throw expected;}})});
  t.after(()=>{running.store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const closing=running.close();
  assert.equal(running.close(),closing);
  await assert.rejects(closing,error=>error===expected);
  assert.equal(calls,1);
  assert.equal(running.store.db,null);
});

test('explicit shutdown also waits for cleanup started through the legacy HTTP close API',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-shutdown-legacy-'));
  let release,calls=0;
  const gate=new Promise(resolve=>release=resolve);
  const running=createServer({dataDir:dir,port:0,fileServiceFactory:()=>({close:()=>{calls++;return gate;}})});
  t.after(async()=>{release();if(running.close)await running.close();else {await gate;await new Promise(resolve=>setImmediate(resolve));}fs.rmSync(dir,{recursive:true,force:true});});
  await running.listen();
  await new Promise(resolve=>running.server.close(resolve));
  const closing=running.close();
  assert.ok(running.store.db);
  release();
  await closing;
  assert.equal(calls,1);
  assert.equal(running.store.db,null);
});

test('shutdown drains restore finalizers even after their HTTP response has finished',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-shutdown-restore-'));
  let release,calls=0;
  const gate=new Promise(resolve=>release=resolve);
  const running=createServer({dataDir:dir,port:0,fileServiceFactory:()=>({
    afterRestore:()=>gate,
    close:()=>{calls++;}
  })});
  t.after(async()=>{release();await running.close();fs.rmSync(dir,{recursive:true,force:true});});
  const url=await running.listen(),state=running.store.read().state;
  const response=await fetch(url+'/api/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1'},body:JSON.stringify({state,expectedRevision:0,operationId:'close-during-restore'})});
  assert.equal(response.status,200);await response.json();
  const closed=once(running.server,'close'),closing=running.close();
  await closed;
  assert.equal(calls,0);
  assert.ok(running.store.db);
  release();
  await closing;
  assert.equal(calls,1);
  assert.equal(running.store.db,null);
});
