'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const childProcess=require('node:child_process'),{EventEmitter,once}=require('node:events');
const root=process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'..');
function fixture(t){
 const child=new EventEmitter();Object.assign(child,{connected:true,killed:false,exitCode:null,signalCode:null,send(){},disconnect(){this.connected=false;},kill(){this.killed=true;}});
 t.mock.method(childProcess,'fork',()=>child);
 const modulePath=require.resolve(path.join(root,'server/file-job-broker.cjs'));delete require.cache[modulePath];
 const {FileJobBroker}=require(modulePath),broker=new FileJobBroker();
 const job=broker.start('recompute',{},{});
 t.after(()=>{for(const timer of Object.values(broker.jobs.get(job.jobId).timers))clearTimeout(timer);delete require.cache[modulePath];});
 return {child,broker,job};
}
test('a result queued after process exit is consumed before declaring failure',t=>{
 const {child,broker,job}=fixture(t);child.exitCode=0;child.emit('exit',0,null);
 assert.equal(broker.get(job.jobId).state,'running');assert.equal(broker.canQuit(),false);
 child.emit('message',{jobId:job.jobId,type:'result',result:{generation:2,recomputed:true}});child.emit('close',0,null);
 assert.equal(broker.get(job.jobId).state,'succeeded');assert.equal(broker.get(job.jobId).result.generation,2);assert.equal(broker.canQuit(),true);
});
test('exit code zero without a completion message remains a failure',t=>{
 const {child,broker,job}=fixture(t);child.exitCode=0;child.emit('exit',0,null);child.emit('close',0,null);
 assert.equal(broker.get(job.jobId).state,'failed');assert.equal(broker.get(job.jobId).error.code,'CHILD_EXIT');
});
test('a queued worker error retains its cause instead of becoming a generic exit error',t=>{
 const {child,broker,job}=fixture(t);child.exitCode=1;child.emit('exit',1,null);
 child.emit('message',{jobId:job.jobId,type:'error',error:{code:'ROW_LIMIT',message:'too many rows'}});child.emit('close',1,null);
 assert.equal(broker.get(job.jobId).error.code,'ROW_LIMIT');
});
test('the real file worker flushes a delayed completion message before exiting',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-job-flush-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const {ImportSessionStore}=require(path.join(root,'server/import-session-store.cjs'));
 new ImportSessionStore(directory,{create:true,meta:{workspaceId:'fixture',storageEpoch:0}}).close();
 const child=childProcess.fork(path.join(__dirname,'fixtures/delayed-file-job-result.cjs'),[],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','inherit','ipc']}),messages=[];
 child.on('message',message=>messages.push(message));const closed=once(child,'close');
 child.send({type:'run',jobId:'flush-test',jobType:'recompute',payload:{rules:{}},context:{sessionDirectory:directory,workspaceId:'fixture',storageEpoch:0,revision:0,generation:0}});
 const [code]=await closed;assert.equal(code,0);assert.ok(messages.some(message=>message.type==='result'&&message.result.recomputed),'The terminal result must reach the parent');
 const store=new ImportSessionStore(directory);try{assert.equal(store.getMeta('generation'),1);}finally{store.close();}
});
