'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process'),{once}=require('node:events'),{DatabaseSync}=require('node:sqlite');
const root=process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'..');
const {ImportSessionStore}=require(path.join(root,'server/import-session-store.cjs'));
function directoryFor(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-lock-regression-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
async function holdLock(directory){
 const holder=fork(path.join(__dirname,'fixtures/sqlite-lock-holder.cjs'),[path.join(directory,'session.sqlite')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','inherit','ipc']});
 const exited=once(holder,'exit');await once(holder,'message');return {holder,exited};
}
test('opening a temporarily locked session waits and preserves existing data',async t=>{
 const directory=directoryFor(t),first=new ImportSessionStore(directory,{create:true,meta:{review:{row:1,size:'40×60',confirmed:true},revision:7}}),before=first.metadata();first.close();
 const {holder,exited}=await holdLock(directory);let reopened;
 try{holder.send({releaseAfterMs:350});reopened=new ImportSessionStore(directory);assert.deepEqual(reopened.metadata(),before);assert.equal(reopened.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}
 finally{reopened?.close();holder.kill();await exited;}
});
test('a persistent database lock fails within its budget, closes its handle and permits a later retry',async t=>{
 const directory=directoryFor(t);new ImportSessionStore(directory,{create:true,meta:{preserved:'original'}}).close();
 const {holder,exited}=await holdLock(directory),exec=DatabaseSync.prototype.exec;let opened;
 const instrument=t.mock.method(DatabaseSync.prototype,'exec',function(sql){opened=this;return exec.call(this,sql);});
 try{
  // Keep the lock until cleanup. A timed release can race a descheduled parent
  // and turn this persistent-lock fixture into the temporary-lock case.
  const started=Date.now();assert.throws(()=>new ImportSessionStore(directory),error=>error.code==='ERR_SQLITE_ERROR'&&error.errcode===5);
  assert.ok(Date.now()-started<10000,'Lock waiting must remain bounded');assert.equal(opened.isOpen,false,'A failed constructor must release the SQLite handle');
 }finally{instrument.mock.restore();holder.kill();await exited;}
 const reopened=new ImportSessionStore(directory);try{assert.equal(reopened.getMeta('preserved'),'original');}finally{reopened.close();}
});
test('metadata initialization errors release the database and preserve the original error',t=>{
 const directory=directoryFor(t),exec=DatabaseSync.prototype.exec;let opened;
 t.mock.method(DatabaseSync.prototype,'exec',function(sql){opened=this;return exec.call(this,sql);});
 const cyclic={};cyclic.self=cyclic;
 assert.throws(()=>new ImportSessionStore(directory,{create:true,meta:{cyclic}}),/circular/i);
 assert.equal(opened.isOpen,false);
});
