'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js'),{SaveQueue}=require('../public/persistence.js');
const {appHarness}=require('./app-harness.cjs');
const click=(h,action)=>h.dispatch('click',{closest:()=>({dataset:{action}})});
const input=(dataset,value)=>({type:'number',value,dataset,attributes:{},matches(selector){return selector===`[data-${dataset.param?'param':dataset.paramRate?'param-rate':dataset.item?'item':'field'}]`;},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}});

test('恢复启动草稿走专用恢复接口，成功前不改当前状态或删除草稿',async t=>{
  const state=M.initialState(),draft=M.clone(state);draft.plans[0].name='待恢复计划';
  const cached=new Map([['audit-draft',JSON.stringify({state:draft})]]),requests=[];
  let saved={state,revision:4,workspaceId:'audit',storageEpoch:0},fail=true;
  const h=appHarness(state,{WorkbenchPersistence:{SaveQueue}},{localStorage:{getItem:k=>cached.get(k),setItem:(k,v)=>cached.set(k,v),removeItem:k=>cached.delete(k)},fetch:async(route,options)=>{
    requests.push({route,body:options.body&&JSON.parse(options.body)});
    if(route==='/api/restore'){
      if(fail)throw Error('连接中断');
      const body=JSON.parse(options.body);assert.equal(body.expectedRevision,4);
      saved={...saved,state:body.state,revision:5,storageEpoch:1};
    }
    return {ok:true,json:async()=>saved};
  }});
  const q=new SaveQueue({revision:4,workspaceId:'audit',storageEpoch:0,send:()=>assert.fail('恢复不应走普通保存')});t.after(()=>{q.dispose();h.ui.queue?.dispose?.();});h.ui.queue=q;
  h.ui.pendingRecovery={key:'audit-draft',state:draft,baseRevision:4};h.ui.open('recover-draft');
  await click(h,'recover-draft');assert.equal(requests[0]?.route,'/api/restore');assert.deepEqual(h.ui.state,state);assert.ok(cached.has('audit-draft'));
  const operationId=requests[0].body.operationId;fail=false;await click(h,'recover-draft');
  assert.equal(requests.filter(r=>r.route==='/api/restore')[1].body.operationId,operationId);
  assert.equal(h.ui.state.plans[0].name,'待恢复计划');assert.equal(cached.has('audit-draft'),false);assert.equal(h.ui.pendingRecovery,null);
});

test('超限和浏览器无效数字不清空已保存的售价、消耗及退款率',async()=>{
  for(const [dataset,read] of [
    [{param:'spend'},s=>s.plans[0].params.spend],
    [{item:M.seed().plans[0].items[0].id,key:'price'},s=>s.plans[0].items[0].price],
    [{paramRate:'returnRefund'},s=>s.plans[0].params.refundRates.returnRefund]
  ]){
    const state=M.seed();state.active=state.plans[0].id;state.activeShop=state.plans[0].shopId;
    if(dataset.item)dataset.item=state.plans[0].items[0].id;
    const h=appHarness(state);let writes=0;h.ui.queue={enqueue(){writes++;}};
    for(const value of ['1000000000001','1e309']){
      const el=input(dataset,value);await h.dispatch('input',el);
      assert.equal(read(h.ui.state),read(state));assert.equal(el.value,value);assert.equal(writes,0);assert.equal(el.attributes['aria-invalid'],'true');
    }
    const bad=input(dataset,'');bad.validity={badInput:true};await h.dispatch('input',bad);
    assert.equal(read(h.ui.state),read(state));assert.equal(writes,0);assert.equal(bad.attributes['aria-invalid'],'true');
    const corrected=input(dataset,'12.50');await h.dispatch('input',corrected);assert.equal(read(h.ui.state),12.5);assert.equal(writes,1);
    const cleared=input(dataset,'');await h.dispatch('input',cleared);assert.equal(read(h.ui.state),'');assert.equal(writes,2);
  }
});

