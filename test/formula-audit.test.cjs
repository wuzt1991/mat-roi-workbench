'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js'),P=require('../public/pricing-rules.js'),A=require('../public/promotion-rules.js'),F=require('../public/ui-format.js'),R=require('../public/reusable-rules.js'),W=require('../public/workbook.js'),E=require('../public/assets/exceljs.min.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function sample(){
  const s=M.seed();s.records=[];const p=s.plans[0],mat=s.materials.find(m=>m.id===p.materialId);
  mat.weightRules=[{id:'audit-rule',thickness:3.5,variant:'',costPerSqm:15,coefficient:1,default:true,deleted:false}];
  p.materialRuleId='audit-rule';p.strategyId='';p.items=[{...p.items[0],sizeId:'s1',share:100,price:1000,priceMode:'manual',weight:''}];
  const size=s.sizes.find(x=>x.id==='s1');Object.assign(size,{salesW:40,salesH:60,irregular:false,needsReview:false});
  const ship=s.shippingTemplates.find(x=>x.id===p.shippingId);Object.assign(ship,{type:'fixed',fee:1.45});
  Object.assign(p.params,{spend:100,actualRoi:10,fee:5,tax:2,recovery:0,other:0,returnCost:0,refundRates:{unshipped:0,shippedOnly:0,returnRefund:10,firstHour:''},otherFeeScope:'shipped'});
  s.active=p.id;s.activeShop=p.shopId;return {s,p};
}
test('截图逐项核算：1000 元售价、68.05 成本、三个分母和保本线一致',()=>{
  const {s,p}=sample(),r=M.calculate(s,p),x=r.rows[0];
  assert.equal(F.n(x.grossMargin),'1,232.45');close(x.pricingTotalCost,75.05);close(x.pricingProfit,924.95);close(x.grossMargin,x.pricingProfit/x.pricingTotalCost*100);close(x.material,3.6);close(x.revenue,900);close(x.fees,45);close(x.tax,18);close(x.cost,68.05);close(x.margin,831.95);
  close(x.receivedMargin,831.95/900*100);close(x.contributionRate,83.195);assert.equal(F.roi(x.roi),'1.21');assert.equal(F.roi(x.netRoi),'1.09');
  close(r.investment+r.profit,r.receivedSales);
});
test('100 个支付订单独立逐单列账覆盖 1000 组退款、回收、费用与广告',()=>{
  let n=927;const rand=max=>{n=(1664525*n+1013904223)>>>0;return n%max;};
  for(let k=0;k<1000;k++){
    const {s,p}=sample(),u=rand(101),o=rand(101-u),t=rand(101-u-o),keep=100-u-o-t;
    p.items[0].price=(1+rand(30000))/100;
    Object.assign(p.params,{fee:rand(21),tax:rand(11),recovery:rand(101),other:rand(300)/100,returnCost:rand(1500)/100,otherFeeScope:k%2?'all':'shipped',refundRates:{unshipped:u,shippedOnly:o,returnRefund:t,firstHour:rand(u+o+t+1)}});
    const q=p.params,price=p.items[0].price;let revenue=0,goods=0,shipping=0,other=0;
    for(let order=0;order<100;order++){
      const type=order<u?'unshipped':order<u+o?'only':order<u+o+t?'return':'keep';
      if(type==='keep')revenue+=price;
      if(type!=='unshipped'){shipping+=1.45;goods+=type==='return'?3.6*(1-q.recovery/100):3.6;}
      if(q.otherFeeScope==='all'||type!=='unshipped')other+=q.other;
      if(type==='return')other+=q.returnCost;
    }
    const fees=revenue*q.fee/100,tax=revenue*q.tax/100,cost=goods+shipping+other+fees+tax,margin=revenue-cost;
    const r=M.calculate(s,p);assert.ok(r.valid);for(const [key,value] of Object.entries({revenue,goods,shipping,other,fees,tax,cost,margin}))close(r[key],value/100);
    close(r.profit,r.gmv/(100*price)*margin-q.spend);close(r.investment+r.profit,r.receivedSales);
    if(margin>0){close(r.roi,100*price/margin);close(r.netRoi,revenue/margin);}else {assert.equal(r.roi,null);assert.equal(r.netRoi,null);}
    const before=r; q.refundRates.firstHour='';const after=M.calculate(s,p);close(after.margin,before.margin);assert.equal(after.netRoi,before.netRoi);
    if(keep===0)assert.equal(r.rows[0].receivedMargin,null);
  }
});
test('仅退款不回收货品；全未发货和全退货边界不会凭空盈利',()=>{
  const {s,p}=sample();p.params.recovery=100;
  p.params.refundRates={unshipped:0,shippedOnly:100,returnRefund:0,firstHour:100};let x=M.calculate(s,p).rows[0];close(x.goods,3.6);close(x.cost,5.05);assert.equal(x.netRoi,null);
  p.params.refundRates={unshipped:0,shippedOnly:0,returnRefund:100,firstHour:''};x=M.calculate(s,p).rows[0];close(x.goods,0);close(x.shipping,1.45);assert.equal(x.roi,null);
  p.params.refundRates={unshipped:100,shippedOnly:0,returnRefund:0,firstHour:100};x=M.calculate(s,p).rows[0];close(x.cost,0);close(x.margin,0);assert.equal(x.roi,null);assert.equal(x.receivedMargin,null);
});
test('组合 ROI 按金额汇总，零占比规格不进入分母，广告只扣一次',()=>{
  const {s,p}=sample();p.items=[{...p.items[0],share:20,price:20},{...p.items[0],id:'b',share:80,price:40},{...p.items[0],id:'c',share:0,price:1}];
  const r=M.calculate(s,p);close(r.price,36);close(r.revenue,32.4);close(r.cost,3.6+1.45+32.4*.07);close(r.roi,36/(32.4-r.cost));
  const atBreakEven=M.calculate(s,p,{actualRoi:r.roi});close(atBreakEven.profit,0);
  const rounded=M.calculate(s,p,{actualRoi:M.ceilRoi(r.roi)});assert.ok(rounded.profit>=-1e-8);
});
test('旧 v4 记录保留原回收和净 ROI，新的更正使用新版并保留原账',async()=>{
  const {s,p}=sample();Object.assign(p.params,{recovery:50,refundRates:{unshipped:10,shippedOnly:20,returnRefund:30,firstHour:10}});
  const frame=M.makeFrame(s,p);delete frame.formulaVersion;
  const old=M.confirmRecord(s,{frame,date:'2026-09-01'}),before=JSON.stringify(old);close(old.result.goods,3.6*.65);
  const live=M.calculate(s,p);close(live.goods,3.6*.75);assert.ok(M.validateBackup(s));
  const entries=require('../public/operating-records/entries.js'),draft=entries.start(s,p,old);assert.equal(draft.frame.formulaVersion,5);draft.reason='更正退款回收';
  const next=entries.confirm(s,draft);assert.equal(JSON.stringify(s.records[0]),before);assert.equal(next.records[0].status,'superseded');close(next.records[1].result.goods,2.7);
  assert.deepEqual((await W.importWorkbook(await W.exportWorkbook(next))).records,next.records);
  const tampered=M.clone(next);tampered.records[1].frame.formulaVersion=99;assert.equal(M.validateBackup(tampered),false);
});
test('格式 5/6 旧可读表口径和新格式 8 均可恢复；金额模式不导出陈旧 ROI',async()=>{
  const {s,p}=sample();p.params.recovery=50;p.params.refundRates.shippedOnly=20;p.params.refundRates.firstHour=5;
  for(const format of [5,6]){
    const book=new E.Workbook();for(const [name,rows] of W.tables(s,format))book.addWorksheet(name).addRows(rows);
    book.addWorksheet('恢复数据').addRows([['MAT-ROI-XLSX',format],[0,JSON.stringify(s)]]);
    const restored=await W.importWorkbook(await book.xlsx.writeBuffer());assert.deepEqual(restored,s);
    assert.equal(W.tables(s,format).find(x=>x[0]==='显示设置')[1].some(row=>row.includes('分摊运费')),false);
  }
  Object.assign(p.params,{revenueInput:'amount',actualGmv:500,spend:100,actualRoi:99});
  const tables=W.tables(s);assert.equal(tables.find(x=>x[0]==='计划')[1][1][6],5);
  const sku=tables.find(x=>x[0]==='商品规格')[1];assert.ok(sku[0].includes('退款后结余率（%）'));assert.equal(sku[0][17],'毛利率（利润÷成本，%）');
  assert.deepEqual(await W.importWorkbook(await W.exportWorkbook(s)),s);
});
test('无效退款输入不会显示有效的收入和 ROI；大额合法分价不被浮点误判',()=>{
  const {s,p}=sample();p.params.refundRates.unshipped='';assert.ok(Number.isNaN(M.refundMetrics(p.params).unshipped));const r=M.calculate(s,p);assert.equal(r.valid,false);assert.equal(r.gmv,null);assert.equal(r.roi,null);
  p.params.refundRates.unshipped=0;assert.equal(R.setItemPrice(s,p.id,p.items[0].id,1000000.01).plans[0].items[0].price,1000000.01);assert.throws(()=>R.setItemPrice(s,p.id,p.items[0].id,1.001));
});
test('三类毛利明细和新口径列可见，运费选择明确显示模板实际费率',()=>{
  const {s,p}=sample();s.prefs.skuColumns=['grossMargin','receivedMargin','contributionRate','baseShipping','shipping','cost'];
  const h=require('./app-harness.cjs').appHarness(s),html=h.ui.skuTable(M.calculate(s,p));
  assert.match(html,/1,232.45%/);assert.match(html,/利润 ÷ 成本 × 100%/);assert.doesNotMatch(html,/sku-heading-note/);assert.match(html,/sku-heading/);assert.match(html,/sku-unit/);assert.match(html,/退款后结余率/);assert.match(html,/计算明细/);assert.match(h.ui.skuOptions(),/实际每包 ¥1.45/);
  h.ui.open('calculation-detail');const detail=h.elements.get('#dialog').innerHTML;for(const value of ['¥900.00','¥68.05','¥831.95','83.20%','92.44%','¥75.05','¥924.95','1,232.45%'])assert.ok(detail.includes(value),value);
});
test('折扣和直减逆算满足目标且比前一分钱严格更小，定价向上到分',()=>{
  const scheme={name:'按顺序',steps:[{type:'discount',discount:8.83},{type:'reduction',amount:1.15},{type:'discount',discount:9.5}]};
  for(let cents=1;cents<10000;cents+=37){const target=cents/100,q=A.reverse(target,scheme);assert.equal(q.error,undefined);assert.ok(q.finalPrice>=target);assert.ok(A.forward(Math.round((q.listingPrice-.01)*100)/100,scheme).finalPrice<target);}
  for(let cents=1;cents<2000;cents+=19){const cost=cents/100,q=P.quote(cost,30,5,2);assert.ok(P.actualMargin(cost,q.price,5,2)>=30-1e-10);assert.ok(P.actualMargin(cost,q.price-.01,5,2)<30);}
  assert.equal(F.n(P.actualMargin(5.05,1000,5,2)),'1,232.45');assert.equal(P.actualMargin(5,1000,NaN,2),null);
});
test('大量规格调整占比不将舍入余数压到末行，也不产生负占比',()=>{
  const {s,p}=sample();p.items=Array.from({length:163},(_,i)=>({...p.items[0],id:'share-'+i,share:i===162?0:1}));
  const before=JSON.stringify(s),next=R.normalizeShares(s,p.id),items=next.plans[0].items;
  close(items.reduce((sum,i)=>sum+i.share,0),100);assert.ok(items.every(i=>i.share>=0));assert.equal(items.at(-1).share,0);assert.equal(JSON.stringify(s),before);assert.ok(M.validateBackup(next));
  p.items.forEach(i=>i.share=0);assert.throws(()=>R.normalizeShares(s,p.id),/至少/);
});
test('成本口径毛利支持超过百分百、亏损与零成本，旧记录维持原口径',()=>{
  assert.deepEqual(P.costMarginDetails(10,30),{cost:10,profit:20,rate:200});
  assert.deepEqual(P.costMarginDetails(10,5),{cost:10,profit:-5,rate:-50});
  assert.deepEqual(P.costMarginDetails(0,10),{cost:0,profit:10,rate:null});
  assert.deepEqual(P.costMarginDetails(0,10,10),{cost:1,profit:9,rate:900});
  assert.equal(P.costMarginDetails(10,0).rate,null);
  const {s,p}=sample(),frame=M.makeFrame(s,p);frame.formulaVersion=4;
  const old=M.calculate(frame,frame.plan),live=M.calculate(s,p);
  close(old.rows[0].grossMargin,92.495);close(live.rows[0].grossMargin,924.95/75.05*100);
  close(old.rows[0].price,live.rows[0].price);close(old.roi,live.roi);
});
test('阶梯按成本四舍五入到分，同分同档，边界不受浮点影响',()=>{
  const strategy={type:'rank',tiers:[10,20,30],fallback:40};
  const rows=[1.005,1.004,1.01,1.015].map(pricingCost=>({pricingCost}));
  assert.deepEqual(rows.map(row=>P.target(strategy,row,rows)),[20,10,20,30]);
  assert.equal(P.target(strategy,{pricingCost:9.99},[{pricingCost:9.99}]),10);
});
test('导出重量系数和重量单位一起换算，保留含 kg 的用户名称与说明',async()=>{
  const {s,p}=sample();p.name='5kg 方案';p.note='每包最多 5kg';s.shippingTemplates.push({...M.regionalShippingTemplate(),id:'audit-regional',deleted:false});const mat=s.materials.find(m=>m.id===p.materialId);mat.weightRules[0].coefficient=.96;
  const sheets=W.tables(s),rules=sheets.find(x=>x[0]==='厚度规则')[1];assert.equal(rules[0][5],'重量系数（g/㎡）');assert.equal(rules.find(x=>x[2]==='audit-rule')[5],960);
  const plans=sheets.find(x=>x[0]==='计划')[1];assert.equal(plans[1][1],'5kg 方案');assert.equal(plans[1].at(-1),'每包最多 5kg');
  const freight=sheets.find(x=>x[0]==='运费模板')[1].filter(x=>x[1]==='区域整公斤计费');assert.ok(freight.length);assert.ok(freight.every(x=>x[9].includes('5000 g')));
  assert.deepEqual(await W.importWorkbook(await W.exportWorkbook(s)),s);
});
