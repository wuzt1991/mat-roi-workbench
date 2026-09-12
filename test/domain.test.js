const test = require('node:test');
const assert = require('node:assert/strict');
// Keep the old calculation contract for validating imported v2 historical records.
const M = require('../public/legacy-domain.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('厚度按材料报价基准换算，影响成本、ROI、盈亏与情景测算', () => {
  const s=M.seed(),p=s.plans[0];
  s.materials[0].baseThickness=2;
  s.sizes[0].thickness=3;
  s.sizes[1].thickness=4;
  const r=M.calculate(s,p);
  // 100 paid orders: 20 small 3 mm mats and 80 large 4 mm mats.
  const sales=20*4.19+80*8.99;
  const goods=20*.12*10.2*1.5+80*.24*10.2*2;
  const available=sales*.9*.93-goods-100*1.35;
  assert.ok(r.valid);
  near(r.rows[0].material,1.836);
  near(r.rows[1].material,4.896);
  near(r.roi,sales/available);
  near(r.profit,3000/sales*available-1000);
  near(M.scenario(s,p,100,10).rows[0].material,1.836);
  s.materials[1].baseThickness=4;
  near(M.calculate(s,s.plans[1]).rows[0].material,3.072);
});

test('异形用料系数与厚度分别计入，长方形及异形都可保存不同厚度', () => {
  const mat={price:10.2,baseThickness:2};
  const shape={shape:'irregular',name:'云朵',areaMode:'bounds',w:60,h:90,factor:.8,thickness:3};
  near(M.billingArea(shape),.432);
  near(M.materialCost(shape,mat),6.6096);
  assert.equal(M.sameSize(shape,{...shape,thickness:4}),false);
  assert.equal(M.sameSize(shape,{...shape}),true);
  const rect={w:40,h:60,thickness:2};
  assert.equal(M.sameSize(rect,{...rect,thickness:4}),false);
  assert.equal(M.sameSize(rect,{...rect,thickness:null}),false);
  assert.equal(M.sameSize(rect,{...rect,thickness:'2'}),true);
  assert.notEqual(M.sizeLabel(rect),M.sizeLabel({...rect,thickness:4}));
});

test('旧数据不补造厚度，缺少报价厚度时明确拒绝指定厚度的成本测算', () => {
  const old=M.seed(),before=M.calculate(old,old.plans[0]);
  old.materials.forEach(m=>delete m.baseThickness);
  const record=M.createRecord(old,old.plans[0],'2026-09-08');
  delete record.materialBaseThickness;
  record.items.forEach(i=>{delete i.thickness;delete i.thicknessFactor;});
  old.plans[0].history.push(record);
  const next=M.migrate(old);
  assert.ok(M.validateBackup(next));
  assert.deepEqual(next,old);
  near(M.calculate(next,next.plans[0]).roi,before.roi);
  next.sizes[0].thickness=3;
  const missing=M.calculate(next,next.plans[0]);
  assert.equal(missing.valid,false);
  assert.equal(missing.roi,null);
  assert.ok(missing.errors.some(e=>e.includes('报价厚度')));
  assert.throws(()=>M.createRecord(next,next.plans[0],'2026-09-09'));
  next.sizes[0].thickness=null;
  next.materials[0].baseThickness=2;
  near(M.calculate(next,next.plans[0]).roi,before.roi);
});

test('厚度、基准厚度和单价变更不能重算历史，备份完整保留原数值', () => {
  const s=M.seed(),p=s.plans[0];
  s.materials[0].baseThickness=2;
  s.sizes[0].thickness=3;
  const h=M.createRecord(s,p,'2026-09-08');p.history.push(h);
  const frozen=JSON.stringify(h);
  assert.equal(h.materialBaseThickness,2);
  assert.equal(h.items[0].thickness,3);
  assert.equal(h.items[0].thicknessFactor,1.5);
  near(h.items[0].material,1.836);
  s.sizes[0].thickness=5;s.materials[0].baseThickness=1;s.materials[0].price=12;
  near(M.calculate(s,p).rows[0].material,7.2);
  assert.equal(JSON.stringify(h),frozen);
  const restored=M.migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(M.validateBackup(restored));
  assert.deepEqual(restored.plans[0].history.at(-1),h);
});