test('恢复草稿响应丢失后重试同一操作，真实数据库只恢复一次且保留恢复前快照',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {createServer}=require('../server/index.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-audit-restore-'));
  const running=createServer({dataDir:dir,port:0}),url=await running.listen(),before=running.store.read();
  let h; t.after(async()=>{h?.ui.queue?.dispose();await running.close();fs.rmSync(dir,{recursive:true,force:true});});
  const draft=M.clone(before.state);draft.plans[0].name='响应丢失后恢复';
  const cached=new Map([['lost-draft','saved']]);let calls=0;
  h=appHarness(before.state,{WorkbenchPersistence:{SaveQueue}},{localStorage:{getItem:k=>cached.get(k),setItem:(k,v)=>cached.set(k,v),removeItem:k=>cached.delete(k)},fetch:async(route,options)=>{
    const response=await fetch(url+route,options);
    if(route==='/api/restore'&&++calls===1){assert.equal(response.status,200);await response.json();throw Error('恢复已提交，但连接中断');}
    return response;
  }});
  h.ui.queue=new SaveQueue({...before,send:()=>assert.fail('恢复不能通过普通保存')});
  h.ui.pendingRecovery={key:'lost-draft',state:draft,baseRevision:before.revision};h.ui.open('recover-draft');
  await click(h,'recover-draft');assert.equal(running.store.read().revision,before.revision+1);assert.ok(cached.has('lost-draft'));assert.deepEqual(h.ui.state,before.state);
  await click(h,'recover-draft');assert.equal(calls,2);assert.equal(running.store.read().revision,before.revision+1);assert.equal(running.store.read().storageEpoch,before.storageEpoch+1);assert.equal(h.ui.state.plans[0].name,draft.plans[0].name);assert.equal(cached.has('lost-draft'),false);
  const checkpoints=running.store.backups().filter(x=>x.reason==='before-restore-v4');assert.equal(checkpoints.length,1);assert.deepEqual(running.store.backup(checkpoints[0].id),before.state);
});

test('重量弹窗拒绝非法及超限输入，已删除 SKU 的重量草稿不能误用到其他商品',async()=>{
  const state=M.seed(),p=state.plans[0];state.active=p.id;state.activeShop=p.shopId;
  const h=appHarness(state),before=M.clone(state);let writes=0;h.ui.queue={enqueue(){writes++;}};
  h.ui.open('weight',{id:p.items[0].id,draft:{weight:''}});
  for(const raw of ['1e309','-1','1000000000001']){
    await h.dispatch('input',input({field:'weight',unit:'g'},raw));h.ui.saveModal();assert.equal(h.ui.modal.type,'weight');assert.deepEqual(h.ui.state,before);assert.equal(writes,0);
  }
  h.ui.close(true);h.ui.open('recover-form',{stored:{value:{type:'weight',id:'removed-sku',draft:{weight:.321}}}});
  await click(h,'recover-form-draft');assert.notEqual(h.ui.modal?.type,'weight');assert.deepEqual(h.ui.state,before);
});

test('入账与试算一致接受小数退款率边界，仍拒绝真正超限的退款率',()=>{
  const Entries=require('../public/operating-records/entries.js');
  for(const rates of [
    {unshipped:.01,shippedOnly:64.04,returnRefund:35.95,firstHour:100},
    {unshipped:.01,shippedOnly:.06,returnRefund:0,firstHour:.07}
  ]){
    const state=M.seed();state.records=[];
    const draft=Entries.start(state,state.plans[0]);Object.assign(draft.frame.plan.params,{spend:100,actualGmv:500,refundRates:rates});
    assert.equal(M.calculate(draft.frame,draft.frame.plan).valid,true);
    assert.equal(Entries.validate(draft),true);
    const next=Entries.confirm(state,draft);assert.equal(next.records.length,1);assert.equal(M.validateBackup(next),true);assert.equal(state.records.length,0);
  }
  for(const rates of [
    {unshipped:.01,shippedOnly:64.04,returnRefund:35.96,firstHour:100},
    {unshipped:.01,shippedOnly:.06,returnRefund:0,firstHour:.08}
  ]){
    const state=M.seed(),draft=Entries.start(state,state.plans[0]);Object.assign(draft.frame.plan.params,{spend:100,actualGmv:500,refundRates:rates});
    assert.equal(M.calculate(draft.frame,draft.frame.plan).valid,false);assert.throws(()=>Entries.validate(draft),/退款率/);
  }
});

