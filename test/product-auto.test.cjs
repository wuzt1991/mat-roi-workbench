'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../public/product-recognition.js'),{ImportSessionStore}=require('../server/import-session-store.cjs');
const rules={materials:[{id:'m',name:'硅藻泥',weightRules:[{id:'3',thickness:3,coefficient:1,costPerSqm:10},{id:'5',thickness:5,coefficient:2,costPerSqm:20}]}]};
const mapping=R.mapFields(['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存']);
const raw=(id,spec='40*60cm 3mm')=>({rowId:id,sourceRow:id+1,sheetId:'s',mapping,values:['抖音','店','硅藻泥',spec,'0001',String(id),10,'在售',0]});
test('自动补填在整份文件查找异常，并跨页只补同商品同材质缺失厚度',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-auto-'));
 const store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'o',rules,mapping}});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const records=Array.from({length:103},(_,i)=>{const r=raw(i+1,i>=100?'40*60cm':'40*60cm 5mm'),d=R.deriveTransferRow(r,{},{rules});return {...r,...Object.fromEntries(['platform','shop','productId','skuId','groupId','originalMissingThickness'].map(k=>[k,d[k]])),sourceHash:String(i)};});
 store.insertRawBatch(records);store.rebuildDerived(rules);
 const page=store.page({attention:true});assert.equal(page.rows.length,1);assert.equal(page.rows[0].rowId,101);assert.equal(page.rows[0].missingPeers,3);assert.equal(page.counts.total,103);assert.equal(page.ready,false);
 const result=store.applyReview({ownerToken:'o',mutationId:'fill',expectedSessionRevision:0,groupId:page.rows[0].groupId,action:{type:'group-fill-missing'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'3'}}},rules);
 assert.equal(result.changed,3);assert.equal(store.page().rows[0].derived.thickness.ruleId,'5');assert.equal(store.counts().ready,true);
});
test('批量保护材质时，不得删除已有人工厚度',()=>{
 const review={thickness:{status:'value',source:'manual',materialId:'m',ruleId:'5'}};
 const p=R.previewTransferRowPatch(raw(1),review,{material:{mode:'value',id:'m'}},{type:'selected-batch',overwrite:false},rules);
 assert.deepEqual(p.review,review);
});
test('重新校验不会信任已删除的人工材质或厚度规则',()=>{
 const modified={materials:[{...rules.materials[0],weightRules:[]}]};
 const d=R.deriveTransferRow(raw(1),{thickness:{status:'value',source:'manual',materialId:'m',ruleId:'3'}},{rules:modified});
 assert.equal(d.status,'pending');assert.equal(d.weight,null);
});
test('缺失平台同其他必填字段一样阻止导出',()=>{const r=raw(1);r.values[0]='';assert.equal(R.deriveTransferRow(r,{},{rules}).status,'pending');});
