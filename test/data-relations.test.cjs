'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../public/domain.js'),P=require('../public/pricing-rules.js'),R=require('../public/reusable-rules.js'),S=require('../public/sales-import.js'),T=require('../public/transfer.js'),W=require('../public/workbook.js'),O=require('../public/operating-records/entries.js'),Q=require('../public/operating-records/queries.js'),{Store}=require('../server/store.cjs'),{appHarness}=require('./app-harness.cjs');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function setup(){
 let s=M.initialState();s.plans=[];s.records=[];const p=M.newPlan(s,s.shops[0].id,'关联审查');s.plans.push(p);s.active=p.id;s.activeShop=p.shopId;
 s=R.addSizes(s,p.id,s.sizes.slice(0,3).map(x=>x.id));const plan=s.plans[0];plan.items.forEach((x,i)=>Object.assign(x,{share:[20,30,50][i],price:20,productId:'000001',skuId:'00000'+i}));
 s.pricingStrategies.push({id:'relation-pricing',name:'成本毛利',type:'uniform',margin:60,deleted:false});plan.strategyId='relation-pricing';
 Object.assign(plan.params,{spend:100,actualRoi:5,fee:5,tax:2,recovery:50,refundRates:{unshipped:10,shippedOnly:15,returnRefund:5,firstHour:2},other:1,returnCost:3});
 const other=s.materials.find(x=>x.id!==plan.materialId&&x.weightRules.length),rule=other.weightRules.find(x=>x.default)||other.weightRules[0];
 Object.assign(plan.items[1],{materialId:other.id,materialRuleId:rule.id});assert.ok(M.validateBackup(s));assert.ok(M.calculate(s,plan).valid);return s;
}
const prices=s=>M.calculate(s,s.plans[0]).rows.map(x=>x.price);
function sales(s){const p=s.plans[0];return S.apply(s,S.prepare(s,p.id,p.items.map((x,i)=>({itemId:x.id,count:i+1})),{period:'2026-09',missingPolicy:'zero'})).state;}

test('默认材料、单规格覆盖、重量和策略联动；手动价、其他计划与冻结账目隔离',()=>{
 let s=setup(),p=s.plans[0];const before=M.calculate(s,p),frame=M.makeFrame(s,p);assert.deepEqual(M.summarize(M.calculate(frame,frame.plan)),M.summarize(before));
 s=O.confirm(s,{frame,date:'2026-09-01',note:''});const history=M.clone(s.records),ledger=Q.summary(s),manualId=s.plans[0].items[2].id;
 s=R.setItemPrice(s,p.id,manualId,99);p=s.plans[0];const mat=M.clone(s.materials.find(x=>x.id===p.materialId));M.materialRule(mat,p).costPerSqm+=20;s=R.save(s,'materials',mat);const after=M.calculate(s,s.plans[0]);
 assert.ok(after.rows[0].price>before.rows[0].price);assert.equal(after.rows[1].price,before.rows[1].price);assert.equal(after.rows[2].price,99);
 const override=s.materials.find(x=>x.id===p.items[1].materialId);M.materialRule(override,p.items[1]).coefficient+=3;s=R.save(s,'materials',override);const weighted=M.calculate(s,s.plans[0]);assert.ok(weighted.rows[1].weight>after.rows[1].weight);assert.equal(weighted.rows[0].weight,after.rows[0].weight);
 p=s.plans[0];p.items[1].weight=.2;p.packagingWeight=.3;assert.equal(M.calculate(s,p).rows[1].weight,.2);assert.equal(M.calculate(s,p).rows[0].weight,weighted.rows[0].weight+.3);
 assert.deepEqual(s.records,history);assert.deepEqual(Q.summary(s),ledger);assert.deepEqual(M.summarize(M.calculate(frame,frame.plan)),M.summarize(before));
 s=R.copyPlan(s,p.id,'关联副本');const copy=s.plans.at(-1);assert.deepEqual(M.calculate(s,copy).rows.map(x=>x.price),prices(s));assert.ok(copy.items.every(i=>!p.items.some(j=>i.id===j.id)));assert.equal(copy.salesSource,null);
});

