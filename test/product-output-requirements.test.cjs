'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/product-recognition.js'),P=require('../public/product-transfer.js');
const headers=['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存','货品简称','规格简称'];
function example(material,thickness){
 const values=['抖音','测试店',`${material} ${thickness}mm 地垫`,`400mm×600mm 加厚 ${thickness}mm`,'product-5.0','sku-3.0',5,'在售',30,`${thickness}${material}`,`【${material}、${thickness}】`];
 const rule={id:'rule',thickness:Number(thickness),coefficient:1.26,costPerSqm:16.2,default:false};
 const rules={materials:[{id:'material',name:material,weightRules:[rule]}]};
 const modern=R.deriveTransferRow({rowId:1,values,mapping:R.mapFields(headers)},{},{rules});
 const legacyRules=P.defaultRules();legacyRules.weightRules=[{material,...rule}];
 const legacy=P.transformRows([headers,values],{rules:legacyRules}).rows[0];
 return {values,modern,legacy};
}
for(const [material,thickness] of [['硅藻泥','3.0'],['亚麻','5.0']])test(`${material} ${thickness}：默认厚度在所有名称字段省略，尺寸与业务数字不变`,()=>{
 const {modern,legacy}=example(material,thickness);
 for(const row of [modern,legacy]){
  for(const index of [3,4,5,6,23,25,26,28])assert.doesNotMatch(String(row.values[index]),new RegExp(thickness.replace('.','\\.')+'|'+Number(thickness)+'mm'),R.OUTPUT_HEADERS[index]);
  for(const index of [4,23,26])assert.equal(row.values[index],`400mm×600mm 加厚【${material}】`);
  assert.equal(row.values[3],`${material} 地垫`);assert.equal(row.values[25],material);assert.equal(row.values[28],`【${material}】`);
  assert.equal(row.values[17],'product-5.0');assert.equal(row.values[18],'sku-3.0');assert.equal(row.values[19],5);assert.equal(row.values[21],30);
  assert.equal(row.weight,.24*1.26);assert.equal(row.cost,.24*16.2);
 }
});
test('亚麻 3.5 与相邻非默认厚度保留标注，不受材料库 default 标记影响',()=>{
 for(const [material,thickness] of [['亚麻','3.5'],['亚麻','5.01'],['硅藻泥','3.01'],['硅藻泥','5.0']]){
  const {modern,legacy}=example(material,thickness);
  for(const row of [modern,legacy]){
   assert.equal(row.values[5],`${Number(thickness).toFixed(1)}${material}`);
   assert.match(row.values[4],new RegExp(`【${material}、`));
  }
 }
});
test('升级会使 v6 旧导出派生缓存失效',()=>{assert.ok(R.DERIVATION_VERSION>6);});
