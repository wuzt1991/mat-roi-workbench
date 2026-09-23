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

test('材质厚度预设跨商品补缺失，保留原表厚度和人工选择',()=>{
 const context={rules,thicknessDefaults:{m:'3'}};
 const first=R.deriveTransferRow(raw(1,'40*60cm'),{},{...context});assert.equal(first.thickness.source,'preset');assert.equal(first.thickness.ruleId,'3');assert.equal(first.status,'confirmed');
 const other=raw(2,'50*80cm');other.values[4]='other-product';assert.equal(R.deriveTransferRow(other,{},context).thickness.ruleId,'3');
 assert.equal(R.deriveTransferRow(raw(3,'40*60cm 5mm'),{},context).thickness.ruleId,'5');
 assert.equal(R.deriveTransferRow(raw(4,'40*60cm 3mm / 5mm'),{},context).status,'pending');
 const manual={thickness:{status:'value',source:'manual',materialId:'m',ruleId:'5'}};assert.equal(R.deriveTransferRow(raw(5,'40*60cm'),manual,context).thickness.ruleId,'5');
 const edited=R.previewTransferRowPatch(raw(6,'40*60cm'),{},{size:{mode:'value',width:50,length:80}},{type:'row-edit'},rules,context.thicknessDefaults);assert.equal(edited.derived.thickness.ruleId,'3');assert.equal(edited.derived.weight,.4);
});
test('预设失效或取消重算时，不发布新的厚度预设和半成品',t=>{
 assert.throws(()=>R.normalizeThicknessDefaults({m:'gone'},rules),/厚度/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-preset-')),store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'o',rules,mapping}});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const r=raw(1,'40*60cm'),d=R.deriveTransferRow(r,{},{rules});store.insertRawBatch([{...r,...d,values:r.values,sourceHash:'1'}]);store.rebuildDerived(rules,{thicknessDefaults:{m:'3'}});const before=store.page().rows[0].derived;
 let canceled=false;assert.throws(()=>store.rebuildDerived(rules,{thicknessDefaults:{m:'5'},progress:()=>{canceled=true;},canceled:()=>canceled}),/取消/);assert.deepEqual(store.getMeta('thicknessDefaults'),{m:'3'});assert.deepEqual(store.page().rows[0].derived,before);
 store.rebuildDerived(rules,{thicknessDefaults:{m:'5'}});assert.equal(store.page().rows[0].derived.thickness.ruleId,'5');
});

test('商品搜索查整表并按字面匹配，修改单条和撤销保留会话预设',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-search-')),store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'o',rules,mapping}});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const records=Array.from({length:140},(_,i)=>{const r=raw(i+1,'40*60cm');r.values[4]='p'+i;if(i===139){r.values[2]='硅藻泥目标%_图案';r.values[5]='AbC00999';}const d=R.deriveTransferRow(r,{},{rules});return {...r,...d,values:r.values,sourceHash:String(i)};});store.insertRawBatch(records);store.rebuildDerived(rules,{thicknessDefaults:{m:'3'}});
 for(const search of ['目标%_','abc00999','p139']){const page=store.page({search});assert.equal(page.total,1);assert.equal(page.rows[0].rowId,140);assert.equal(page.counts.total,140);assert.equal(page.ready,true);}
 assert.equal(store.page({search:'不存在'}).total,0);assert.equal(store.page({search:'40*60cm',page:2}).rows.length,40);
 store.applyReview({ownerToken:'o',mutationId:'one',expectedSessionRevision:0,rowIds:[140],action:{type:'row-edit'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'5'}}},rules);
 assert.equal(store.page({search:'p139'}).rows[0].derived.thickness.ruleId,'5');assert.equal(store.page().rows[0].derived.thickness.ruleId,'3');
 store.undo({ownerToken:'o',expectedSessionRevision:1},rules);assert.equal(store.page({search:'p139'}).rows[0].derived.thickness.ruleId,'3');
 store.applyReview({ownerToken:'o',mutationId:'one-again',expectedSessionRevision:2,rowIds:[140],action:{type:'row-edit'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'5'}}},rules);store.rebuildDerived(rules,{thicknessDefaults:{}});
 assert.equal(store.page({search:'p139'}).rows[0].derived.thickness.ruleId,'5');assert.equal(store.page().rows[0].derived.status,'pending');
});