test('错误厚度不被迁移修正成有效值，也不能导入或用于记账', () => {
  for(const bad of ['',0,-1,Infinity,'broken',101])for(const target of ['size','material']){
    const s=M.seed();
    if(target==='size')s.sizes[0].thickness=bad;
    else s.materials[0].baseThickness=bad;
    const migrated=M.migrate(s);
    assert.equal(M.validateBackup(migrated),false,`${target} ${bad}`);
    assert.equal(M.calculate(migrated,migrated.plans[0]).valid,false);
    assert.throws(()=>M.createRecord(migrated,migrated.plans[0],'2026-09-08'));
  }
});

test('异形计费面积包含用料系数，同外框可以有不同形状', () => {
  const s=M.seed(),p=s.plans[0];
  s.sizes.push({id:'cloud',shape:'irregular',name:'云朵 · 60×90',areaMode:'bounds',w:60,h:90,factor:.8,active:true});
  p.items=[{sizeId:'cloud',price:18.9,share:100}];
  near(M.area(s.sizes.at(-1)),.54);
  near(M.billingArea(s.sizes.at(-1)),.432);
  const r=M.calculate(s,p);
  assert.ok(r.valid);
  near(r.rows[0].material,4.4064);
  near(r.roi,18.9/(18.9*.9*.93-4.4064-1.35));
  s.sizes.at(-1).factor=1.1;
  near(M.calculate(s,p).rows[0].material,6.0588);
  assert.ok(M.validateBackup(s));
});

test('异形直接填面积无需长宽，快照冻结面积系数且备份可恢复', () => {
  const s=M.seed(),p=s.plans[0];
  const size={id:'custom-area',shape:'irregular',name:'猫爪款',areaMode:'area',area:.24,factor:1,active:true};
  s.sizes.push(size);p.items=[{sizeId:size.id,price:8.99,share:100}];
  near(M.calculate(s,p).rows[0].material,2.448);
  const h=M.createRecord(s,p,'2026-09-08');p.history.push(h);
  const snapshot=JSON.stringify(h);
  assert.equal(h.items[0].name,'猫爪款');
  assert.equal(h.items[0].w,null);
  assert.equal(h.items[0].billingArea,.24);
  size.factor=1.2;size.area=.4;size.name='猫爪款 · 大号';s.materials[0].price=15;
  near(M.calculate(s,p).rows[0].material,7.2);
  assert.equal(JSON.stringify(h),snapshot);
  const restored=JSON.parse(JSON.stringify(s));
  assert.ok(M.validateBackup(restored));
  assert.deepEqual(restored.plans[0].history.at(-1),h);
});

test('空白、零、负数、无穷大面积与系数不产生可用 ROI', () => {
  const base={id:'invalid-shape',shape:'irregular',name:'异形',areaMode:'area',area:.24,factor:1,active:true};
  for(const key of ['area','factor'])for(const value of ['',null,0,-1,Infinity]){
    const size={...base,[key]:value},s=M.seed(),p=s.plans[0];
    s.sizes.push(size);p.items=[{sizeId:size.id,price:8.99,share:100}];
    assert.equal(M.validSize(size),false,`${key}=${value}`);
    assert.equal(M.calculate(s,p).valid,false);
    assert.equal(M.validateBackup(s),false);
  }
  assert.equal(M.validSize({...base,name:''}),false);
  assert.equal(M.validSize({...base,areaMode:'bounds',w:'',h:90}),false);
});

test('按 100 个支付订单独立列账，核对组合保本与盈亏', () => {
  const s = M.seed(), p = s.plans[0], r = M.calculate(s, p);
  const sales = 20 * 4.19 + 80 * 8.99;
  const refunds = sales * .1;
  const material = (20 * .12 + 80 * .24) * 10.2;
  const fees = (sales - refunds) * .07;
  const available = sales - refunds - material - 100 * 1.35 - fees;
  near(r.roi, sales / available);
  near(r.profit, 3000 / sales * available - 1000);
  near(r.rate * 100, 100 * available / sales);
});

test('同尺寸随计划材料取价，调价仅影响引用它的当前计划', () => {
  const s = M.seed(), [a, b] = s.plans;
  const beforeA = M.calculate(s,a), beforeB = M.calculate(s,b);
  near(beforeA.rows.find(x => x.sizeId === 's1').material, 2.448);
  near(beforeB.rows.find(x => x.sizeId === 's1').material, 3.072);
  s.materials.find(m => m.id === a.materialId).price = 11;
  near(M.calculate(s,a).rows[1].material, 2.64);
  assert.notEqual(M.calculate(s,a).roi, beforeA.roi);
  assert.deepEqual(M.calculate(s,b), beforeB);
});

