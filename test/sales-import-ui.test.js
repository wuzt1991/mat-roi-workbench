const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCandidate}=require('../public/sales-import-ui.js');

const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness(overrides={},uiOptions={}){
 const docListeners=new Map(),dialogListeners=new Map(),counts=new Map(),calls=[],messages=[];
 const target=selector=>({matches:q=>q.split(',').includes(selector),closest:q=>q.split(',').includes(selector)?target(selector):null});
 const zone={...target('[data-sales-upload-trigger]'),attributes:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);},contains(n){return n===zone||n===child;},closest(){return zone;}};
 const child={closest:()=>zone},outside={closest:()=>null},dropLabel={textContent:''};
 const input={click(){calls.push('picker');}};
 const dialog={open:false,innerHTML:'',setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},contains:n=>n===zone,querySelector:q=>q==='[data-sales-upload-trigger]'?zone:q==='[data-sales-drop-label]'?dropLabel:q==='[data-sales-file]'?input:null,addEventListener:(n,f)=>dialogListeners.set(n,f),removeEventListener:n=>dialogListeners.delete(n)};
 const document={getElementById:()=>dialog,addEventListener:(n,f)=>{docListeners.set(n,f);counts.set(n,(counts.get(n)||0)+1);},removeEventListener:n=>docListeners.delete(n)};
 const state={active:'p',sizes:[{id:'size',salesW:40,salesH:60}],plans:[{id:'p',shopId:'shop',items:[{id:'item',sizeId:'size',skuId:'keep'}]}]};
 const context=vm.createContext({document,setTimeout,clearTimeout});for(const file of ['sales-import/model.js','sales-import/controller.js','sales-import/views.js','sales-import-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/'+file),'utf8'),context);
 const fileJobs={create:async()=>{calls.push('create');return {sessionId:'s',ownerToken:'o'};},upload:async()=>{calls.push('upload');},status:async()=>({phase:'reviewing',candidateSheets:[{id:'sheet',name:'销售',mapping:{specName:1,orderCount:5,unitCount:7},columns:Array.from({length:8},(_,id)=>({id,name:String(id)}))}]}),selectSheet:async(id,data)=>{calls.push(data);},salesCandidate:async(id,data)=>({items:[{id:'item',itemId:'item',count:238,share:100}],groups:[{rowId:1,size:'40×60',count:238,sourceCount:4,itemId:'item'}],sources:[{key:'source',label:'本表商品'}],sourceKey:'source',total:238,unknown:0,excluded:0,missing:[],ready:true,periods:['2026/09/14-2026/09/20'],revision:0}),...overrides};
 const ui=context.SalesImportUI.create({getState:()=>state,getContext:()=>({planId:'p',shopId:'shop',workspaceId:'w',storageEpoch:0}),fileJobs,toast:m=>messages.push(m),flush:async()=>true,commit:async p=>{calls.push({commit:p});return {undoToken:{}};},...uiOptions});
 ui.open();
 const event=({files=[{name:'销售.xlsx',size:100}],items=[],node=child,type='drop'}={})=>({type,target:node,dataTransfer:{files,items,types:['Files']},preventDefault(){this.prevented=true;}});
 return {ui,state,docListeners,dialogListeners,counts,calls,messages,zone,child,outside,dropLabel,event,target,dialog};
}
test('销售拖放与点击选择共用读取、自动字段、日期、尺寸回填流程',async t=>{
 const h=harness();t.after(()=>h.ui.destroy());
 const enter=h.event({type:'dragenter'});h.docListeners.get('dragenter')(enter);assert.equal(enter.prevented,true);assert.equal(h.zone.attributes.get('data-dragging'),'true');
 await h.docListeners.get('drop')(h.event());assert.deepEqual(h.calls,['create','upload']);
 assert.match(h.ui.html(),/确认销售字段/);
 await h.ui.selectSheet();assert.equal(h.calls[2].matchBy,'size');assert.equal(h.calls[2].mapping.sales,5);assert.equal(h.calls[2].mapping.specName,1);
 assert.equal(h.ui.getDraft().period,'2026/09/14-2026/09/20');assert.match(h.ui.html(),/100.00%/);
 await h.ui.apply();const applied=h.calls.find(c=>c.commit)?.commit;assert.equal(applied.items[0].bind,false);assert.equal(applied.total,238);
 h.ui.close();h.ui.open();
 h.dialogListeners.get('keydown')({target:h.target('[data-sales-upload-trigger]'),key:'Enter',preventDefault(){}});
 assert.equal(h.calls.at(-1),'picker');
 const fileTarget={...h.target('[data-sales-file]'),files:[{name:'click.xlsx',size:100}]};await h.dialogListeners.get('change')({target:fileTarget});
 assert.deepEqual(h.calls.slice(-2),['create','upload']);
});
test('销售拖放拒绝多个文件、文件夹、非 Excel，区域外防跳转，关闭不拦截',async t=>{
 const h=harness();t.after(()=>h.ui.destroy());
 for(const data of [{files:[{name:'a.xlsx'},{name:'b.xlsx'}]},{items:[{webkitGetAsEntry:()=>({isDirectory:true})}]},{files:[{name:'a.csv',size:10}]}]){
 await h.docListeners.get('drop')(h.event(data));assert.equal(h.calls.length,0);assert.match(h.ui.html(),/sales-import-alert/);
 }
 const outside=h.event({node:h.outside});await h.docListeners.get('drop')(outside);assert.equal(outside.prevented,true);assert.equal(h.calls.length,0);
 h.ui.close();const closed=h.event();await h.docListeners.get('drop')(closed);assert.equal(closed.prevented,undefined);
});
test('忙碌不重复上传，关闭重开不重复绑定，销毁清理监听',async()=>{
 let release;const h=harness({create:()=>new Promise(r=>{release=r;})});
 const first=h.docListeners.get('drop')(h.event());await h.docListeners.get('drop')(h.event());assert.match(h.messages.at(-1),/重复/);
 release({sessionId:'s',ownerToken:'o'});await first;
 h.ui.close();h.ui.open();assert.equal(h.counts.get('drop'),1);
 h.ui.destroy();assert.equal(h.docListeners.size,0);assert.equal(h.dialogListeners.size,0);
});
test('工作区尺寸变化阻止陈旧候选写入，读取失败可以重试',async t=>{
 let attempt=0;const h=harness({upload:async()=>{if(++attempt===1)throw Error('读取失败');}});t.after(()=>h.ui.destroy());
 await h.ui.startFile({name:'a.xlsx',size:100});assert.match(h.ui.html(),/读取失败/);
 await h.ui.startFile({name:'a.xlsx',size:100});await h.ui.selectSheet();
 h.state.sizes[0].salesW=45;await h.ui.apply();assert.match(h.ui.html(),/尺寸已变化/);assert.equal(h.calls.some(c=>c.commit),false);
});
test('销毁后的延迟创建结果不恢复过期会话',async()=>{
 let release;const h=harness({create:()=>new Promise(r=>{release=r;})});
 const pending=h.ui.startFile({name:'a.xlsx',size:100});h.ui.destroy();release({sessionId:'late',ownerToken:'o'});await pending;
 assert.equal(h.ui.getSession(),null);
});


