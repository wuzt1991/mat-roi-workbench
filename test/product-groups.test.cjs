'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../public/product-recognition.js'),{ImportSessionStore}=require('../server/import-session-store.cjs');
const rules={materials:[{id:'m',name:'硅藻泥',weightRules:[{id:'3',thickness:3,coefficient:1,costPerSqm:10},{id:'5',thickness:5,coefficient:2,costPerSqm:20}]},{id:'l',name:'亚麻',weightRules:[{id:'l3',thickness:3,coefficient:1,costPerSqm:12}]}]};
const mapping=R.mapFields(['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存']);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-groups-')),store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'o',rules,mapping}});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const rows=Array.from({length:240},(_,i)=>{const values=['抖音',i===236?'另一店':'店','同名硅藻泥商品',i===239?'尺寸未知':`图案${i} 40*60cm`,i<205||i>=235?'0001':'p'+i,'SKU-'+i,10,'在售',0];if(i===237||i===238)values[4]='';if(i===204)values[3]='目标%_ 40*60cm';const raw={rowId:i+1,sourceRow:i+2,sheetId:'s',mapping,values};return {...raw,...R.deriveTransferRow(raw,{},{rules}),values,sourceHash:String(i)};});
 store.insertRawBatch(rows);store.rebuildDerived(rules,{thicknessDefaults:{m:'3'},applyUniformThickness:true});return {store,rows};
}
test('按商品分页不会拆开跨页 SKU，同名不同链接／店铺及缺失身份相互隔离',t=>{
 const {store,rows}=fixture(t),page=store.page({view:'products'});assert.equal(page.groups.length,20);assert.equal(page.totalPages,2);assert.equal(page.total,34);assert.equal(page.rows.length,0);assert.equal(page.productCounts.total,34);assert.equal(page.groups[0].total,207);assert.equal(page.groups[0].productName,'同名硅藻泥商品');assert.equal(page.groups[0].pending,1);
 const next=store.page({view:'products',page:2});assert.equal(next.groups.length,14);assert.equal(new Set([...page.groups,...next.groups].map(g=>g.groupId)).size,34);
 const detail=store.page({groupId:rows[0].groupId,page:3});assert.equal(detail.total,207);assert.equal(detail.rows.length,7);assert.ok(detail.rows.every(r=>r.groupId===rows[0].groupId));assert.ok(!detail.rows.some(r=>r.rowId===237));
 const pending=store.page({view:'products',status:'pending'});assert.equal(pending.total,3);assert.equal(pending.groups[0].total,207);assert.equal(pending.groups[0].matched,1);assert.equal(store.page({groupId:rows[0].groupId,status:'pending'}).rows[0].rowId,240);
});
test('搜索命中 SKU 后仍按商品汇总，统一修改覆盖整个商品且不影响其他链接，可完整撤销',t=>{
 const {store,rows}=fixture(t),groupId=rows[0].groupId;
 for(const search of ['目标%_','sku-204']){const page=store.page({view:'products',search});assert.equal(page.total,1);assert.equal(page.matchedRows,1);assert.equal(page.groups[0].total,207);assert.equal(store.page({groupId,search}).rows[0].rowId,205);}
 const before=store.page({groupId,page:3}).rows;
 const result=store.applyReview({ownerToken:'o',expectedSessionRevision:1,mutationId:'all',groupId,action:{type:'group-unify'},patch:{material:{mode:'value',id:'l'},thickness:{mode:'value',materialId:'l',ruleId:'l3'}}},rules);assert.equal(result.changed,207);
 for(let page=1;page<=3;page++)for(const r of store.page({groupId,page}).rows){assert.equal(r.derived.material.materialId,'l');assert.equal(r.derived.thickness.ruleId,'l3');assert.equal(r.derived.productName,'同名硅藻泥商品');}
 assert.equal(store.page({groupId:rows[236].groupId}).rows[0].derived.material.materialId,'m');assert.equal(store.page({view:'products'}).groups[0].materialState,'l');assert.equal(store.page({groupId,search:'SKU-239'}).rows[0].derived.size.status,'pending');
 store.undo({ownerToken:'o',expectedSessionRevision:2},rules);assert.deepEqual(store.page({groupId,page:3}).rows.map(r=>r.derived),before.map(r=>r.derived));
 const changed=store.applyReview({ownerToken:'o',expectedSessionRevision:3,mutationId:'thickness',groupId,action:{type:'group-unify'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'5'}}},rules);assert.equal(changed.changed,207);assert.equal(store.page({view:'products'}).groups[0].thicknessState,'m:5');
 store.applyReview({ownerToken:'o',expectedSessionRevision:4,mutationId:'exception',rowIds:[205],action:{type:'row-edit'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'3'}}},rules);assert.equal(store.page({view:'products'}).groups[0].thicknessState,'mixed');assert.deepEqual(store.page().materialSummary.thicknesses.map(x=>({value:String(x.value),count:Number(x.count)})),[{value:'m:3',count:34},{value:'m:5',count:206}]);assert.equal(store.page({groupId,search:'SKU-204'}).rows[0].derived.thickness.ruleId,'3');
});

test('筛选商品的计数、分页越界和无命中与独立逐行汇总相同，查询不改变会话',t=>{
 const {store}=fixture(t),generation=store.getMeta('generation'),revision=store.getMeta('revision');
 const data=store.db.prepare('SELECT row_id,group_id,status,original_missing_thickness,derived_json FROM derived_rows WHERE generation=? ORDER BY row_id').all(generation);
 const fields=['productName','specName','productId','skuId'];
 for(const search of ['SKU-','SKU-2','目标%_','同名','完全无匹配'])for(const status of ['all','pending','confirmed'])for(const missingThickness of [false,true]){
  const matches=data.filter(r=>(status==='all'||(status==='pending'?r.status!=='confirmed':r.status==='confirmed'))&&(!missingThickness||r.original_missing_thickness)&&fields.some(k=>String(JSON.parse(r.derived_json)[k]||'').toLowerCase().includes(search.toLowerCase())));
  const grouped=new Map();for(const r of matches)grouped.set(r.group_id,(grouped.get(r.group_id)||0)+1);
  const ids=[...grouped.keys()].sort((a,b)=>data.find(r=>r.group_id===a).row_id-data.find(r=>r.group_id===b).row_id);
  for(const requested of [1,2,999]){
   const actual=store.page({view:'products',search,status,missingThickness,page:requested,pageSize:7}),pages=Math.max(1,Math.ceil(ids.length/7)),page=Math.min(requested,pages),visible=ids.slice((page-1)*7,page*7);
   assert.equal(actual.total,ids.length);assert.equal(actual.matchedRows,matches.length);assert.equal(actual.totalPages,pages);assert.equal(actual.page,page);assert.deepEqual(actual.groups.map(g=>g.groupId),visible);assert.deepEqual(actual.groups.map(g=>g.matched),visible.map(id=>grouped.get(id)));
  }
 }
 assert.equal(store.getMeta('generation'),generation);assert.equal(store.getMeta('revision'),revision);
 assert.deepEqual(store.db.prepare('SELECT row_id,group_id,status,original_missing_thickness,derived_json FROM derived_rows WHERE generation=? ORDER BY row_id').all(generation),data);
});