test('按材质统一厚度覆盖原表厚度，之后单条人工调整优先',()=>{
 const context={rules,thicknessDefaults:{m:'3'},thicknessMode:'uniform'};
 for(const spec of ['40*60cm','40*60cm 5mm','40*60cm 3mm / 5mm']){const row=R.deriveTransferRow(raw(1,spec),{},context);assert.equal(row.thickness.ruleId,'3');assert.equal(row.thickness.source,'uniform');assert.equal(row.status,'confirmed');}
 const edited=R.previewTransferRowPatch(raw(1,'40*60cm 3mm'),{},{thickness:{mode:'value',materialId:'m',ruleId:'5'}},{type:'row-edit'},rules,{m:'3'},'uniform');assert.equal(edited.derived.thickness.ruleId,'5');
 const resize=R.previewTransferRowPatch(raw(1,'40*60cm 5mm'),{},{size:{mode:'value',width:50,length:80}},{type:'row-edit'},rules,{m:'3'},'uniform');assert.equal(resize.derived.thickness.ruleId,'3');
});
test('整表材质汇总及统一覆盖原子提交，取消不删除人工例外',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-uniform-')),store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'o',rules,mapping}});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const records=Array.from({length:103},(_,i)=>{const r=raw(i+1,'40*60cm 5mm');if(i===102)r.values[2]='未知地垫';const d=R.deriveTransferRow(r,{},{rules});return {...r,...d,values:r.values,sourceHash:String(i)};});store.insertRawBatch(records);store.rebuildDerived(rules);
 assert.deepEqual(store.page({pageSize:1}).materialSummary.materials,[{materialId:'m',count:102}]);assert.equal(store.page().materialSummary.unknown,1);
 store.applyReview({ownerToken:'o',mutationId:'manual',expectedSessionRevision:0,rowIds:[1],action:{type:'row-edit'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'5'}}},rules);
 let canceled=false;assert.throws(()=>store.rebuildDerived(rules,{thicknessDefaults:{m:'3'},thicknessMode:'uniform',applyUniformThickness:true,progress:()=>{canceled=true;},canceled:()=>canceled}),/取消/);assert.equal(store.review(1).thickness.ruleId,'5');assert.equal(store.page().thicknessConfigured,false);
 store.rebuildDerived(rules,{thicknessDefaults:{m:'3'},thicknessMode:'uniform',applyUniformThickness:true});assert.equal(store.page().thicknessConfigured,true);assert.equal(store.review(1).thickness,undefined);assert.equal(store.page().rows[0].derived.thickness.ruleId,'3');assert.equal(store.page().counts.pending,1);
});

test('材质与厚度同一步批量确认，歧义来源保留，单个分组指定优先',t=>{
 const both={materials:[...rules.materials,{id:'linen',name:'亚麻',weightRules:[{id:'l5',thickness:5,coefficient:2,costPerSqm:20}]}]};
 assert.equal(R.identifyMaterial('亚麻硅藻泥',both).status,'pending');assert.equal(R.identifyMaterial('普通地垫',both,'普通地垫 硅藻泥 40*60').materialId,'m');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-materials-')),store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'o',rules:both,mapping}});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const records=['未知地垫','亚麻硅藻泥','普通地垫'].map((name,i)=>{const r=raw(i+1,i===2?'硅藻泥 40*60cm':'40*60cm');r.values[2]=name;r.values[4]='p'+i;const d=R.deriveTransferRow(r,{},{rules:both});return {...r,...d,values:r.values,sourceHash:String(i)};});store.insertRawBatch(records);store.rebuildDerived(both);assert.equal(store.page().materialSummary.unknown,2);
 store.rebuildDerived(both,{thicknessDefaults:{m:'3',linen:'l5'},applyUniformThickness:true,fallbackMaterialId:'m',materialAssignments:{[records[1].groupId]:'linen'}});
 const rows=store.page().rows;assert.equal(store.counts().ready,true);assert.equal(rows[0].derived.material.materialId,'m');assert.equal(rows[1].derived.material.materialId,'linen');assert.equal(rows[2].derived.material.materialId,'m');assert.equal(rows[0].derived.productName,'未知地垫');assert.equal(store.review(1).material.materialId,'m');
});
