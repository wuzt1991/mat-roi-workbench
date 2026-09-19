const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/review-20260918-model.js');
function setup(){const s=R.seed();return {s,shop:s.shops[0]};}
test('独立示例可以测算，每店保存计划且无包装重量字段',()=>{const {s,shop}=setup();assert.equal(R.validState(s),true);assert.equal(R.calculate(s).valid,true);assert.equal(shop.plans.length,1);assert.equal('packagingWeight' in shop,false);});
test('面积 A/B 两套方案按整档递增且独立',()=>{const {s}=setup(),a=s.strategies[0],b=s.strategies[1];assert.deepEqual([.49,.5,.59,.6,.7].map(area=>R.target(a,area)),[10,10,10,11,12]);assert.deepEqual([.49,.5,.59,.6,.7].map(area=>R.target(b,area)),[10,10,10,12,14]);assert.equal(R.target(b,100),40);});
test('统一毛利反推售价向上到分',()=>{const {s,shop}=setup();s.materials.find(m=>m.id===shop.materialId).weightRules.find(r=>r.id===shop.ruleId).costPerSqm=16;shop.shippingId='fixed-2';shop.params.fee=shop.params.tax=0;shop.rows=[{...shop.rows[2],share:100}];shop.strategyId='fixed';s.strategies.find(x=>x.id==='fixed').margin=20;assert.equal(R.calculate(s).rows[0].baseCost,10);assert.equal(R.calculate(s).rows[0].price,12.5);});
test('手动价参与成本排名，同成本同档',()=>{const {s,shop}=setup();shop.strategyId='rank';shop.rows[1].sizeId=shop.rows[0].sizeId;shop.rows[0].priceMode='manual';shop.rows[0].manualPrice=99;const rows=R.calculate(s).rows;assert.equal(rows[0].rank,1);assert.equal(rows[1].rank,1);assert.equal(rows[2].rank,2);assert.equal(rows[0].price,99);});
test('策略切换和材料调价均保持手动售价，恢复自动后重算',()=>{const {s,shop}=setup(),row=shop.rows[0];row.priceMode='manual';row.manualPrice=88;R.switchStrategy(s,shop,'fixed');assert.equal(R.calculate(s).rows[0].price,88);s.strategies.find(x=>x.id==='fixed').margin=40;assert.equal(R.calculate(s).rows[0].price,88);row.priceMode='auto';assert.notEqual(R.calculate(s).rows[0].price,88);});
test('手动模式冻结有效价格，再选策略不丢覆盖值',()=>{const {s,shop}=setup(),before=R.calculate(s).rows.map(r=>r.price);R.switchStrategy(s,shop,'');assert.deepEqual(shop.rows.map(r=>r.manualPrice),before);R.switchStrategy(s,shop,'fixed');assert.deepEqual(R.calculate(s).rows.map(r=>r.price),before);});
test('保存、另存、备份恢复保持方案互相独立',()=>{const {s}=setup(),old=JSON.stringify(s.strategies[1]);const draft={...s.strategies[0],stepPoints:3};R.saveStrategy(s,draft);assert.equal(JSON.stringify(s.strategies[1]),old);const copy=R.saveStrategy(s,{...draft,name:'另存方案'},true);assert.notEqual(copy.id,draft.id);assert.equal(s.strategies.length,5);assert.equal(R.validState(JSON.parse(JSON.stringify(s))),true);assert.throws(()=>R.saveStrategy(s,{...draft,name:'另存方案'},true),/同名/);});
test('尺寸方案可保存多套，选用时只补充当前未有的尺寸',()=>{
  const {s,shop}=setup();shop.rows=shop.rows.slice(0,1);
  const scheme=R.saveSizeScheme(s,{name:'小号组合',sizeIds:['size-0','size-1','size-2']},true);
  assert.equal(R.applySizeScheme(s,shop,scheme.id),2);assert.deepEqual(shop.rows.map(r=>r.sizeId),['size-0','size-1','size-2']);
  assert.equal(R.applySizeScheme(s,shop,scheme.id),0);assert.equal(shop.rows.length,3);
  assert.throws(()=>R.saveSizeScheme(s,{name:'小号组合',sizeIds:['size-3']},true),/同名/);
  assert.equal(R.validState(s),true);assert.equal(R.calculate(s).valid,false);R.normalizeShares(shop);assert.equal(R.calculate(s).valid,true);
});
test('可复用规则可软删除和恢复，已有引用仍可计算',()=>{
  const {s,shop}=setup(),before=R.calculate(s).rows[0].price;
  R.deleteReusable(s,'strategies',shop.strategyId);assert.equal(s.strategies.find(x=>x.id===shop.strategyId).deleted,true);assert.equal(R.calculate(s).rows[0].price,before);
  R.restoreReusable(s,'strategies',shop.strategyId);assert.equal(s.strategies.find(x=>x.id===shop.strategyId).deleted,false);
  for(const [kind,item] of [['sizeSchemes',s.sizeSchemes[0]],['materials',s.materials[0]],['sizes',s.sizes[0]],['shippingTemplates',s.shippingTemplates[0]]]){R.deleteReusable(s,kind,item.id);assert.equal(item.deleted,true);R.restoreReusable(s,kind,item.id);assert.equal(item.deleted,false);}
  assert.equal(R.validState(s),true);assert.throws(()=>R.deleteReusable(s,'records','x'),/不支持/);
});
test('非法毛利、零成本、缺失成本均阻止自动生成售价',()=>{const {s,shop}=setup();shop.strategyId='fixed';s.strategies.find(x=>x.id==='fixed').margin=98;assert.equal(R.calculate(s).rows[0].price,null);s.strategies.find(x=>x.id==='fixed').margin=20;shop.rows[0].ruleId='missing';shop.strategyId='rank';const r=R.calculate(s);assert.equal(r.valid,false);assert.ok(r.rows.every(r=>r.price===null));});
test('入账冻结快照，同店同日不重复，其他店可单独入账',()=>{const {s,shop}=setup();R.makeRecord(s,'2026-09-01');const old=JSON.stringify(s.records[0]);s.strategies[1].stepPoints=8;assert.equal(JSON.stringify(s.records[0]),old);assert.throws(()=>R.makeRecord(s,'2026-09-01'),/已入账/);s.activeShop='shop-b';s.shops[1].rows=R.clone(shop.rows);s.shops[1].params=R.clone(shop.params);R.makeRecord(s,'2026-09-01');assert.equal(s.records.length,2);});
test('损坏备份缺少指标、材料规则或确认状态必须拒绝',()=>{
  for(const corrupt of [s=>delete s.prefs.metrics,s=>s.materials[0].weightRules[0].coefficient=-1,s=>s.product={rows:[]},s=>s.records.push({id:'fake'})]){const s=R.seed();corrupt(s);assert.equal(R.validState(s),false);}
});