test('sales candidate uses the bounded backend aggregate, including SKUs outside the visible page',async()=>{
  const candidate=await buildCandidate({
    getContext:()=>({workspaceId:'w1',storageEpoch:2,shopId:'shop-1',planId:'plan-1',plan:{items:[{id:'item-a'},{id:'item-b'}]}}),
    session:{sessionId:'session-1'},filename:'sales.xlsx',period:'2026-09-01 至 2026-09-18',
    skuFingerprint:'fp-1',rows:[{rowId:'visible',itemId:'item-a',count:3}],pageComplete:false,
    aggregate:async()=>({total:8,items:[{id:'a',itemId:'item-a',count:3},{id:'b',itemId:'item-b',count:5}],missing:[]})
  });
  assert.equal(candidate.total,8);
  assert.deepEqual(candidate.items.map(x=>[x.itemId,x.count]),[['item-a',3],['item-b',5]]);
  assert.equal(candidate.itemsFingerprint,'fp-1');
});

test('sales candidate refuses a partial current page when no aggregate service is available',async()=>{
  await assert.rejects(()=>buildCandidate({
    getContext:()=>({planId:'plan-1',plan:{items:[{id:'item-a'}]}}),session:{sessionId:'session-1'},
    rows:[{rowId:'visible',itemId:'item-a',count:3}],pageComplete:false
  }),/全量汇总/);
});

