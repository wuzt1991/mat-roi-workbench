const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js'),W=require('../public/workbook.js'),T=require('../public/transfer.js'),Excel=require('../public/assets/exceljs.min.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function sample(){const s=M.seed();s.records=[];const p=s.plans[0];p.shippingId='shipping-tier';p.items[0].weight=.5;p.items[1].weight=.8;M.confirmRecord(s,{frame:M.makeFrame(s,p),date:'2026-09-01'});return s;}

test('以 g 输入能命中原有运费分档和首续重边界，小数及空白正确转换',()=>{
  const s=M.seed(),tier=s.shippingTemplates.find(t=>t.id==='shipping-tier'),step=s.shippingTemplates.find(t=>t.id==='shipping-step');
  assert.equal(M.toGrams(.5),500);assert.equal(M.toGrams(.123456),123.456);assert.equal(M.toGrams(''),'');assert.equal(M.fromGrams(''),'');
  close(M.shippingCost(tier,M.fromGrams(500)).value,1.35);close(M.shippingCost(tier,M.fromGrams(500.1)).value,1.8);
  close(M.shippingCost(step,M.fromGrams(1000)).value,2);close(M.shippingCost(step,M.fromGrams(1000.1)).value,2.8);
  close(M.shippingCost(step,M.fromGrams(1500)).value,2.8);close(M.shippingCost(step,M.fromGrams(1500.1)).value,3.6);
  assert.equal(M.shippingCost(tier,M.fromGrams(2000.1)).value,null);assert.equal(M.shippingCost(tier,M.fromGrams('')).value,null);
});
test('g 单位的重量档和首续重规则按原计价换算，费用不乘以 1000',()=>{
  const tier={id:'gram-tier',name:'克数分档',active:true,type:'tiers',tiers:[{upTo:M.fromGrams(450),fee:1.3},{upTo:M.fromGrams(900),fee:1.8}]};
  const step={id:'gram-step',name:'克数续重',active:true,type:'step',firstWeight:M.fromGrams(300),firstFee:1.4,stepWeight:M.fromGrams(100),stepFee:.25,maxWeight:M.fromGrams(2000)};
  assert.ok(M.validTemplate(tier));assert.ok(M.validTemplate(step));close(M.shippingCost(tier,M.fromGrams(500)).value,1.8);close(M.shippingCost(step,M.fromGrams(450)).value,1.9);close(M.shippingCost(step,M.fromGrams(500)).value,1.9);close(M.shippingCost(step,M.fromGrams(500.1)).value,2.15);
});
test('规格列顺序独立保存，全部隐藏也不会改变当前或历史计算',()=>{
  const s=sample(),expected=M.calculate(s,s.plans[0]),records=M.clone(s.records),metrics=M.clone(s.prefs.ids);
  assert.deepEqual(M.skuColumns(s),M.defaultSkuColumns);s.prefs.skuColumns=['cost','roi','weight'];assert.ok(M.validateBackup(s));assert.deepEqual(M.skuColumns(M.migrate(JSON.parse(JSON.stringify(s)))),['cost','roi','weight']);
  s.prefs.skuColumns=[];assert.ok(M.validateBackup(s));assert.deepEqual(M.skuColumns(s),[]);assert.deepEqual(M.calculate(s,s.plans[0]),expected);assert.deepEqual(s.records,records);assert.deepEqual(s.prefs.ids,metrics);
  for(const invalid of [['cost','cost'],['unknown'],null,'cost']){s.prefs.skuColumns=invalid;assert.equal(M.validateBackup(s),false);}
});
test('新版 Excel 规格、入账规格和全部运费重量都显示 g，恢复不改冻结数据',async()=>{
  const s=sample();s.prefs.skuColumns=['cost','roi','shipping','weight'];const original=M.clone(s),before=JSON.parse(JSON.stringify(s)),bytes=await W.exportWorkbook(s),book=new Excel.Workbook();await book.xlsx.load(bytes);
  assert.equal(book.getWorksheet('商品规格').getCell('F1').value,'发货重量（g）');assert.equal(book.getWorksheet('商品规格').getCell('F2').value,500);
  assert.equal(book.getWorksheet('入账规格').getCell('K1').value,'发货重量（g）');assert.equal(book.getWorksheet('入账规格').getCell('K2').value,500);
  const freight=book.getWorksheet('运费模板');assert.equal(freight.getCell('D3').value,500);assert.equal(freight.getCell('E3').value,1.35);assert.equal(freight.getCell('F6').value,1000);assert.equal(freight.getCell('H6').value,500);
  const visible=book.worksheets.filter(s=>s.name!=='恢复数据').flatMap(s=>s.getSheetValues()).flat(2).filter(v=>typeof v==='string');assert.ok(visible.every(v=>!v.includes('kg')));
  const settings=book.getWorksheet('显示设置').getSheetValues().filter(Boolean).slice(1).map(row=>row.slice(1));assert.ok(settings.some(row=>row[0]==='商品规格'&&row[1]===1&&row[2]==='每单总成本'));assert.ok(settings.some(row=>row[2]==='售价'&&row[3]==='否'));
  assert.deepEqual(await W.importWorkbook(bytes),before);assert.deepEqual(s,original);
});
test('v0.5 和 v0.6 的 kg 备份仍能恢复，转导出只换可见单位',async()=>{
  const s=sample(),before=JSON.parse(JSON.stringify(s));for(const format of [1,2]){
    const old=new Excel.Workbook();for(const [name,rows] of W.tables(s,format))old.addWorksheet(name).addRows(rows);
    const data=old.addWorksheet('恢复数据');data.addRow(['MAT-ROI-XLSX',format]);data.addRow([0,JSON.stringify(s)]);
    assert.equal(old.getWorksheet('商品规格').getCell('I2').value,.5);
    const restored=await W.importWorkbook(await old.xlsx.writeBuffer());assert.deepEqual(restored,before);
    const next=await W.importWorkbook(await W.exportWorkbook(restored));assert.deepEqual(next,before);close(next.records[0].result.profit,s.records[0].result.profit);
  }
});
test('修改可读表的 g 重量会拒绝恢复，按范围备份保留列设置',async()=>{
  const s=sample();s.prefs.skuColumns=['roi','cost'];const scoped=T.select(s,{mode:'scoped',shopIds:[s.shops[0].id],planIds:[s.plans[0].id]}),book=new Excel.Workbook();const bytes=await W.exportWorkbook(scoped);
  assert.deepEqual((await W.importWorkbook(bytes)).prefs.skuColumns,['roi','cost']);await book.xlsx.load(bytes);book.getWorksheet('入账规格').getCell('K2').value=501;
  await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/改动/);
});

