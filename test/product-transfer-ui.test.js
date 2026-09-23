const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const UI=require('../public/product-transfer-ui.js');
const {ruleSnapshot}=require('../server/file-service.cjs');

test('商品转表正式界面固定每页 100 条并按前六后四截断长商品 ID',()=>{
  assert.equal(UI.PAGE_SIZE,100);
  assert.equal(UI.truncateId('1234567890123456'),'123456…3456');
  assert.equal(UI.truncateId('1234567890'),'1234567890');
});

test('商品转表初始界面只提供真实 Excel 入口，不再暴露示例入口',()=>{
  const controller=UI.create({getState:()=>({materials:[],sizes:[]})});
  const html=controller.html();
  assert.match(html,/data-pv4-file/);
  assert.match(html,/选择 Excel/);
  assert.doesNotMatch(html,/载入示例|下载示例表/);
  assert.equal(controller.isBusy(),false);
  assert.equal(controller.canQuit(),true);
});

test('正式入口先加载商品识别模块，再加载商品转表脚本',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const recognition=html.indexOf('product-recognition.js');
  const transfer=html.indexOf('product-transfer.js');
  const transferUI=html.indexOf('product-transfer-ui.js');
  assert.ok(recognition>=0&&recognition<transfer&&recognition<transferUI);
});

test('创建会话只发送服务端指纹采用的规则字段',async()=>{
  const state={version:4,workspaceId:'ignored',shippingTemplates:[{id:'shipping'}],materials:[{id:'mat-a',name:'硅藻泥',price:12,active:true,deleted:false,history:[{price:12}],weightRules:[{id:'rule-a',thickness:3,variant:'',coefficient:.9,costPerSqm:9.8,default:true,active:true,deleted:false,extra:'ignored'}]}],sizes:[{id:'size-a',name:'40 × 60 cm',salesW:40,salesH:60,productionW:41,productionH:61,irregular:false,active:true,deleted:false}]};
  assert.deepEqual(UI.canonicalRules(state),{
    materials:[{id:'mat-a',name:'硅藻泥',deleted:false,weightRules:[{id:'rule-a',thickness:3,variant:'',coefficient:.9,costPerSqm:9.8,default:true,deleted:false}]}],
    sizes:[{id:'size-a',name:'40 × 60 cm',salesW:40,salesH:60,irregular:false,deleted:false}]
  });
  assert.deepEqual(UI.canonicalRules(state),ruleSnapshot(state));
});

test('正式界面暴露恢复上下文和退出保护接口',()=>{
  const controller=UI.create({getState:()=>({materials:[],sizes:[]})});
  for(const method of ['html','activate','deactivate','refreshContext','restoreSession','refresh','isBusy','canQuit','destroy','inspect'])assert.equal(typeof controller[method],'function');
  controller.refreshContext({workspaceId:'workspace-a',storageEpoch:3});
  assert.deepEqual(controller.inspect().selected,[]);
  controller.destroy();
});

test('正式界面按真实分页响应读取派生字段与字符串分组状态',async()=>{
  const state={materials:[{id:'mat-a',name:'硅藻泥',active:true,deleted:false,weightRules:[{id:'3.0',thickness:3,coefficient:.9,costPerSqm:9.8,active:true,deleted:false}]}],sizes:[]};
  const page={page:1,pageSize:100,total:1,totalPages:1,revision:2,generation:1,ready:false,counts:{total:1,pending:1,confirmed:0,missingThickness:0},groups:[{groupId:'group-a',productName:'吸水地垫',pending:1,platform:'抖音',shop:'测试店铺',productId:'12345678901234',total:1,visible:1,hidden:0,materialState:'mat-a',thicknessState:'mat-a:3.0'}],rows:[{rowId:1,sourceRow:2,groupId:'group-a',raw:['原始数组不用于展示'],review:{materialId:'',sizeId:'',materialRuleId:''},derived:{productId:'12345678901234',productName:'吸水地垫',specName:'灰色 40×60cm 3mm',skuId:'SKU-00000001',material:{status:'value',source:'auto',materialId:'mat-a',name:'硅藻泥'},size:{status:'value',source:'auto',width:40,length:60,label:'40*60',area:.24},thickness:{status:'value',source:'auto',materialId:'mat-a',ruleId:'3.0'},weight:.216,cost:2.352,values:Array.from({length:29},(_,i)=>i===19?19.9:i===21?100:null),status:'pending',issues:[{field:'price'}]}}]};
  const h=dragHarness(async(action)=>{assert.equal(action,'rows');return page;},state),controller=h.controller;
  await controller.restoreSession({sessionId:'session-a',ownerToken:'owner-a',revision:1});
  assert.doesNotMatch(controller.html(),/pv4-table/);
  await h.listeners.get('click')({target:{closest:()=>({matches:s=>s==='[data-pv4-manual]'})}});
  assert.match(controller.html(),/data-pv6-expand/);assert.doesNotMatch(controller.html(),/data-pv5-edit=/);
  await h.listeners.get('click')({target:{closest:()=>({matches:s=>s==='[data-pv6-expand]',dataset:{pv6Expand:'group-a'}})}});
  const html=controller.html();controller.destroy();
  assert.match(html,/吸水地垫/);assert.match(html,/灰色 40×60cm 3mm/);assert.match(html,/12345678901234/);assert.match(html,/¥2\.35/);assert.match(html,/40\*60/);assert.match(html,/硅藻泥 · 3 mm/);assert.match(html,/data-pv5-edit="1"/);assert.doesNotMatch(html,/<select/);
});