test('sales candidate allows a complete bounded page only when explicitly marked complete',async()=>{
  const candidate=await buildCandidate({
    getContext:()=>({planId:'plan-1',plan:{items:[{id:'item-a'}]}}),session:{sessionId:'session-1'},
    rows:[{rowId:'only',itemId:'item-a',count:3}],pageComplete:true
  });
  assert.equal(candidate.total,3);
  assert.equal(candidate.items[0].itemId,'item-a');
});

test('关闭未应用复核仍阻止退出，明确放弃后解除保护',async t=>{
 const h=harness({discard:async()=>{}});t.after(()=>h.ui.destroy());
 await h.ui.startFile({name:'a.xlsx',size:100});await h.ui.selectSheet();h.ui.close();
 assert.equal(h.ui.hasUnpersistedDraft(),true);assert.equal(h.ui.canQuit(),false);
 h.ui.open();await h.dialogListeners.get('click')({target:h.target('[data-sales-discard]')});
 assert.equal(h.ui.hasUnpersistedDraft(),false);assert.equal(h.ui.canQuit(),true);
});
test('应用候选迟到时，不向已销毁并重开的对话框写入或报告成功',async t=>{
 let release,delay=false;const h=harness({salesCandidate:async()=>{
   if(delay)await new Promise(r=>release=r);
   return {items:[{id:'item',itemId:'item',count:1}],groups:[],total:1,ready:true,periods:['2026-09']};
 }});t.after(()=>h.ui.destroy());
 await h.ui.startFile({name:'a.xlsx',size:100});await h.ui.selectSheet();delay=true;
 const pending=h.ui.apply();await new Promise(r=>setImmediate(r));h.ui.destroy();h.ui.open();release();await pending;
 assert.equal(h.calls.some(c=>c.commit),false);assert.doesNotMatch(h.ui.html(),/当前计划或商品尺寸已变化|订单占比已更新|sales-import-alert/);
});

test('一键添加只暂存，自动匹配并携带新增规格应用；忙碌时防重复，放弃不修改计划',async t=>{
 let release,delay=false;
 const h=harness({discard:async()=>{},salesCandidate:async(id,meta)=>{
  if(delay)await new Promise(r=>release=r);
  const added=meta.additions?.[0];
  return {items:[{id:'item',itemId:'item',count:4},...(added?[{id:added.itemId,itemId:added.itemId,count:6}]:[])],groups:[{rowId:2,size:'45×70',width:45,height:70,count:6,canAdd:!added,itemId:added?.itemId||'',sourceCount:2}],total:added?10:4,ready:!!added,periods:['2026-09'],sourceKey:'source',excluded:0};
 }});t.after(()=>h.ui.destroy());
 const before=JSON.stringify(h.state);await h.ui.startFile({name:'a.xlsx',size:100});await h.ui.selectSheet();assert.match(h.ui.html(),/一键添加此尺寸/);
 delay=true;const pending=h.ui.addSize(2);await h.ui.addSize(2);assert.equal(h.ui.getDraft().additions.length,1);release();await pending;delay=false;
 assert.equal(JSON.stringify(h.state),before);assert.match(h.ui.html(),/待添加 1 个尺寸/);assert.match(h.ui.html(),/取消添加/);
 await h.ui.apply();const payload=h.calls.find(c=>c.commit).commit;assert.equal(payload.additions.length,1);assert.equal(payload.additions[0].width,45);assert.equal(payload.items[1].itemId,payload.additions[0].itemId);
 h.ui.close();h.ui.open();await h.ui.startFile({name:'a.xlsx',size:100});await h.ui.selectSheet();await h.ui.addSize(2);
 await h.dialogListeners.get('click')({target:h.target('[data-sales-discard]')});assert.equal(h.ui.getDraft().additions.length,0);assert.equal(JSON.stringify(h.state),before);
});