test('重量编辑草稿能够恢复且未保存前不改变商品重量',async()=>{
  const state=M.seed(),p=state.plans[0];state.active=p.id;state.activeShop=p.shopId;
  const h=appHarness(state),before=p.items[0].weight;
  h.ui.open('recover-form',{stored:{value:{type:'weight',id:p.items[0].id,draft:{weight:.321}}}});
  await click(h,'recover-form-draft');assert.equal(h.ui.modal?.type,'weight');assert.equal(h.ui.modal.draft.weight,.321);assert.equal(h.ui.state.plans[0].items[0].weight,before);
});

test('真实文件服务仍能导出、读取备份及上传源文件，成功任务保留可用产物',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {createServer}=require('../server/index.cjs'),W=require('../public/workbook.js'),Excel=require('../public/assets/exceljs.min.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-audit-files-')),running=createServer({dataDir:dir,port:0}),url=await running.listen();
  t.after(async()=>{await running.close();fs.rmSync(dir,{recursive:true,force:true});});
  const state=M.seed(),headers={'Content-Type':'application/json','X-Workbench':'1'};
  async function json(route,method='GET',body){const response=await fetch(url+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${route}: ${response.status}`);return response.json();}
  async function completed(jobId){const deadline=Date.now()+10000;while(Date.now()<deadline){const job=await json('/api/file-jobs/'+jobId);if(job.state!=='running'){assert.equal(job.state,'succeeded',JSON.stringify(job.error));return job;}await new Promise(resolve=>setTimeout(resolve,20));}throw Error('文件任务超时');}
  const exported=await json('/api/file-jobs','POST',{type:'export-backup',payload:{state}});await completed(exported.jobId);
  const download=await fetch(url+'/api/file-jobs/'+exported.jobId+'/download');assert.equal(download.status,200);
  const bytes=Buffer.from(await download.arrayBuffer());assert.deepEqual(await W.importWorkbook(bytes),state);
  const inspected=await fetch(url+'/api/file-jobs/inspect-backup/source',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Workbench':'1','X-File-Name':'audit-backup.xlsx'},body:bytes});assert.equal(inspected.status,202);
  const inspectedJob=await completed((await inspected.json()).jobId);assert.deepEqual(inspectedJob.result.state,state);
  const listing=await json('/api/file-jobs','POST',{type:'export-listing',payload:{state,planId:state.plans[0].id}});await completed(listing.jobId);
  const listingResponse=await fetch(url+'/api/file-jobs/'+listing.jobId+'/download');assert.equal(listingResponse.status,200);const book=new Excel.Workbook();await book.xlsx.load(Buffer.from(await listingResponse.arrayBuffer()));assert.equal(book.getWorksheet('上架价格').rowCount,state.plans[0].items.length+1);
  const created=await json('/api/file-sessions','POST',{kind:'product'}),sourceBook=new Excel.Workbook();
  sourceBook.addWorksheet('商品').addRows([['平台','店铺','商品名称','商品规格','商品ID','规格ID','售价','状态','库存'],['抖音','测试店','硅藻泥地垫','40*60cm 3mm','p','s',20,'在售',10]]);
  const sourceBytes=Buffer.from(await sourceBook.xlsx.writeBuffer());
  const uploaded=await fetch(url+'/api/file-sessions/'+created.sessionId+'/source',{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Workbench':'1','X-Session-Owner':created.ownerToken},body:sourceBytes});assert.equal(uploaded.status,202);await completed((await uploaded.json()).jobId);
  const directory=path.join(dir,'import-sessions',created.sessionId);assert.deepEqual(fs.readFileSync(path.join(directory,'source.xlsx')),sourceBytes);assert.deepEqual(fs.readdirSync(directory).filter(name=>name.endsWith('.part')),[]);
  assert.equal((await json('/api/file-sessions/'+created.sessionId)).phase,'awaiting-selection');
});
