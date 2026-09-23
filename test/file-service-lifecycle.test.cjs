'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable,Writable}=require('node:stream');
const {EventEmitter}=require('node:events');
const root=process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'..');
const {createFileService,ruleSnapshot}=require(path.join(root,'server/file-service.cjs'));
const {ImportSessionStore,digest}=require(path.join(root,'server/import-session-store.cjs'));
const Domain=require(path.join(root,'public/domain.js'));
const Recognition=require(path.join(root,'public/product-recognition.js'));

async function fixture(t,{kind='product'}={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-lifecycle-')),state=Domain.initialState();
  const workspace={workspaceId:'workspace',storageEpoch:0},store={metadata:()=>({...workspace}),read:()=>({state})},service=createFileService({store,dataDir});
  service.broker.entry=path.join(__dirname,'fixtures','diagnostic-file-job.cjs');
  t.after(async()=>{await service.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  async function request(method,url,body){const stream=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);stream.method=method;stream.headers={'content-type':'application/json'};const chunks=[],response=new Writable({write(chunk,encoding,done){chunks.push(chunk);done();}});response.writeHead=status=>{response.statusCode=status;};const done=new Promise(resolve=>response.on('finish',resolve));await service.handle(stream,response,new URL(url,'http://localhost'));await done;const value=Buffer.concat(chunks).toString();return {status:response.statusCode,value:value?JSON.parse(value):null};}
  const created=(await request('POST','/api/file-sessions',{kind})).value,id=created.sessionId,directory=path.join(dataDir,'import-sessions',id),open=()=>new ImportSessionStore(directory);
  const session=open(),rules=ruleSnapshot(state),mapping={platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8},values=['抖音','店铺','硅藻泥地垫','40*60cm 3mm','p','s',20,'在售',10],raw={rowId:1,sourceRow:2,sheetId:'sheet',values,mapping},derived=Recognition.deriveTransferRow(raw,{}, {rules});session.setMeta('mapping',mapping);session.setMeta('sourceHash','test-source');session.insertRawBatch([{...raw,sourceHash:'row-source',platform:derived.platform,shop:derived.shop,productId:derived.productId,skuId:derived.skuId,groupId:derived.groupId,originalMissingThickness:false}]);session.rebuildDerived(rules);session.close();
  return {dataDir,state,workspace,service,request,created,id,directory,open,rules,command:{ownerToken:created.ownerToken,expectedSessionRevision:0,mutationId:'review-1',rowIds:[1],action:{type:'row-edit'},patch:{size:{mode:'blank'}}}};
}
const rejectedCode=(code)=>error=>error?.code===code;
test('failed recompute receipt rolls back the published generation, decisions and revision together',async t=>{
 const f=await fixture(t),s=f.open(),before=s.page(),reviews=s.db.prepare('SELECT * FROM reviews').all();
 const material=f.rules.materials.find(m=>m.name==='硅藻泥'),rule=material.weightRules.find(r=>Number(r.thickness)===5);
 s.saveReceipt=()=>{throw Error('injected receipt failure');};
 assert.throws(()=>s.rebuildDerived(f.rules,{applyUniformThickness:true,thicknessDefaults:{[material.id]:rule.id},command:{ownerToken:f.created.ownerToken,expectedSessionRevision:0,mutationId:'failed-receipt'}}),/injected receipt failure/);
 assert.deepEqual(s.page(),before);assert.deepEqual(s.db.prepare('SELECT * FROM reviews').all(),reviews);assert.equal(s.db.prepare('SELECT count(*) n FROM receipts').get().n,0);s.close();
});
test('mutation outcome lookup is read-only, owner-bound and rejects changed request content',async t=>{
 const f=await fixture(t),url=`/api/file-sessions/${f.id}/mutation-status`;
 assert.equal((await f.request('POST',url,{kind:'review',command:f.command})).value.state,'not-committed');
 let session=f.open();assert.equal(session.getMeta('revision'),0);session.close();
 await f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command);
 const found=(await f.request('POST',url,{kind:'review',command:f.command})).value;
 assert.equal(found.state,'committed');assert.equal(found.result.revision,1);
 await assert.rejects(f.request('POST',url,{kind:'review',command:{...f.command,patch:{size:{mode:'value',width:1,length:2}}}}),rejectedCode('MUTATION_CONFLICT'));
 await assert.rejects(f.request('POST',url,{kind:'review',command:{...f.command,ownerToken:'another'}}));
 f.workspace.storageEpoch++;await assert.rejects(f.request('POST',url,{kind:'review',command:f.command}),rejectedCode('WORKSPACE_CONTEXT_CHANGED'));
});
test('actual committed review with lost HTTP response is recovered without resubmission',async t=>{
 const f=await fixture(t),Commands=require('../public/product-transfer/commands.js');let writes=0,probes=0;
 const commands=Commands.create({newId:()=> 'lost-review',request:async(action,p)=>{
  if(action==='review'){writes++;await f.request('POST',`/api/file-sessions/${f.id}/reviews`,p.command);throw new TypeError('connection lost');}
  assert.equal(action,'mutationStatus');probes++;return (await f.request('POST',`/api/file-sessions/${f.id}/mutation-status`,p)).value;
 }});
 const result=await commands.run('review',f.created,{rowIds:[1],action:{type:'row-edit'},patch:{size:{mode:'blank'}}});
 assert.equal(result.revision,1);assert.equal(writes,1);assert.equal(probes,1);assert.equal(commands.uncertain(),false);
 const s=f.open();assert.equal(s.getMeta('revision'),1);assert.equal(s.db.prepare('SELECT count(*) n FROM receipts').get().n,1);s.close();
});
test('recompute receipt is published with the generation and prevents replayed uniform application',async t=>{
 const f=await fixture(t),material=f.rules.materials.find(m=>m.name==='硅藻泥'),rule=material.weightRules.find(r=>Number(r.thickness)===5);
 const command={ownerToken:f.created.ownerToken,expectedSessionRevision:0,mutationId:'recompute-lost',action:{type:'recompute'},applyUniformThickness:true,thicknessDefaults:{[material.id]:rule.id}};
 const started=await f.request('POST',`/api/file-sessions/${f.id}/recompute`,command);
 const running=(await f.request('POST',`/api/file-sessions/${f.id}/mutation-status`,{kind:'recompute',command})).value;
 assert.ok(['running','committed'].includes(running.state));
 const job=await completed(f.service,started.value.jobId);assert.equal(job.state,'succeeded',JSON.stringify(job.error));
 const receipt=(await f.request('POST',`/api/file-sessions/${f.id}/mutation-status`,{kind:'recompute',command})).value;
 assert.equal(receipt.state,'committed');assert.equal(receipt.result.revision,1);
 const replay=(await f.request('POST',`/api/file-sessions/${f.id}/recompute`,command)).value;
 assert.equal(replay.replayed,true);assert.equal(replay.generation,2);
 const s=f.open();assert.equal(s.getMeta('generation'),2);assert.equal(s.getMeta('revision'),1);s.close();
});
test('undo lost response is replayed from its atomic receipt without a second change',async t=>{
 const f=await fixture(t);await f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command);
 const command={ownerToken:f.created.ownerToken,expectedSessionRevision:1,mutationId:'undo-response-lost',action:{type:'undo'}};
 const first=await f.request('POST',`/api/file-sessions/${f.id}/undo`,command);
 const replay=await f.request('POST',`/api/file-sessions/${f.id}/undo`,command);
 assert.equal(first.value.revision,2);assert.equal(replay.value.replayed,true);assert.equal(replay.value.revision,2);
 const session=f.open();assert.equal(session.getMeta('revision'),2);assert.equal(session.review(1).size,undefined);session.close();
});
async function completed(service,jobId){const end=Date.now()+10000;while(Date.now()<end){const job=service.broker.get(jobId);if(job&&job.state!=='running')return job;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Job timed out');}

test('restored workspace fences stale session commands even when client omits epoch',async t=>{const f=await fixture(t);f.workspace.storageEpoch++;await assert.rejects(f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command),rejectedCode('WORKSPACE_CONTEXT_CHANGED'));await assert.rejects(f.request('GET',`/api/file-sessions/${f.id}/rows`),rejectedCode('WORKSPACE_CONTEXT_CHANGED'));});
test('review HTTP retry returns original receipt before stale revision check',async t=>{const f=await fixture(t);const first=await f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command),second=await f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command);assert.equal(second.value.replayed,true);assert.equal(second.value.revision,first.value.revision);});
test('rules change blocks undo and previously generated downloads',async t=>{const f=await fixture(t);await f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command);const session=f.open(),filename=path.join(f.directory,'artifact.xlsx');fs.writeFileSync(filename,'fixture');const meta=session.metadata(),artifact=session.registerArtifact(filename,'商品转表.xlsx',digest([meta.sourceHash,meta.revision,meta.generation,meta.rulesFingerprint]));session.close();f.state.materials[0].name+=' changed';await assert.rejects(f.request('POST',`/api/file-sessions/${f.id}/undo`,{ownerToken:f.created.ownerToken,expectedSessionRevision:1}),rejectedCode('RULES_CHANGED'));await assert.rejects(f.request('GET',`/api/file-sessions/${f.id}/download?artifactId=${artifact.artifactId}`),rejectedCode('RULES_CHANGED'));});
test('discard waits for child exit before removing session files',async t=>{const f=await fixture(t),child=new EventEmitter(),job={jobId:'active',sessionId:f.id,child};child.exitCode=null;child.signalCode=null;let exitObserved=false;f.service.broker.active=job;f.service.broker.jobs.set(job.jobId,job);f.service.broker.cancel=()=>{setTimeout(()=>{assert.ok(fs.existsSync(f.directory));exitObserved=true;child.exitCode=0;child.emit('exit',0,null);f.service.broker.active=null;},40);return job;};const result=await f.request('POST',`/api/file-sessions/${f.id}/discard`,{ownerToken:f.created.ownerToken});assert.equal(result.value.discarded,true);assert.equal(exitObserved,true);assert.equal(fs.existsSync(f.directory),false);});
test('sales candidate and binding reject partial aggregate state while a file job is active',async t=>{const f=await fixture(t,{kind:'sales'});f.service.broker.active={jobId:'aggregate',sessionId:f.id};await assert.rejects(f.request('POST',`/api/file-sessions/${f.id}/sales-candidate`,{ownerToken:f.created.ownerToken,planItems:[]}),rejectedCode('FILE_JOB_BUSY'));await assert.rejects(f.request('POST',`/api/file-sessions/${f.id}/sales-reviews`,{ownerToken:f.created.ownerToken,mutationId:'sales-1',rowIds:[1],patch:{itemId:'item'}}),rejectedCode('FILE_JOB_BUSY'));f.service.broker.active=null;});
test('explicit recompute preserves reviews, refreshes generation and stops before export',async t=>{const f=await fixture(t);await f.request('POST',`/api/file-sessions/${f.id}/reviews`,f.command);f.state.materials[0].name+=' changed';const stale=await f.request('GET',`/api/file-sessions/${f.id}/rows`);assert.equal(stale.value.rulesStale,true);assert.equal(stale.value.ready,false);const started=await f.request('POST',`/api/file-sessions/${f.id}/recompute`,{ownerToken:f.created.ownerToken,expectedSessionRevision:1});assert.equal(started.status,202);const job=await completed(f.service,started.value.jobId);assert.equal(job.state,'succeeded',JSON.stringify(job.error));const session=f.open();assert.equal(session.getMeta('generation'),2);assert.equal(session.review(1).size.status,'blank');assert.equal(session.getMeta('rulesFingerprint'),digest(ruleSnapshot(f.state)));assert.equal(session.getMeta('artifact'),null);session.close();const page=await f.request('GET',`/api/file-sessions/${f.id}/rows`);assert.equal(page.value.rulesStale,false);});


