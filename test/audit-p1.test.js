const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public/domain.js');
const P=require('../public/product-transfer.js');
const T=require('../public/transfer.js');
const W=require('../public/workbook.js');
const {appHarness}=require('./app-harness.cjs');
function editMaterial(s,name='水晶绒'){const h=appHarness(s),m=s.materials.find(m=>m.name===name);h.ui.open('material',{id:m.id,draft:{...M.clone(m),note:''}});return {...h,m};}
test('P1 编辑材料保留隐藏变体，同价备注也成为报价记录',()=>{
  const s=M.initialState(),{ui,m}=editMaterial(s),variant=M.clone(m.weightRules.find(r=>r.variant)),count=m.history.length;
  ui.modal.draft.note='已确认含税运费';ui.saveModal();
  const saved=ui.state.materials.find(x=>x.id===m.id);assert.deepEqual(M.clone(saved.weightRules.find(r=>r.variant)),variant);assert.equal(saved.history.length,count+1);assert.equal(saved.history.at(-1).note,'已确认含税运费');
});
test('P1 UI 和备份拒绝规范化同名材料，并保留编辑内容',()=>{
  const s=M.initialState(),{ui,m}=editMaterial(s);ui.modal.draft.name=' 硅 藻泥　';ui.saveModal();
  assert.equal(m.name,'水晶绒');assert.equal(ui.modal.type,'material');
  const duplicate=M.clone(s.materials.find(m=>m.name==='硅藻泥'));duplicate.id='another-material';duplicate.name=' 硅 藻泥　';s.materials.push(duplicate);assert.equal(M.validateBackup(s),false);
});
test('P1 内置材料重命名后多次迁移不补回旧名，旧规则身份也可识别',()=>{
  for(const legacy of [false,true]){const s=M.initialState(),m=s.materials.find(m=>m.name==='硅藻泥'),count=s.materials.length;
    if(legacy){delete m.builtinKey;m.id='legacy-material';s.plans[0].materialId=m.id;}
    m.name='吸水定制材料';const next=M.migrate(M.migrate(s));assert.equal(next.materials.length,count);assert.equal(next.materials.some(m=>m.name==='硅藻泥'),false);assert.ok(M.validateBackup(next));
  }
});
test('P1 厚度非数字在保存前被拒绝且没有修改材料',()=>{
  const s=M.initialState(),{ui,m}=editMaterial(s),before=M.clone(m);ui.modal.draft.weightRules[0].thickness='abc';ui.saveModal();
  assert.deepEqual(m,before);assert.equal(ui.modal.type,'material');
});
test('P1 重量入口始终可达，自动重量加包装，手动总重不重复加包装',()=>{
  const s=M.initialState(),p=s.plans[0];p.materialId=s.materials.find(m=>m.name==='硅藻泥').id;p.items=[{id:'item-test',sizeId:s.sizes[1].id,price:20,share:100,weight:'',priceMode:'plan',sales:null,productId:'',skuId:''}];p.packagingWeight=.1;
  const {ui}=appHarness(s);let r=M.calculate(s,p);assert.ok(Math.abs(r.rows[0].weight-.316)<1e-12);assert.match(ui.skuTable(r),/data-action="sku-settings"/);assert.doesNotMatch(ui.skuTable(r),/data-action="weight"/);
  p.items[0].weight=.5;r=M.calculate(s,p);assert.equal(r.rows[0].weight,.5);
  p.packagingWeight=-1;assert.equal(M.calculate(s,p).valid,false);assert.equal(M.validateBackup(s),false);
});
test('P1 同名但不同报价的合并资源独立命名，重复导入不增加副本',()=>{
  const s=M.seed(),incoming=M.clone(s);incoming.materials[0].price+=1;
  const first=T.merge(s,incoming,{restorePlans:true});assert.ok(M.validateBackup(first.state));
  assert.equal(new Set(first.state.materials.map(m=>m.name)).size,first.state.materials.length);
  assert.equal(T.merge(first.state,incoming).state.materials.length,first.state.materials.length);
});
test('P1 缺售价或库存复核可修复，零值保留，字段错误不会滞留',()=>{
  const rows=[['店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],['店','硅藻泥','40x60','p','s','','在售','abc']];
  const r=P.transformRows(rows),reviewed=P.applyReviews(r,{2:{price:0,inventory:0}});assert.equal(reviewed.summary.ready,true);assert.equal(reviewed.rows[0].values[19],0);assert.equal(reviewed.rows[0].values[21],0);
  assert.equal(P.applyReviews(reviewed,{2:{price:-1}}).summary.ready,false);
});
test('P1 Excel 区域模板正确列出费率，兼容退款率取三类合计',async()=>{
  const s=M.initialState();s.plans[0].params.refundRates={unshipped:3,shippedOnly:4,returnRefund:5,firstHour:''};
  const tables=Object.fromEntries(W.tables(s));assert.equal(tables['计划'][1][7],12);
  const rows=tables['运费模板'].slice(1);assert.equal(rows[0][1],'区域重量分档');assert.equal(rows[0][3],300);assert.equal(rows[0][4],1.45);assert.ok(rows.some(r=>r[9].includes('偏远')));
  assert.deepEqual(await W.importWorkbook(await W.exportWorkbook(s)),s);
});
