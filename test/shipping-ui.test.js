const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../public/domain.js');

const appSource=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

test('区域运费编辑器显示并锁定内置区域计费方式',()=>{
  const views=require('../public/rules-views.js'),state=M.initialState();
  const form=views.create({state,modal:{type:'shipping',draft:state.shippingTemplates[0]}}).shippingForm();
  assert.match(form[1],/aria-label="计费方式" disabled/);
  assert.deepEqual(views.shippingTypeOptions('regional'),[['regional','区域重量分档（内置）']]);
  assert.match(views.create({state}).shippingList(),/区域重量分档（内置）/);
});

test('保存区域模板时保留区域费率和计费类型',()=>{
  const state=M.initialState(),original=state.shippingTemplates[0];
  const next=require('../public/rules-editor.js').save(state,{type:'shipping',id:original.id,draft:{...M.clone(original),type:'fixed',fee:0,rates:{}}}).state.shippingTemplates[0];
  for(const key of ['type','provider','rates','ignoreWaybillFee'])assert.deepEqual(next[key],original[key]);
});

test('当前默认值使用区域重量分档运费',()=>{
  const state=M.initialState(),template=state.shippingTemplates[0];
  assert.equal(state.materials[0].price,10.2);
  assert.equal(template.type,'regional');assert.equal(template.provider,'中通');assert.equal(template.ignoreWaybillFee,true);
  assert.equal(M.REGULAR_SHIPPING_RATES.remoteExcluded,true);assert.equal(M.REGULAR_SHIPPING_RATES.bands.length,7);
});
