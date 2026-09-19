const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/review-20260918-model.js'),I=require('../public/review-20260918-import.js');
function legacy(s){delete s.sizeSchemes;for(const kind of ['strategies','materials','sizes','shippingTemplates'])s[kind].forEach(x=>delete x.deleted);for(const shop of s.shops){delete shop.plans;delete shop.activePlanId;}for(const r of s.records)legacy(r.snapshot);return s;}
test('旧草稿和旧入账快照迁移无损、幂等，不修改输入',()=>{
 const s=R.seed();R.makeRecord(s,'2026-09-01');const old=legacy(R.clone(s)),raw=JSON.stringify(old),m=R.migrate(old);
 assert.equal(JSON.stringify(old),raw);assert.equal(R.validState(m),true);assert.deepEqual(R.migrate(m),m);
 assert.deepEqual(m.records[0].result,old.records[0].result);assert.deepEqual(R.calculate(m),R.calculate(s));assert.deepEqual(m.shops[0].plans[0].rows,old.shops[0].rows);
});
test('计划复制与切换独立保存售价、参数和销售情况',()=>{
 const s=R.seed(),shop=s.shops[0],first=shop.activePlanId;shop.rows[0].manualPrice=88;shop.rows[0].priceMode='manual';shop.rows[0].sales=30;
 const p=R.createPlan(s,shop,'副本',true);assert.equal(shop.rows[0].manualPrice,88);shop.rows[0].manualPrice=99;shop.params.spend=250;shop.rows[0].sales=40;
 R.switchPlan(s,shop,first);assert.equal(shop.rows[0].manualPrice,88);assert.equal(shop.params.spend,1000);assert.equal(shop.rows[0].sales,30);
 R.switchPlan(s,shop,p.id);assert.equal(shop.rows[0].manualPrice,99);assert.equal(shop.params.spend,250);assert.equal(shop.rows[0].sales,40);assert.equal(R.validState(s),true);
});
test('计划删除切换、最后一项删除与恢复，历史记录均保留',()=>{
 const s=R.seed(),shop=s.shops[0],first=shop.activePlanId;R.makeRecord(s,'2026-09-01');const record=JSON.stringify(s.records[0]),p=R.createPlan(s,shop,'备用',true);
 R.deletePlan(s,shop,p.id);assert.equal(shop.activePlanId,first);assert.throws(()=>R.switchPlan(s,shop,p.id),/已删除/);
 const rows=R.clone(shop.rows);R.deletePlan(s,shop,first);assert.equal(shop.activePlanId,'');assert.deepEqual(shop.rows,[]);assert.equal(R.validState(s),true);
 R.restorePlan(s,shop,first);assert.equal(shop.activePlanId,first);assert.deepEqual(shop.rows,rows);assert.equal(JSON.stringify(s.records[0]),record);assert.equal(R.validState(s),true);
});
test('新建计划为空，名称校验不会丢失当前计划',()=>{
 const s=R.seed(),shop=s.shops[0],first=shop.activePlanId;assert.throws(()=>R.createPlan(s,shop,'  '),/名称/);assert.throws(()=>R.createPlan(s,shop,'当前测算'),/同名/);assert.equal(shop.activePlanId,first);
 R.createPlan(s,shop,'新计划');assert.equal(shop.rows.length,0);assert.equal(shop.params.spend,'');assert.equal(shop.salesSource,null);assert.equal(R.validState(s),true);
});
test('尺寸方案仅保存尺寸；选用不覆盖已有手动售价及销量',()=>{
 const s=R.seed(),shop=s.shops[0];shop.rows=shop.rows.slice(0,2);shop.rows[0].priceMode='manual';shop.rows[0].manualPrice=88;shop.rows[0].sales=23;const before=R.clone(shop.rows);
 const scheme=R.saveSizeScheme(s,{name:'全尺寸',sizeIds:s.sizes.map(x=>x.id),rows:shop.rows},true);assert.equal('rows' in scheme,false);assert.equal(R.applySizeScheme(s,shop,scheme.id),5);assert.deepEqual(shop.rows.slice(0,2),before);assert.ok(shop.rows.slice(2).every(r=>r.share===0&&r.sales===null&&r.skuId===''));assert.equal(R.applySizeScheme(s,shop,scheme.id),0);
 R.deleteReusable(s,'sizeSchemes',scheme.id);assert.throws(()=>R.applySizeScheme(s,shop,scheme.id),/已删除/);assert.equal(R.validState(s),true);
});
test('已删除定价策略不接受新引用，已有价格和快照保留',()=>{
 const s=R.seed(),shop=s.shops[0];R.makeRecord(s,'2026-09-01');const old=R.calculate(s),record=JSON.stringify(s.records[0]);R.deleteReusable(s,'strategies',shop.strategyId);assert.deepEqual(R.calculate(s),old);assert.equal(JSON.stringify(s.records[0]),record);
 R.switchStrategy(s,shop,'fixed');assert.throws(()=>R.switchStrategy(s,shop,'area-b'),/不存在/);assert.equal(R.validState(s),true);
});
test('删除材料从新商品识别中排除，已确认商品仍保留成本',()=>{
 const s=R.seed(),before=I.analyzeProducts(I.productExample(),s),row=before.rows[0],mat=s.materials.find(m=>m.name===row.material);assert.ok(mat);const cost=row.values[12];R.deleteReusable(s,'materials',mat.id);
 I.recalculateProducts(before,s);assert.equal(row.values[12],cost);const next=I.analyzeProducts(I.productExample(),s);assert.equal(next.rows[0].materialStatus,'pending');
});
