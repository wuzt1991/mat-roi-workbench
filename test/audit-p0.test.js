const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public/domain.js');
const P=require('../public/product-transfer.js');
const W=require('../public/workbook.js');
const {appHarness}=require('./app-harness.cjs');
const headers=['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'];
const source=(spec='40x60cm',price=20,inventory=5,name='硅藻泥')=>[headers,['淘宝','测试店',name,spec,'product','sku',price,'在售',inventory]];
function costState(){const s=M.initialState(),p=s.plans[0];p.materialId=s.materials.find(m=>m.name==='硅藻泥').id;p.items=[{sizeId:s.sizes[1].id,price:30,share:100,weight:''}];p.params.spend=100;p.params.actualRoi=3;return s;}

test('P0-1 入账实际报价经 UI 改价后决定冻结成本、利润及 Excel',async()=>{
  const s=costState(),{ui,dispatch}=appHarness(s);ui.startEntry();
  const before=M.calculate(ui.modal.frame,ui.modal.frame.plan);
  await dispatch('input',{type:'number',value:'109.50',dataset:{},matches:selector=>selector==='[data-entry-price]'});
  const f=ui.modal.frame,after=M.calculate(f,f.plan);
  assert.equal(after.rows[0].material,.24*109.5);
  assert.ok(after.cost>before.cost);assert.ok(after.profit<before.profit);
  const record=M.confirmRecord(s,ui.modal),tables=Object.fromEntries(W.tables(s));
  assert.equal(record.frame.materials[0].price,109.5);
  assert.equal(tables['历史账目'][1][6],109.5);
  assert.equal(tables['入账规格'][1][9],.24*109.5);
  assert.equal(s.materials.find(m=>m.id===f.plan.materialId).price,9.5);
  assert.ok(M.validateBackup(s));
  const restored=await W.importWorkbook(await W.exportWorkbook(s));
  assert.equal(restored.records[0].result.profit,record.result.profit);
});
test('P0-2 公共材料经真实转表适配器保留包边变体',()=>{
  const {ui}=appHarness();const r=P.transformRows(source('80x120 包边',39.9,5,'水晶绒'),{rules:ui.transferRules()});
  assert.equal(r.summary.ready,true);assert.ok(Math.abs(r.rows[0].values[11]-.672)<1e-12);assert.equal(r.rows[0].values[12],8.64);
});
test('P0-3 长宽单位转为 cm，支持双单位、中文、大小写和空白',()=>{
  for(const spec of ['400x600mm','0.4x0.6m','40 x 60 CM','400毫米×600毫米','0.4 米 × 0.6 米','40 厘米 * 60 厘米','400 MM x 600 MM','40x60','400mm x 60cm']){
    const d=P.parseDimensions(spec);assert.equal(d.ok,true,spec);assert.equal(d.area,.24,spec);assert.equal(d.width,40,spec);assert.equal(d.length,60,spec);
  }
});
test('P0-4 无效售价库存进入复核且不能导出，合法边界可用',async()=>{
  for(const field of ['price','inventory'])for(const bad of ['abc',-1,Infinity,'Infinity',1e100,1e12+1]){
    const r=P.transformRows(source('40x60',field==='price'?bad:20,field==='inventory'?bad:5));
    assert.equal(r.summary.ready,false,`${field}: ${bad}`);
    assert.ok(r.exceptions[0].issues.some(i=>i.field===field));
    assert.equal(P.applyReviews(r,{2:{material:'硅藻泥'}}).summary.ready,false);
    await assert.rejects(()=>P.exportWorkbook(new Uint8Array(),r),/异常/);
  }
  for(const value of [0,1,1e12])assert.equal(P.transformRows(source('40x60',value,value)).summary.ready,true);
});
test('P0-5 负规则成本不能通过备份校验或生成可入账结果',()=>{
  const s=costState(),m=s.materials.find(m=>m.id===s.plans[0].materialId);m.weightRules.find(r=>r.default).costPerSqm=-9;
  assert.equal(M.validateBackup(s),false);assert.equal(M.calculate(s,s.plans[0]).valid,false);
});
test('P0-6 人工复核使用同一厚度或变体规则计算重量与成本',()=>{
  const {ui}=appHarness();
  for(const [spec,name,weight,cost] of [['40x60 5mm','硅藻泥',.24*1.3,.24*11.2],['80x120 包边','水晶绒',.96*.7,.96*9]]){
    const r=P.transformRows(source(spec,20,5,'未知材料'),{rules:ui.transferRules()});
    const reviewed=P.applyReviews(r,{2:{material:name}});assert.equal(reviewed.summary.ready,true);
    assert.equal(reviewed.rows[0].values[11],weight);assert.equal(reviewed.rows[0].values[12],cost);
  }
});
