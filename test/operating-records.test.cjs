const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js');
test('超长日期范围保留全部真实记录，不生成误导性的部分未记录日期',()=>{
 const O=require('../public/operating-records.js'),s=seed(),p=s.plans[0];record(s,p,'2026-09-01',100,400);
 const f={planId:p.id,from:'2000-01-01',to:'2026-09-03',unit:'month'};
 assert.equal(O.dailyRows(s,f).length,1);
 assert.match(O.page(s,f),/日期跨度超过 4000 天，仅列出已有记录/);
 assert.equal(O.summary(s,f).gmv,400);
});
function seed(){const s=M.seed();s.records=[];return s;}
function record(s,plan,date,spend,gmv){const frame=M.makeFrame(s,plan);Object.assign(frame.plan.params,{spend,actualRoi:99,revenueInput:'amount',actualGmv:gmv});return M.confirmRecord(s,{frame,date});}
test('经营记录按明确成交金额计算，零广告也可记录，原试算和旧账保持不变',()=>{
 const s=seed(),p=s.plans[0],before=M.clone(s.plans);const h=record(s,p,'2026-09-01',0,500);
 assert.equal(h.result.gmv,500);assert.ok(h.result.orders>0);assert.equal(h.result.investment+h.result.profit,500*M.refundMetrics(h.frame.plan.params).paidRatio);assert.deepEqual(s.plans,before);assert.ok(M.validateBackup(s));
 const old=M.makeFrame(s,p);Object.assign(old.plan.params,{spend:100,actualRoi:4});const result=M.calculate(old,old.plan);assert.equal(result.gmv,400);assert.equal(old.plan.params.revenueInput,undefined);
});
test('空白与非法成交金额拒绝入账，零成交保留广告亏损',()=>{
 const s=seed(),p=s.plans[0];for(const value of ['',-1,Infinity,'500'])assert.throws(()=>record(s,p,'2026-09-01',100,value));
 const h=record(s,p,'2026-09-01',100,0);assert.equal(h.result.profit,-100);assert.equal(h.result.gmv,0);assert.ok(M.validateBackup(s));
 const bad=M.clone(s);bad.plans[0].params.revenueInput='other';assert.equal(M.validateBackup(bad),false);
});
test('成交金额模式的记录支持更正、冻结校验和 Excel 备份恢复',async()=>{
 const s=seed(),h=record(s,s.plans[0],'2026-09-01',100,500),before=M.clone(h.frame),frame=M.clone(h.frame);frame.plan.params.actualGmv=600;
 const newer=M.confirmRecord(s,{frame,date:h.date,previousId:h.id,reason:'核对成交金额'});assert.equal(M.ledger(s).gmv,600);assert.deepEqual(h.frame,before);assert.equal(newer.result.gmv,600);
 const W=require('../public/workbook.js');const restored=await W.importWorkbook(await W.exportWorkbook(s));assert.deepEqual(restored.records,s.records);
});
test('经营汇总按总成交除以总广告计算 ROI，仅计有效记录，按 ID 隔离同名计划',()=>{
 const O=require('../public/operating-records.js'),s=seed();s.plans[1].name=s.plans[0].name;record(s,s.plans[0],'2026-09-01',100,600);record(s,s.plans[1],'2026-09-01',300,900);
 const old=record(s,s.plans[0],'2026-09-02',50,250);M.confirmRecord(s,{frame:old.frame,date:old.date,previousId:old.id,reason:'核对'});s.records.push({...M.clone(old),id:'void-extra',status:'void'});
 const a=O.summary(s,{});assert.equal(a.count,3);assert.equal(a.spend,450);assert.equal(a.roi,1750/450);assert.equal(O.groups(s,{},'plan').length,2);assert.equal(O.summary(s,{planId:s.plans[0].id}).gmv,850);
});
test('未记录日期为空，零成交日真实显示零，日期筛选、撤销状态和排序一致',()=>{
 const O=require('../public/operating-records.js'),s=seed(),p=s.plans[0];record(s,p,'2026-09-01',100,0);record(s,p,'2026-09-03',200,800);const f={planId:p.id,from:'2026-09-01',to:'2026-09-03'};
 const rows=O.dailyRows(s,f);assert.equal(rows.length,3);assert.equal(rows[1].missing,true);assert.equal(rows[2].result.gmv,0);const points=O.series(s,{...f,unit:'day'}).points;assert.equal(points[1].spend,null);assert.equal(points[0].spend,100);assert.equal(points[0].profit,-100);assert.throws(()=>O.summary(s,{from:'2026-09-03',to:'2026-09-01'}));
 assert.deepEqual(O.groups(s,f,'plan','profit-asc').map(g=>g.id),[p.id]);
});
test('金额和 ROI 口径在 600 组费用、退款及投入组合下相互一致，满足资金恒等式',()=>{
 const s=seed(),p=s.plans[0];let random=1234567;const next=()=>((random=(random*1664525+1013904223)>>>0)/2**32);
 for(let i=0;i<600;i++){
  const frame=M.makeFrame(s,p),q=frame.plan.params,spend=Math.round(next()*100000)/100,gmv=Math.round(next()*1000000)/100;
  Object.assign(q,{spend:spend||1,actualRoi:gmv/(spend||1),fee:next()*10,tax:next()*8,recovery:next()*100,other:next()*2,returnCost:next()*5,otherFeeScope:i%2?'all':'shipped',refundRates:{unshipped:next()*15,shippedOnly:next()*10,returnRefund:next()*20,firstHour:''}});
  const roi=M.calculate(frame,frame.plan);Object.assign(q,{revenueInput:'amount',actualGmv:gmv});const direct=M.calculate(frame,frame.plan);
  assert.equal(direct.valid,true);assert.ok(Math.abs(direct.gmv-gmv)<1e-8);assert.ok(Math.abs(direct.profit-roi.profit)<1e-7);assert.ok(Math.abs(direct.investment+direct.profit-direct.receivedSales)<1e-7);
 }
});
test('总账筛选已删除计划时不会生成补记入口，更正前版本不影响汇总',()=>{
 const O=require('../public/operating-records.js'),s=seed(),p=s.plans[0];record(s,p,'2026-09-01',100,400);p.deleted=true;
 const f={planId:p.id,from:'2026-09-01',to:'2026-09-03',includeOld:true};const html=O.page(s,f,{all:true,group:'records'});
 assert.doesNotMatch(html,/data-action="entry-date"/);assert.match(html,/data-filter="includeOld"/);assert.equal(O.groups(s,f)[0].deleted,true);assert.equal(O.summary(s,f).count,1);
});
test('总账汇总与各店铺、计划及每日合计一致，零广告分母显示空值',()=>{
 const O=require('../public/operating-records.js'),s=seed();for(let i=0;i<40;i++){const p=s.plans[i%s.plans.length];record(s,p,`2026-08-${String(Math.floor(i/s.plans.length)+1).padStart(2,'0')}`,i%7?i*13:0,i*51);}
 const f={from:'2026-08-04',to:'2026-08-12'},sum=O.summary(s,f);for(const kind of ['plan','shop'])for(const field of ['spend','gmv','profit','count'])assert.ok(Math.abs(O.groups(s,f,kind).reduce((n,g)=>n+g[field],0)-sum[field])<1e-7);
 const empty=O.summary(s,{from:'2026-09-01'});assert.equal(empty.roi,null);assert.equal(empty.count,0);assert.throws(()=>O.dailyRows(s,{from:'bad'}));
});
test('更正草稿保留原记录编号，取消录入不改试算和已记录数据',()=>{
 const {appHarness}=require('./app-harness.cjs'),s=seed(),p=s.plans[0];s.active=p.id;s.activeShop=p.shopId;const h=record(s,p,'2026-09-01',100,500),ui=appHarness(s).ui,before=M.clone(s);
 ui.startEntry(h);ui.modal.frame.plan.params.actualGmv=900;
 const draft=JSON.parse(ui.modalValue());assert.equal(draft.previousId,h.id);assert.equal(draft.frame.plan.params.actualGmv,900);ui.close(true);assert.deepEqual(ui.state,before);
 ui.startEntry(null,h.date);assert.equal(ui.modal.type,'record-detail');assert.equal(ui.modal.id,h.id);
});
test('未填写完整退款参数时，收起细则也不能入账或补成零',()=>{
 const s=seed(),frame=M.makeFrame(s,s.plans[0]);Object.assign(frame.plan.params,{spend:100,revenueInput:'amount',actualGmv:500});frame.plan.params.refundRates.unshipped='';
 assert.equal(M.calculate(frame,frame.plan).valid,false);assert.throws(()=>M.confirmRecord(s,{frame,date:'2026-09-01'}));assert.equal(s.records.length,0);
});