function dragHarness(request,state={}){
  const listeners=new Map(),bindings=new Map(),attributes=new Map(),calls=[],messages=[];
  const outside={closest:()=>null};
  const zone={closest:()=>zone,contains:node=>node===zone||node===child,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
  const child={closest:()=>zone},dialog={open:false,remove(){},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return null;}};
  const document={getElementById:()=>dialog,querySelector:selector=>selector==='[data-pv4-dropzone]'?zone:null,addEventListener:(type,handler)=>{bindings.set(type,(bindings.get(type)||0)+1);listeners.set(type,handler);},removeEventListener:(type,handler)=>{if(listeners.get(type)===handler)listeners.delete(type);}};
  const context=vm.createContext({document,ProductTransferModel:require('../public/product-transfer/model.js'),ProductTransferController:require('../public/product-transfer/controller.js'),ProductTransferViews:require('../public/product-transfer/views.js'),ProductTransferCommands:require('../public/product-transfer/commands.js'),ProductRecognition:require('../public/product-recognition.js'),LatticeLoader:require('../public/lattice-loader.js'),setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/product-transfer-ui.js'),'utf8'),context);
  const controller=context.ProductTransferUI.create({getState:()=>state,toast:message=>messages.push(message),request:async(action,payload)=>{calls.push({action,payload});if(request)return request(action,payload);if(action==='create')return {sessionId:'candidate',ownerToken:'owner'};if(action==='upload')return {phase:'ready',counts:{total:1}};if(action==='rows')return {rows:[],total:1,ready:true,counts:{total:1,confirmed:1,pending:0}};return {};}});
  controller.activate();
  function event({target=child,files=[],types=['Files'],items=[],relatedTarget=null}={}){return {target,relatedTarget,dataTransfer:{files,types,items,dropEffect:'none'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};}
  return {controller,listeners,bindings,attributes,calls,messages,zone,child,outside,dialog,event};
}

test('拖入完整 Excel 后自动接纳，点击选择仍可使用',async t=>{
  const h=dragHarness();t.after(()=>h.controller.destroy());
  await h.controller.restoreSession({sessionId:'existing',ownerToken:'existing-owner'});
  h.calls.length=0;
  const file={name:'商品.XLSX'},drop=h.event({files:[file]});
  await h.listeners.get('drop')(drop);
  assert.equal(drop.defaultPrevented,true);
  assert.deepEqual(h.calls.map(x=>x.action),['create','upload','rows','accept','discard']);
  assert.equal(h.calls[1].payload.file,file);
  assert.equal(h.controller.inspect().session.sessionId,'candidate');
  assert.equal(h.controller.inspect().session.filename,'商品.XLSX');
  assert.equal(h.controller.inspect().candidate,null);
  assert.doesNotMatch(h.controller.html(),/使用这次导入|pv4-table/);
  h.calls.length=0;
  const input={closest:()=>h.zone,matches:selector=>selector==='[data-pv4-file]',files:[file],value:'selected'};
  await h.listeners.get('change')({target:input});
  assert.deepEqual(h.calls.map(x=>x.action),['create','upload','rows','accept','discard']);
  assert.equal(input.value,'');
});

test('拖放拒绝多文件、非 Excel 和文件夹，区域外阻止打开文件但不导入',async t=>{
  const h=dragHarness();t.after(()=>h.controller.destroy());
  for(const [input,message] of [
    [{files:[{name:'a.xlsx'},{name:'b.xlsx'}]},/每次只能/],
    [{files:[{name:'a.csv'}]},/请选择 .xlsx/],
    [{files:[{name:'folder.xlsx'}],items:[{webkitGetAsEntry:()=>({isDirectory:true})}]},/不支持文件夹/],
    [{files:[{name:'a.xlsx'}],target:h.outside},/上方上传区域/]
  ]){const event=h.event(input);await h.listeners.get('drop')(event);assert.equal(event.defaultPrevented,true);assert.match(h.messages.at(-1),message);}
  assert.equal(h.calls.length,0);
  const textDrop=h.event({types:['text/plain']});await h.listeners.get('drop')(textDrop);assert.equal(textDrop.defaultPrevented,false);
});

test('拖入高亮跨子元素不闪烁，离开、停用和销毁清理拖放状态',async()=>{
  const h=dragHarness();
  const enter=h.event();h.listeners.get('dragenter')(enter);
  assert.equal(enter.dataTransfer.dropEffect,'copy');assert.equal(h.attributes.get('data-pv4-dragging'),'true');
  h.listeners.get('dragleave')(h.event({target:h.zone,relatedTarget:h.child}));assert.equal(h.attributes.has('data-pv4-dragging'),true);
  h.listeners.get('dragleave')(h.event());assert.equal(h.attributes.size,0);
  h.listeners.get('dragover')(h.event());h.controller.deactivate();assert.equal(h.attributes.size,0);
  const inactive=h.event({files:[{name:'a.xlsx'}]});await h.listeners.get('drop')(inactive);assert.equal(inactive.defaultPrevented,false);assert.equal(h.calls.length,0);
  h.controller.activate();h.controller.activate();
  for(const type of ['dragenter','dragover','dragleave','drop','dragend'])assert.equal(h.bindings.get(type),1,`${type} 仅绑定一次`);
  h.controller.destroy();assert.equal(h.listeners.size,0);
});

test('上传期间拒绝重复拖放，上传失败后可重试',async t=>{
  let rejectUpload;
  const h=dragHarness(async action=>{if(action==='create')return {sessionId:'candidate',ownerToken:'owner'};if(action==='upload')return new Promise((resolve,reject)=>{rejectUpload=reject;});return {};});t.after(()=>h.controller.destroy());
  const first=h.listeners.get('drop')(h.event({files:[{name:'a.xlsx'}]}));
  while(!rejectUpload)await Promise.resolve();
  await h.listeners.get('drop')(h.event({files:[{name:'b.xlsx'}]}));
  const busy=h.event();h.listeners.get('dragover')(busy);assert.equal(busy.dataTransfer.dropEffect,'none');assert.match(h.messages.at(-1),/正在处理/);
  assert.equal(h.calls.filter(x=>x.action==='create').length,1);
  assert.match(h.controller.html(),/lattice-loader/);assert.match(h.controller.html(),/正在上传 Excel/);
  rejectUpload(Error('上传失败'));await first;assert.equal(h.controller.isBusy(),false);assert.match(h.controller.html(),/上传失败/);assert.doesNotMatch(h.controller.html(),/data-status="working"/);
  const retry=h.listeners.get('drop')(h.event({files:[{name:'b.xlsx'}]}));
  while(h.calls.filter(x=>x.action==='upload').length<2)await Promise.resolve();
  rejectUpload(Error('测试结束'));await retry;
  assert.equal(h.calls.filter(x=>x.action==='create').length,2);
});


test('失败的新导入不删除当前会话或改变当前文件名',async t=>{
 const h=dragHarness(async action=>{if(action==='rows')return {rows:[],counts:{total:1,confirmed:1,pending:0},ready:true};if(action==='create')return {sessionId:'new',ownerToken:'new-o'};if(action==='upload')throw Error('损坏的文件');return {};});t.after(()=>h.controller.destroy());
 await h.controller.restoreSession({sessionId:'old',ownerToken:'old-o',filename:'原表.xlsx'});await h.listeners.get('drop')(h.event({files:[{name:'坏表.xlsx'}]}));
 assert.equal(h.controller.inspect().session.sessionId,'old');assert.equal(h.controller.inspect().candidate,null);assert.ok(!h.calls.some(c=>c.action==='discard'&&c.payload.sessionId==='old'));assert.match(h.controller.html(),/一键导出 Excel/);
});
test('切换工作区后迟到的分页响应不得回填',async t=>{
 let resolve;const h=dragHarness(async action=>{if(action==='rows')return new Promise(r=>resolve=r);return {};});t.after(()=>h.controller.destroy());
 h.controller.refreshContext({workspaceId:'a',storageEpoch:0});const restoring=h.controller.restoreSession({sessionId:'old',ownerToken:'o'});h.controller.refreshContext({workspaceId:'b',storageEpoch:0});resolve({ready:true,rows:[],counts:{total:1}});await restoring;assert.equal(h.controller.inspect().session,null);assert.doesNotMatch(h.controller.html(),/已自动识别完成/);
});
