const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public/domain.js'),Legacy=require('../public/legacy-domain.js'),W=require('../public/workbook.js'),Excel=require('../public/assets/exceljs.min.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const day=M.today();
function daily(s,plan=s.plans[0]){return M.confirmRecord(s,{frame:M.makeFrame(s,plan),date:day,note:'测试入账'});}

test('常规使用商品长宽，异形仅按生产尺寸计成本，销售尺寸不影响成本',()=>{
  const s=M.seed(),p=s.plans[0],size=s.sizes[0];
  close(M.calculate(s,p).rows[0].material,.12*10.2);
  Object.assign(size,{irregular:true,productionW:25,productionH:35});
  close(M.calculate(s,p).rows[0].material,.0875*10.2);
  size.salesW=999;size.salesH=888;close(M.calculate(s,p).rows[0].material,.0875*10.2);
  size.productionW='';assert.equal(M.calculate(s,p).valid,false);
});
test('固定运费、重量分档边界和续重向上进位',()=>{
  const s=M.seed(),[fixed,tier,step]=s.shippingTemplates;
  close(M.shippingCost(fixed,'').value,1.35);
  close(M.shippingCost(tier,.5).value,1.35);close(M.shippingCost(tier,.50001).value,1.8);
  close(M.shippingCost(tier,1).value,1.8);close(M.shippingCost(tier,2).value,2.8);
  assert.equal(M.shippingCost(tier,2.00001).value,null);assert.equal(M.shippingCost(tier,'').value,null);
  close(M.shippingCost(step,1).value,2);close(M.shippingCost(step,1.001).value,2.8);
  close(M.shippingCost(step,1.5).value,2.8);close(M.shippingCost(step,1.50001).value,3.6);
  Object.assign(step,{firstWeight:.1,stepWeight:.1});close(M.shippingCost(step,.3).value,3.6);
  assert.equal(M.validTemplate({...tier,tiers:[{upTo:1,fee:2},{upTo:1,fee:3}]}),false);
  assert.equal(M.validTemplate({...step,maxWeight:.01}),false);
});
test('按 SKU 重量分别算运费再加权，独立核对 100 个订单成本和利润',()=>{
  const s=M.seed(),p=s.plans[0];p.shippingId=s.shippingTemplates[1].id;p.items[0].weight=.4;p.items[1].weight=.8;
  const r=M.calculate(s,p),sales=20*4.19+80*8.99,goods=20*.12*10.2+80*.24*10.2,ship=20*1.35+80*1.8;
  assert.ok(r.valid);close(r.shipping,ship/100);close(r.cost,(goods+ship+sales*.9*.07)/100);
  close(r.roi,sales/(sales*.9-goods-ship-sales*.9*.07));
  close(r.profit,3000*(sales*.9-goods-ship-sales*.9*.07)/sales-1000);
  close(r.investment,1000+r.orders*r.cost);close(r.gmv*.9-r.investment,r.profit);
});
test('缺少重量、无效占比、超大数字不可入账，草稿保持可保存',()=>{
  const s=M.seed(),p=s.plans[0];p.shippingId=s.shippingTemplates[1].id;
  assert.ok(!M.calculate(s,p).valid);assert.throws(()=>daily(s));
  p.items.forEach(i=>i.weight=.4);p.items[0].share='';assert.ok(M.validateBackup(s));assert.throws(()=>daily(s));
  p.items[0].share=20;p.params.spend=1e308;assert.ok(!M.calculate(s,p).valid);assert.ok(!M.validateBackup(s));
  p.params.spend='';assert.equal(M.calculate(s,p).profit,null);assert.ok(M.validateBackup(s));
});
test('工作台按固定材质重量系数推导运费重量，未配置材料仍要求手填',()=>{
  const s=M.seed(),p=s.plans[0],size=s.sizes[0];
  s.materials[0].name='丝圈';p.shippingId=s.shippingTemplates[1].id;
  assert.equal(M.derivedWeight(size,s.materials[0],p.items[0]),.12*2.8);
  s.materials[0].name='硅藻泥基础料';
  assert.equal(M.derivedWeight(size,s.materials[0],p.items[0]),'');
});
test('中通区域运费按表格重量区间计费且忽略面单费，净 ROI 排除一小时退款',()=>{
  const t=M.regionalShippingTemplate();
  close(M.shippingCost(t,.3,'天津').value,1.45);
  close(M.shippingCost(t,.4,'福建省').value,1.65);
  close(M.shippingCost(t,5.1,'天津').value,5.4);
  close(M.shippingCost(t,1.2,'海南省').value,13);
  const s=M.seed(),p=s.plans[0];s.materials[0].name='丝圈';p.params.refundRates={unshipped:2,shippedOnly:3,returnRefund:5,firstHour:1};
  const r=M.calculate(s,p);assert.ok(r.valid);assert.ok(Number.isFinite(r.netRoi));assert.ok(r.netRoi<r.roi);
});
test('只有确认入账计入合计，删除计划和变更当前报价不改变旧账',()=>{
  const s=M.seed(),p=s.plans[0];assert.equal(M.ledger(s).count,0);
  const h=daily(s),profit=h.result.profit,frame=JSON.stringify(h.frame);
  p.deleted=true;s.materials[0].price=90;s.sizes[0].salesW=200;s.shippingTemplates[0].fee=9;p.params.refund=80;
  close(M.ledger(s).profit,profit);assert.equal(JSON.stringify(h.frame),frame);assert.ok(M.validateBackup(s));
  assert.equal(M.ledger(s,{shopId:s.shops[1].id}).count,0);assert.equal(M.ledger(s,{shopId:p.shopId,planId:p.id}).count,1);
});
test('入账使用手动选定的当期成本，不按调价日期自动覆盖',()=>{
  const s=M.seed(),frame=M.makeFrame(s,s.plans[0]);s.materials[0].price=50;frame.materials[0].price=10.92;frame.shippingTemplates[0].fee=1.6;
  const h=M.confirmRecord(s,{frame,date:day});close(h.frame.materials[0].price,10.92);
  close(h.result.profit,M.calculate(frame,frame.plan).profit);assert.ok(M.validateBackup(s));
  close(s.shippingTemplates[0].fee,1.35);close(h.frame.shippingTemplates[0].fee,1.6);
});
test('更正从冻结快照开始，旧记录保留但不再重复累计；更正原因必填',()=>{
  const s=M.seed(),original=daily(s),before=JSON.stringify(original.frame);s.materials[0].price=50;
  const frame=M.clone(original.frame);frame.plan.params.refund=15;
  assert.throws(()=>M.confirmRecord(s,{frame,date:day,previousId:original.id,reason:''}),/原因/);
  const corrected=M.confirmRecord(s,{frame,date:day,previousId:original.id,reason:'实际退货率更新'});
  assert.equal(original.status,'superseded');assert.equal(JSON.stringify(original.frame),before);
  assert.equal(M.ledger(s).count,1);close(M.ledger(s).profit,corrected.result.profit);
  assert.equal(M.ledger(s,{includeOld:true}).rows.length,4);assert.ok(M.validateBackup(s));
  assert.throws(()=>M.confirmRecord(s,{frame,date:day,previousId:original.id,reason:'重复更正'}));
});
test('日期、重复入账、作废后补记和店铺筛选',()=>{
  const s=M.seed(),h=daily(s);assert.throws(()=>daily(s),/已入账/);
  assert.throws(()=>M.confirmRecord(s,{frame:M.makeFrame(s,s.plans[0]),date:'2999-01-01'}));
  assert.throws(()=>M.confirmRecord(s,{frame:M.makeFrame(s,s.plans[0]),date:'2026-02-30'}));
  h.status='void';daily(s);daily(s,s.plans[1]);assert.equal(M.ledger(s).count,2);
  assert.equal(M.ledger(s,{shopId:s.shops[1].id}).count,1);assert.equal(M.ledger(s,{from:'2000-01-01',to:'2000-01-02'}).count,0);
  assert.ok(M.validateBackup(s));
});
test('旧版迁移保留账目，异形缺生产尺寸标记待填，厚度估算需核对报价',()=>{
  const old=Legacy.seed(),p=old.plans[0];p.history.push(Legacy.createRecord(old,p,day));
  old.sizes[0].thickness=3;old.materials[0].baseThickness=2;
  old.sizes[1]={...old.sizes[1],shape:'irregular',name:'云朵',areaMode:'area',area:.2,factor:1.1};
  const s=M.migrate(old);assert.equal(s.plans[0].needsMaterialReview,true);assert.equal(s.sizes[1].needsReview,true);
  assert.equal(s.sizes[1].productionW,'');assert.equal(s.records.at(-1)?.kind,'snapshot');
  close(M.ledger(s).profit,p.history.at(-1).profit);assert.ok(M.validateBackup(s));
});
test('篡改冻结盈亏或运费模板会被备份校验拒绝',()=>{
  const s=M.seed(),h=daily(s);assert.ok(M.validateBackup(s));h.result.profit+=1;assert.equal(M.validateBackup(s),false);
  h.result.profit-=1;h.frame.shippingTemplates[0].fee=9;assert.equal(M.validateBackup(s),false);
});
test('预算变化时总投入和利润按相同假设联动，包括负利润及零投入',()=>{
  const s=M.seed(),p=s.plans[0];const a=M.calculate(s,p),b=M.calculate(s,p,{spend:2000}),zero=M.calculate(s,p,{spend:0});
  close(b.profit,a.profit*2);close(b.investment,a.investment*2);close(zero.profit,0);close(zero.investment,0);
  p.params.actualRoi=1;assert.ok(M.calculate(s,p).profit<0);assert.ok(M.calculate(s,p,{spend:2000}).profit<M.calculate(s,p).profit);
  assert.equal(M.ceilRoi(2.5348),2.54);
});
test('Excel 完整往返，运营工作表可读，带更正链、隐藏恢复数据和显示顺序',async()=>{
  const s=M.seed(),h=daily(s),frame=M.clone(h.frame);frame.plan.params.refund=12;
  M.confirmRecord(s,{frame,date:day,previousId:h.id,reason:'实退更新'});s.prefs.ids=['profit','investment','cost','roi'];
  const bytes=await W.exportWorkbook(s),restored=await W.importWorkbook(bytes);
  assert.deepEqual(restored,JSON.parse(JSON.stringify(s)));const book=new Excel.Workbook();await book.xlsx.load(bytes);
  assert.equal(book.getWorksheet('历史账目').getCell('A1').value,'记录编号');
  assert.equal(book.getWorksheet('恢复数据').state,'veryHidden');assert.equal(book.getWorksheet('运费模板').rowCount,6);
  assert.ok(book.getWorksheet('商品规格').rowCount>1);
});
test('Excel 人工改动或缺失恢复页会明确拒绝，避免可见数据和恢复数据不一致',async()=>{
  const s=M.seed(),book=new Excel.Workbook();await book.xlsx.load(await W.exportWorkbook(s));
  book.getWorksheet('材料').getCell('C2').value=999;
  await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/改动/);
  book.removeWorksheet(book.getWorksheet('恢复数据').id);await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/完整/);
});
test('Excel 将名称当文本保存，公式样式的名称不会变成公式',async()=>{
  const s=M.seed();s.shops[0].name='=HYPERLINK("https://example.invalid","文字")';
  const book=new Excel.Workbook();await book.xlsx.load(await W.exportWorkbook(s));
  assert.equal(typeof book.getWorksheet('店铺').getCell('A2').value,'string');
});
test('总账范围导出仅包含指定店铺，同时可用于恢复',async()=>{
  const s=M.seed();daily(s);daily(s,s.plans[1]);const book=new Excel.Workbook();
  await book.xlsx.load(await W.exportLedgerWorkbook(s,{shopId:s.shops[1].id}));
  const rows=book.getWorksheet('历史账目');assert.equal(rows.rowCount,3);assert.equal(rows.getCell('C3').value,s.shops[1].name);
  close(book.getWorksheet('导出范围').getCell('B8').value,M.ledger(s,{shopId:s.shops[1].id}).profit);
  const restored=await W.importWorkbook(await book.xlsx.writeBuffer());assert.equal(restored.shops.length,1);assert.equal(M.ledger(restored).count,1);
});