test('新版计划页保存退款类型、早期退款率空值和其他费用范围',async()=>{
  const s=sample(),p=s.plans[0];
  p.params.refundRates={unshipped:12,shippedOnly:3,returnRefund:7,firstHour:''};
  p.params.otherFeeScope='all';
  const before=JSON.parse(JSON.stringify(s)),book=new Excel.Workbook();
  await book.xlsx.load(await W.exportWorkbook(s));
  const plan=book.getWorksheet('计划');
  assert.deepEqual(plan.getRow(1).values.slice(1),[
    '店铺','计划','状态','材料','运费模板','广告消耗（元）','支付ROI','退款率（兼容）（%）',
    '未发货仅退款率（%）','已发货仅退款率（%）','退货退款率（%）','1 小时内退款率（%）','其他费用发生范围',
    '平台费（%）','税率（%）','回收比例（%）','其他费用（元/单）','每退货单额外费用（元）','整体支付 ROI 保本线','预估盈亏（元）','备注'
  ]);
  assert.equal(plan.getCell('I2').value,12);
  assert.equal(plan.getCell('J2').value,3);
  assert.equal(plan.getCell('K2').value,7);
  assert.equal(plan.getCell('L2').value,'');
  assert.equal(plan.getCell('M2').value,'all');
  assert.deepEqual(await W.importWorkbook(await book.xlsx.writeBuffer()),before);
});