test('旧识别版本缓存必须重新校验，不能直接导出看似完整的文件',async t=>{const f=await fixture(t),store=f.open();store.setMeta('derivationVersion',0);store.close();const page=await f.request('GET',`/api/file-sessions/${f.id}/rows?attention=1`);assert.equal(page.value.counts.ready,true);assert.equal(page.value.ready,false);assert.equal(page.value.rulesStale,true);await assert.rejects(f.request('POST',`/api/file-sessions/${f.id}/export`,{ownerToken:f.created.ownerToken,expectedSessionRevision:0}),rejectedCode('RULES_CHANGED'));});

test('新流程必须先确认材质厚度，再允许导出；确认后发布完整结果',async t=>{
 const f=await fixture(t),store=f.open();store.setMeta('requireThicknessSetup',true);store.close();
 const before=await f.request('GET',`/api/file-sessions/${f.id}/rows`);assert.equal(before.value.counts.ready,true);assert.equal(before.value.ready,false);
 await assert.rejects(f.request('POST',`/api/file-sessions/${f.id}/export`,{ownerToken:f.created.ownerToken,expectedSessionRevision:0}),rejectedCode('THICKNESS_SETUP_REQUIRED'));
 const material=f.rules.materials.find(m=>m.name==='硅藻泥'),rule=material.weightRules.find(r=>Number(r.thickness)===5);
 const started=await f.request('POST',`/api/file-sessions/${f.id}/recompute`,{ownerToken:f.created.ownerToken,expectedSessionRevision:0,applyUniformThickness:true,thicknessDefaults:{[material.id]:rule.id}});const job=await completed(f.service,started.value.jobId);assert.equal(job.state,'succeeded',JSON.stringify(job.error));
 const after=await f.request('GET',`/api/file-sessions/${f.id}/rows`);assert.equal(after.value.ready,true);assert.equal(after.value.thicknessConfigured,true);assert.equal(after.value.revision,1);assert.equal(after.value.rows[0].derived.thickness.ruleId,rule.id);
});