test('历史账本保存独立值，材料、尺寸、售价、费用与切换材料都不能回算它', () => {
  const s = M.seed(), p = s.plans[0];
  const record = M.createRecord(s,p,'2026-09-08','当日投放');
  p.history.push(record);
  const before = JSON.stringify(p.history);
  const sum = p.history.reduce((v,h) => v+h.profit,0);
  s.materials[0].price = 20;
  s.materials[0].name = '新材料名称';
  s.sizes[0].w = 31;
  p.items[0].price = 6;
  p.items[0].share = 30;
  p.params.refund = 20;
  p.params.spend = 2000;
  p.materialId = s.materials[1].id;
  M.calculate(s,p);
  assert.equal(JSON.stringify(p.history), before);
  assert.equal(p.history.reduce((v,h) => v+h.profit,0), sum);
  const backup = JSON.parse(JSON.stringify(s));
  assert.ok(M.validateBackup(backup));
  assert.deepEqual(backup.plans[0].history,p.history);
});

test('记账拒绝重复日期、缺失输入、无效占比与日期', () => {
  const s = M.seed(), p = s.plans[0];
  p.history.push(M.createRecord(s,p,'2026-09-08'));
  assert.throws(() => M.createRecord(s,p,'2026-09-08'), /已记账/);
  assert.throws(() => M.createRecord(s,p,'2026-02-30'), /有效日期/);
  p.params.spend = '';
  assert.throws(() => M.createRecord(s,p,'2026-09-09'), /补齐/);
  p.params.spend = 1000;
  p.items[0].share = 10;
  assert.throws(() => M.createRecord(s,p,'2026-09-09'), /补齐/);
  p.items[0].share = 20;
  p.params.refund = 100;
  assert.equal(M.calculate(s,p).roi,null);
  assert.ok(M.createRecord(s,p,'2026-09-09').profit < 0);
});

test('低价占比从 0% 到 100% 时分配正确，空余比例也可试算', () => {
  const s = M.seed(), p = s.plans[1];
  for (const share of [0,20,50,80,100]) {
    const r = M.scenario(s,p,share,10);
    assert.ok(r.valid);
    near(r.total,100);
    near(r.rows[0].share,share);
    near(r.rows[1].share,(100-share)*.6);
    near(r.rows[2].share,(100-share)*.4);
  }
  p.items.forEach((i,k) => i.share = k ? 0 : 100);
  assert.ok(M.scenario(s,p,20,10).valid);
});

test('草稿缺失或暂时无效的数值可保存，坏引用与损坏账本不能导入', () => {
  const s = M.seed();
  s.plans[0].items[0].price = '';
  s.plans[0].params.refund = '';
  assert.ok(M.validateBackup(s));
  assert.equal(M.calculate(s,s.plans[0]).valid,false);
  const badRef = structuredClone(s);
  badRef.plans[0].materialId = 'missing';
  assert.equal(M.validateBackup(badRef),false);
  const badHistory = structuredClone(s);
  badHistory.plans[0].history[0].materialPrice = 'broken';
  assert.equal(M.validateBackup(badHistory),false);
  const badDuplicate = M.seed();
  badDuplicate.plans[0].history.push(structuredClone(badDuplicate.plans[0].history[0]));
  assert.equal(M.validateBackup(badDuplicate),false);
});

test('旧版数据保留原材料与独立参数，旧试算不伪装成每日账目', () => {
  const old = M.seed();
  old.version = 1; old.material = 10.2; old.materialDate = '2026-09-07';
  delete old.materials;
  old.plans.forEach(p => { delete p.materialId; delete p.history; });
  const next = M.migrate(old);
  assert.ok(M.validateBackup(next));
  near(M.calculate(next,next.plans[0]).roi,2.534794233422035);
  assert.equal(next.plans[0].params.refund,10);
  assert.equal(next.plans[0].params.recovery,0);
  assert.deepEqual(next.plans[0].history,[]);
  const early = M.seed();
  delete early.plans[0].history[0].kind;
  assert.equal(M.migrate(early).plans[0].history[0].kind,'snapshot');
});
