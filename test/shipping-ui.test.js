const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const appSource=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const usage=fs.readFileSync(path.join(__dirname,'../../地垫工作台-v1.1.1/使用说明.md'),'utf8');

test('区域运费编辑器显示并锁定内置区域计费方式',()=>{
  assert.ok(appSource.includes("const shippingTypeLabels={regional:'区域重量分档（内置）'"));
  assert.ok(appSource.includes("const shippingTypeOptions=type=>type==='regional'?[['regional',shippingTypeLabels.regional]]"));
  assert.ok(appSource.includes("shippingTypeLabels[t.type]||'未知计费方式'"));
  assert.ok(appSource.includes("aria-label=\"计费方式\" ${d.type==='regional'?'disabled':''}"));
});

test('保存区域模板时保留区域费率和计费类型',()=>{
  assert.ok(appSource.includes("if(existing?.type==='regional')Object.assign(t,{type:'regional',provider:existing.provider,rates:M.clone(existing.rates),ignoreWaybillFee:existing.ignoreWaybillFee})"));
});

test('当前版本说明使用区域重量分档作为默认运费',()=>{
  assert.match(usage,/默认材料价为 10\.2 元\/㎡、中通区域运费（按重量分档计费，不含面单费）/);
  assert.match(usage,/普通省份使用内置最高常规价，偏远四省需要人工核价/);
});