test('三类策略拒绝待核对尺寸生成报价，后台价格表也拒绝；修复尺寸后恢复',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relations-listing-'));
 try{for(const type of ['uniform','rank','area']){
  const s=setup(),p=s.plans[0],strategy=s.pricingStrategies[0];Object.assign(strategy,{type,tiers:[60,70],fallback:80,baseArea:.1,baseMargin:60,stepArea:.1,stepPoints:10,cap:90});
  s.sizes.find(x=>x.id===p.items[0].sizeId).needsReview=true;assert.ok(M.validateBackup(s));let result=M.calculate(s,p);assert.equal(result.valid,false);assert.ok(result.rows[0].priceError);assert.equal(result.rows[0].price,'');
  await assert.rejects(require('../server/auxiliary-file-jobs.cjs').handlers['export-listing']({state:s,planId:p.id},{outputDir:directory}),/未确认/);
  s.sizes.find(x=>x.id===p.items[0].sizeId).needsReview=false;result=M.calculate(s,p);assert.ok(result.valid);assert.ok(result.rows.every(x=>x.grossMargin>=x.targetMargin-1e-8));
 }}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('销量回填完整分母且不改价格，增删规格/尺寸组合标记来源已调整，重复添加不误标',async()=>{
 const original=setup(),before=prices(original),s=sales(original),p=s.plans[0];assert.deepEqual(prices(s),before);assert.equal(p.salesSource.total,6);assert.equal(p.items.reduce((n,i)=>n+i.share,0),100);assert.equal(p.salesSource.editedAfterImport,false);
 const extra=s.sizes.find(x=>!p.items.some(i=>i.sizeId===x.id));const added=R.addSizes(s,p.id,[extra.id]);assert.equal(added.plans[0].salesSource.editedAfterImport,true);assert.equal(R.addSizes(s,p.id,[p.items[0].sizeId]).plans[0].salesSource.editedAfterImport,false);
 s.sizeSchemes.push({id:'relation-combo',name:'新增组合',sizeIds:[extra.id],deleted:false});assert.equal(R.applySizeScheme(s,p.id,'relation-combo').state.plans[0].salesSource.editedAfterImport,true);
 const h=appHarness(s);await h.dispatch('click',{closest:()=>({dataset:{action:'remove-sku',id:p.items[0].id}})});await h.dispatch('click',{closest:()=>({dataset:{action:'confirm-action'}})});assert.equal(h.ui.state.plans[0].salesSource.editedAfterImport,true);assert.equal(h.ui.state.plans[0].items.length,2);
});

test('旧账缺省费用范围按旧口径展示，历史明细不误写为已发货订单',()=>{
 const V3=require('../public/domain-v3.js'),s=V3.seed();s.records=[];const frame=V3.makeFrame(s,s.plans[0]);delete frame.plan.params.refundRates;delete frame.plan.params.otherFeeScope;
 const record=V3.confirmRecord(s,{frame,date:'2026-09-01'}),state=M.migrate(s),before=M.clone(state.records);const html=require('../public/operating-records/entry-views.js').create({state,modal:{id:record.id}}).recordDetail()[1];
 assert.match(html,/其他费用发生范围<\/span><span>所有订单/);assert.match(html,/退货退款 10.00%/);assert.deepEqual(state.records,before);
});

test('跨工作区同编号不同规则完整重映射，保留单规格覆盖和更正链，重复合并不增项',async()=>{
 let source=setup(),p=source.plans[0];source=O.confirm(source,{frame:M.makeFrame(source,p),date:'2026-09-01',note:''});const first=source.records[0],draft=O.start(source,p,first);draft.reason='实收更正';draft.date='2026-09-02';draft.frame.plan.params.actualGmv=700;draft.frame.plan.params.revenueInput='amount';source=O.confirm(source,draft);
 const subset=T.select(source,{mode:'scoped',shopIds:[p.shopId],planIds:[p.id],from:'2026-09-02',to:'2026-09-02'});assert.equal(subset.records.length,2);assert.equal(subset.exportScope.relatedIds.length,1);
 const restored=await W.importWorkbook(await W.exportWorkbook(subset));const target=setup();target.plans[0].id='other-plan';target.active='other-plan';target.materials.forEach(m=>m.weightRules.forEach(r=>r.costPerSqm+=1));target.sizes[0].salesW+=1;target.shippingTemplates[0].name+=' 本机';target.pricingStrategies[0].margin=80;
 const original=M.clone(target),unrelated=M.calculate(target,target.plans[0]);const merged=T.merge(target,restored);assert.deepEqual(merged.report.conflicts,[]);assert.deepEqual(target,original);const imported=merged.state.plans.find(x=>x.id===p.id);
 assert.deepEqual(M.summarize(M.calculate(merged.state,imported)),M.summarize(M.calculate(source,source.plans[0])));assert.deepEqual(M.summarize(M.calculate(merged.state,merged.state.plans[0])),M.summarize(unrelated));assert.deepEqual(merged.state.records,source.records);
 assert.notEqual(imported.materialId,p.materialId);assert.notEqual(imported.items[1].materialId,p.items[1].materialId);assert.notEqual(imported.strategyId,p.strategyId);assert.deepEqual(T.merge(merged.state,restored).state,merged.state);
 assert.equal(Q.summary(merged.state).count,1);assert.equal(Q.summary(merged.state).gmv,700);close(Q.summary(merged.state).roi,7);
});

test('SQLite 重启、备份替换和更正后账目一致；悬空关联/篡改历史/过期写入均被拦截',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relations-store-'));let store=new Store(directory);
 try{let s=setup();s=O.confirm(s,{frame:M.makeFrame(s,s.plans[0]),date:'2026-09-01',note:''});store.restore(s,0,'relation-seed');let saved=store.read();store.close();store=new Store(directory);assert.deepEqual(store.read(),saved);
  for(const change of [x=>x.plans[0].materialRuleId='missing',x=>x.plans[0].items[1].materialId='missing',x=>x.plans[0].items[0].sizeId='missing',x=>x.plans[0].strategyId='missing',x=>x.records[0].frame.plan.items[0].price+=1]){const bad=M.clone(s);change(bad);assert.equal(M.validateBackup(bad),false);assert.throws(()=>store.write(bad,saved.revision));assert.deepEqual(store.read(),saved);}
  const draft=O.start(s,s.plans[0],s.records[0]);draft.reason='费用更正';draft.frame.plan.params.other+=2;const corrected=O.confirm(s,draft);store.write(corrected,saved.revision);assert.throws(()=>store.write(s,saved.revision));saved=store.read();assert.deepEqual(saved.state,corrected);
  const backup=await W.importWorkbook(await W.exportWorkbook(corrected));const receipt=store.restore(backup,saved.revision,'relation-restore');assert.equal(receipt.workspaceId,saved.workspaceId);assert.equal(receipt.storageEpoch,saved.storageEpoch+1);assert.deepEqual(store.read().state,corrected);assert.deepEqual(store.restore(backup,saved.revision,'relation-restore'),{...receipt,replayed:true});
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
