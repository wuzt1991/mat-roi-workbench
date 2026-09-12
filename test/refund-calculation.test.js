const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public/domain.js');

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

function oneSku(){
  const state=M.seed(),plan=state.plans[0];
  plan.items=[{...plan.items[0],share:100,price:20,weight:''}];
  return {state,plan};
}

test('净 ROI 使用每行 netMargin 汇总并按显示规则向上到 1.33',()=>{
  const state=M.seed(),plan=state.plans[0],material=state.materials.find(m=>m.id===plan.materialId);
  Object.assign(material,{name:'硅藻泥',price:9.3,weightRules:[{id:'silica-27',thickness:2.7,variant:'',coefficient:.83,costPerSqm:9.3,default:true}]});
  plan.materialRuleId='silica-27';
  const regional=M.regionalShippingTemplate();state.shippingTemplates.push(regional);plan.shippingId=regional.id;
  plan.items=[{sizeId:'s2',price:30,share:33.3333,weight:''},{sizeId:'s3',price:45,share:33.3333,weight:''},{sizeId:'s4',price:60,share:33.3334,weight:''}];
  plan.params={...plan.params,fee:5,tax:2,refundRates:{unshipped:1,shippedOnly:1,returnRefund:1,firstHour:1},otherFeeScope:'shipped'};
  const result=M.calculate(state,plan);
  assert.equal(result.valid,true);
  assert.ok(result.rows.every(row=>Number.isFinite(row.netMargin)));
  assert.ok(Math.abs(result.netRoi-1.3246226097928797)<1e-9);
  assert.equal(M.ceilRoi(result.netRoi),1.33);
});

test('退款按类型分摊：100% 未发货退款不产生商品、运费或履约亏损',()=>{
  const {state,plan}=oneSku();
  plan.params={...plan.params,spend:1000,actualRoi:3,returnCost:8,refundRates:{unshipped:100,shippedOnly:0,returnRefund:0,firstHour:''}};
  const result=M.calculate(state,plan);
  assert.equal(result.valid,true);
  close(result.rows[0].goods,0);
  close(result.rows[0].shipping,0);
  close(result.rows[0].returnExtra,0);
  close(result.rows[0].cost,0);
  close(result.profit,-1000);
});

test('已发货退款保留运费与回收折减成本，退货额外费只按退货退款计提',()=>{
  const {state,plan}=oneSku(),row=state.sizes.find(s=>s.id===plan.items[0].sizeId);
  const material=M.productionArea(row)*10.2;
  const baseShipping=M.calculate(state,{...plan,params:{...plan.params,refundRates:{unshipped:0,shippedOnly:0,returnRefund:0,firstHour:''}}}).rows[0].shipping;
  plan.params={...plan.params,recovery:50,returnCost:4,refundRates:{unshipped:10,shippedOnly:20,returnRefund:30,firstHour:10}};
  const result=M.calculate(state,plan),item=result.rows[0];
  close(item.goods,material*(.4+.5*.5));
  close(item.shipping,baseShipping*.9);
  close(item.returnExtra,1.2);
  close(item.otherBase,0);
  assert.ok(Number.isFinite(result.netMargin));
  assert.ok(Number.isFinite(result.netRoi));
});

test('退款比例校验阻止合计超 100% 和早期退款超总退款',()=>{
  const {state,plan}=oneSku();
  plan.params.refundRates={unshipped:60,shippedOnly:30,returnRefund:20,firstHour:''};
  let result=M.calculate(state,plan);
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(error=>error.includes('合计')));
  plan.params.refundRates={unshipped:1,shippedOnly:1,returnRefund:1,firstHour:4};
  result=M.calculate(state,plan);
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(error=>error.includes('1 小时')));
});

test('可选的 1 小时退款率保留空值，三类核心退款率缺失时不静默按 0 计算',()=>{
  const {state,plan}=oneSku();
  plan.params.refundRates={unshipped:0,shippedOnly:0,returnRefund:0,firstHour:''};
  const result=M.calculate(state,plan);
  assert.equal(result.valid,true);
  assert.equal(M.refundMetrics(plan.params).firstHour,'');
  assert.equal(result.refundRates.firstHour,'');
  plan.params.refundRates={unshipped:'',shippedOnly:0,returnRefund:0,firstHour:''};
  assert.equal(M.calculate(state,plan).valid,false);
  plan.params.refundRates={shippedOnly:0,returnRefund:0};
  assert.equal(M.calculate(state,plan).valid,false);
  assert.equal(M.normalizeParams(plan.params).refundRates.unshipped,'');
});

test('旧计划迁移到退货退款率和 all 范围，新计划使用 shipped 范围',()=>{
  const legacy=M.seed(),oldRefund=legacy.plans[0].params.refund;
  delete legacy.plans[0].params.refundRates;
  delete legacy.plans[0].params.otherFeeScope;
  const migrated=M.migrate(legacy);
  assert.deepEqual(migrated.plans[0].params.refundRates,{unshipped:0,shippedOnly:0,returnRefund:oldRefund,firstHour:''});
  assert.equal(migrated.plans[0].params.otherFeeScope,'all');
  assert.equal(M.newPlan(migrated,migrated.shops[0].id,'新计划').params.otherFeeScope,'shipped');
  assert.equal(M.validateBackup(migrated),true);
  const partialRates=M.migrate({...legacy,plans:legacy.plans.map(p=>({...p,params:{...p.params,refundRates:{unshipped:0,shippedOnly:0,returnRefund:oldRefund,firstHour:''}}}))});
  assert.equal(partialRates.plans[0].params.otherFeeScope,'all');
});

test('旧版冻结快照迁移后成本和利润保持不变，其他费用范围按配置分摊',()=>{
  const state=M.seed();state.records=[];
  const plan=state.plans[0];delete plan.params.refundRates;delete plan.params.otherFeeScope;
  plan.params={...plan.params,other:2,refund:10};
  const legacyResult=M.calculate(state,plan),record=M.confirmRecord(state,{frame:M.makeFrame(state,plan),date:'2026-09-10'});
  const migrated=M.migrate(state);
  assert.equal(migrated.plans[0].params.otherFeeScope,'all');
  close(migrated.records[0].result.cost,record.result.cost);
  close(migrated.records[0].result.profit,record.result.profit);
  const shipped=M.calculate(migrated,migrated.plans[0]);
  migrated.plans[0].params.otherFeeScope='shipped';
  migrated.plans[0].params.refundRates={unshipped:20,shippedOnly:0,returnRefund:0,firstHour:''};
  const shippedRefund=M.calculate(migrated,migrated.plans[0]);
  close(shipped.cost,legacyResult.cost);
  close(shippedRefund.rows[0].otherBase,2*.8);
});
