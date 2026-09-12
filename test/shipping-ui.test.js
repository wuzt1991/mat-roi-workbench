const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../public/domain.js');

const appSource=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

test('区域运费编辑器显示并锁定内置区域计费方式',()=>{
  assert.ok(appSource.includes("const shippingTypeLabels={regional:'区域重量分档（内置）'"));
  assert.ok(appSource.includes("const shippingTypeOptions=type=>type==='regional'?[['regional',shippingTypeLabels.regional]]"));
  assert.ok(appSource.includes("shippingTypeLabels[t.type]||'未知计费方式'"));
  assert.ok(appSource.includes("aria-label=\"计费方式\" ${d.type==='regional'?'disabled':''}"));
});

test('保存区域模板时保留区域费率和计费类型',()=>{
  assert.ok(appSource.includes("if(existing?.type==='regional')Object.assign(t,{type:'regional',provider:existing.provider,rates:M.clone(existing.rates),ignoreWaybillFee:existing.ignoreWaybillFee})"));
});

test('当前默认值使用区域重量分档运费',()=>{
  const state=M.initialState(),template=state.shippingTemplates[0];
  assert.equal(state.materials[0].price,10.2);
  assert.equal(template.type,'regional');assert.equal(template.provider,'中通');assert.equal(template.ignoreWaybillFee,true);
  assert.equal(M.REGULAR_SHIPPING_RATES.remoteExcluded,true);assert.equal(M.REGULAR_SHIPPING_RATES.bands.length,7);
});
