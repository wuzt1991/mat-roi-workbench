const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
  const page={page:1,pageSize:100,total:1,totalPages:1,revision:2,generation:1,ready:false,counts:{total:1,pending:1,confirmed:0,missingThickness:0},groups:[{groupId:'group-a',platform:'抖音',shop:'测试店铺',productId:'12345678901234',total:1,visible:1,hidden:0,materialState:'mat-a',thicknessState:'mat-a:3.0'}],rows:[{rowId:1,sourceRow:2,groupId:'group-a',raw:['原始数组不用于展示'],review:{materialId:'',sizeId:'',materialRuleId:''},derived:{productName:'吸水地垫',specName:'灰色 40×60cm 3mm',skuId:'SKU-00000001',material:{status:'value',source:'auto',materialId:'mat-a',name:'硅藻泥'},size:{status:'value',source:'auto',width:40,length:60,label:'40*60',area:.24},thickness:{status:'value',source:'auto',materialId:'mat-a',ruleId:'3.0'},weight:.216,cost:2.352,values:Array.from({length:29},(_,i)=>i===19?19.9:i===21?100:null),status:'pending',issues:[{field:'price'}]}}]};
  const controller=UI.create({getState:()=>state,render:()=>{},request:async(action)=>{assert.equal(action,'rows');return page;}});
  await controller.restoreSession({sessionId:'session-a',ownerToken:'owner-a',revision:1});
  const html=controller.html();
  assert.match(html,/吸水地垫/);assert.match(html,/灰色 40×60cm 3mm/);assert.match(html,/123456…1234/);assert.match(html,/¥19\.90/);assert.match(html,/40\*60/);assert.match(html,/value="mat-a" selected/);assert.match(html,/value="3\.0" selected/);
});
