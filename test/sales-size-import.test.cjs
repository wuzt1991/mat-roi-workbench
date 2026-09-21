'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ImportSessionStore}=require('../server/import-session-store.cjs');
const Size=require('../server/sales-size-import.cjs'),Recognition=require('../public/product-recognition.js');
const Reader=require('../server/xlsx-stream-reader.cjs'),Excel=require('../public/assets/exceljs.min.js');
const Domain=require('../public/domain.js'),Sales=require('../public/sales-import.js'),UI=require('../public/sales-import-ui.js');
const headers=['商品SKU图片','商品SKU标题','商品SKU编号','日期','用户支付金额','商品成交订单数','商品成交人数','商品成交件数'];
const sourceRows=[
 ['繁花/40*60cm【吸水防滑-环保无味】加厚',151,156],['繁花/45x70cm【洗手台/浴室门/通用】加厚',93,97],
 ['繁花/50*80cm【升级吸水-柔软细腻】加厚',54,56],['编织/40*60cm【吸水防滑-环保无味】加厚',41,43],
 ['繁花/60*90cm【清洗方便-耐磨耐脏】',13,13],['碎花/45x70cm【洗手台/浴室门/通用】加厚',18,20],
 ['鲜花/40*60cm【吸水防滑-环保无味】加厚',24,24],['繁花/80x100cm【入户门可用】加厚',8,8],
 ['碎花/40*60cm【吸水防滑-环保无味】加厚',22,24],['鲜花/50*80cm【升级吸水-柔软细腻】加厚',14,14],
 ['编织/50*80cm【升级吸水-柔软细腻】加厚',11,12],['鲜花/45x70cm【洗手台/浴室门/通用】加厚',13,13],
 ['编织/45x70cm【洗手台/浴室门/通用】加厚',10,12],['鲜花/80x100cm【入户门可用】加厚',3,3],
 ['碎花/50*80cm【升级吸水-柔软细腻】加厚',6,6],['鲜花/60*90cm【清洗方便-耐磨耐脏】',3,3],
 ['碎花/60*90cm【清洗方便-耐磨耐脏】',2,2],['碎花/80x100cm【入户门可用】加厚',1,1],['编织/80x100cm【入户门可用】加厚',1,1]
];
const planItems=[[40,60],[45,70],[50,80],[60,90],[80,100]].map(([width,height],i)=>({id:'item-'+i,width,height,productId:'keep-product',skuId:'keep-'+i}));
function storeFor(t,rows=sourceRows){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-sales-size-'));let store;
 // Windows cannot remove SQLite files until their connection is closed.
 t.after(()=>{store?.close();fs.rmSync(directory,{recursive:true,force:true});});
 store=new ImportSessionStore(directory,{create:true,meta:{kind:'sales',phase:'reviewing',sessionId:'session',ownerToken:'owner',workspaceId:'w',storageEpoch:0}});
 const mapping={...Recognition.mapFields(headers),sales:5};
 store.setMeta('mapping',mapping);
 store.insertRawBatch(rows.map(([title,orders,units,platform='',shop='',productId=''],i)=>({rowId:i+1,sourceRow:i+2,sheetId:'s',values:['',title,'sku-'+i,'2026/09/14-2026/09/20','',String(orders),'',String(units),platform,shop,productId],sourceHash:String(i),platform,shop,productId,skuId:'sku-'+i,groupId:'g',originalMissingThickness:false})));
 return {store,mapping,directory};
}
test('真实销售表字段与 19 条图案数据按尺寸汇总：488 单、508 件，订单占比合计 100%',async t=>{
 const {store,mapping}=storeFor(t);assert.equal(mapping.specName,1);assert.equal(mapping.orderCount,5);assert.equal(mapping.unitCount,7);
 const totals=Size.aggregate(store,mapping);assert.equal(totals.sourceRows,19);
 const c=store.salesCandidate({matchBy:'size',basis:'orders',items:planItems});
 assert.equal(c.ready,true);assert.equal(c.total,488);assert.equal(c.groups.length,5);
 assert.deepEqual(c.items.map(i=>i.count),[238,134,85,18,13]);
 assert.deepEqual(c.items.map(i=>i.share),[48.77,27.46,17.42,3.69,2.66]);
 assert.equal(c.items.reduce((n,i)=>n+Math.round(i.share*100),0),10000);
 assert.deepEqual(c.periods,['2026/09/14-2026/09/20']);
 Size.aggregate(store,{...mapping,sales:7},{basis:'units'});
 const units=Size.candidate(store,{basis:'units',items:planItems});
 assert.equal(units.total,508);assert.deepEqual(units.items.map(i=>i.count),[247,142,88,18,13]);
 assert.throws(()=>Size.candidate(store,{basis:'orders',items:planItems}),/口径/);
});
test('原始 Excel 经流读、汇总、UI 候选、业务写入及撤销，不改售价和编号',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-sales-size-xlsx-'));let store;
 t.after(()=>{store?.close();fs.rmSync(directory,{recursive:true,force:true});});
 const filename=path.join(directory,'source.xlsx'),sessionDir=path.join(directory,'session');fs.mkdirSync(sessionDir);
 const book=new Excel.Workbook(),sheet=book.addWorksheet('sheet1');sheet.addRow(headers);
 sourceRows.forEach(([title,orders,units],i)=>sheet.addRow(['',title,'0000'+i,'2026/09/14-2026/09/20','',orders,orders,units]));
 fs.writeFileSync(filename,Buffer.from(await book.xlsx.writeBuffer()));
 store=new ImportSessionStore(sessionDir,{create:true,meta:{kind:'sales',phase:'reviewing',sessionId:'session',ownerToken:'owner',workspaceId:'w',storageEpoch:0}});store.close();
 const inspection=await Reader.inspectWorkbook(filename,sessionDir),selected=inspection.sheets[0],mapping={...selected.header.mapping,sales:selected.header.mapping.orderCount};
 const imported=await Reader.importSheet(filename,sessionDir,{sheetId:selected.sheetId,mapping,rules:{},derive:false});assert.equal(imported.businessRows,19);
 store=new ImportSessionStore(sessionDir);Size.aggregate(store,mapping);store.setMeta('phase','reviewing');
 const state=Domain.initialState(),plan=state.plans.find(p=>p.id===state.active)||state.plans[0];
 plan.items=planItems.map((i,n)=>{const size={id:'test-size-'+n,name:'',salesW:i.width,salesH:i.height,irregular:false,productionW:'',productionH:'',active:true,deleted:false,needsReview:false};state.sizes.push(size);return {id:i.id,sizeId:size.id,productId:i.productId,skuId:i.skuId,sales:null,share:n===0?100:0,price:20+n,priceMode:'manual',weight:.3};});
 assert.ok(Domain.validateBackup(state));
 const payload=await UI.buildCandidate({getContext:()=>({plan,planId:plan.id,shopId:plan.shopId}),planItems,matchBy:'size',basis:'orders',period:'2026/09/14-2026/09/20',filename:'source.xlsx',session:{sessionId:'session'},aggregate:async(s,meta)=>store.salesCandidate(meta)});
 assert.ok(payload.items.every(i=>!i.bind));
 const applied=Sales.apply(state,Sales.prepare(state,plan.id,payload.items,payload));
 const result=applied.state.plans.find(p=>p.id===plan.id);
 assert.deepEqual(result.items.map(i=>i.sales),[238,134,85,18,13]);
 assert.deepEqual(result.items.map(i=>[i.productId,i.skuId,i.price]),plan.items.map(i=>[i.productId,i.skuId,i.price]));
 assert.deepEqual(Sales.undo(applied.state,applied.undo),state);
});
test('缺失、多个尺寸与计划重复尺寸不猜测，手动映射和排除后重新计算',t=>{
 const {store,mapping}=storeFor(t,[['繁花/400mm×600mm',5,5],['编织/60X40cm',7,7],['多件套/40*60cm+50*80cm',3,3],['没有尺寸',2,2]]);
 Size.aggregate(store,mapping);
 const items=[planItems[0],{...planItems[0],id:'duplicate'}];
 const c=Size.candidate(store,{items,basis:'orders',missingPolicy:'zero'});
 assert.equal(c.groups.length,3);assert.equal(c.groups[0].count,12);assert.equal(c.unknown,3);assert.equal(c.ready,false);
 const done=Size.candidate(store,{items,basis:'orders',missingPolicy:'zero',bindings:[{rowId:1,itemId:'item-0'},{rowId:3,itemId:'duplicate'},{rowId:4,excluded:true}]});
 assert.equal(done.ready,true);assert.equal(done.total,15);assert.deepEqual(done.items.map(i=>i.share),[80,20]);
});
test('多店铺商品来源必须选择，未出现规格须确认按零，不跨来源合计',t=>{
 const {store,mapping}=storeFor(t,[['花/40*60cm',2,2,'抖音','A','p1'],['花/40*60cm',8,8,'抖音','B','p2']]);
 Size.aggregate(store,{...mapping,platform:8,shop:9,productId:10});
 let c=Size.candidate(store,{basis:'orders',items:planItems});assert.equal(c.requiresSource,true);assert.equal(c.total,0);
 const sourceKey=c.sources[0].key;
 c=Size.candidate(store,{basis:'orders',items:planItems,sourceKey});assert.equal(c.total,2);assert.equal(c.ready,false);assert.equal(c.missing.length,4);
 c=Size.candidate(store,{basis:'orders',items:planItems,sourceKey,missingPolicy:'zero'});assert.equal(c.ready,true);assert.equal(c.items[0].share,100);
});
test('全零数量禁止应用，负数和小数拒绝，失败不能使用旧汇总',t=>{
 const {store,mapping}=storeFor(t,[['花/40*60cm',0,0]]);Size.aggregate(store,mapping);
 assert.equal(Size.candidate(store,{basis:'orders',items:[planItems[0]]}).ready,false);
 for(const value of ['-1','1.5','1000000000001','1,2','12,34','1,,000']){
 store.db.prepare('UPDATE raw_rows SET raw_json=? WHERE row_id=1').run(JSON.stringify(['','花/40*60cm','','','',value]));
 assert.throws(()=>Size.aggregate(store,mapping),/非负整数/);
 assert.throws(()=>Size.candidate(store,{basis:'orders',items:planItems}),/尚未完成/);
 }
});
test('超过一页的尺寸全部参与汇总，不受当前可见页限制',t=>{
 const rows=Array.from({length:105},(_,i)=>['花/'+(40+i)+'*200cm',1,1]),{store,mapping}=storeFor(t,rows);
 Size.aggregate(store,mapping);const items=rows.map((_,i)=>({id:'s'+i,width:40+i,height:200}));
 const c=Size.candidate(store,{basis:'orders',items});assert.equal(c.ready,true);assert.equal(c.groups.length,105);assert.equal(c.total,105);
 assert.equal(c.items.reduce((n,i)=>n+Math.round(i.share*100),0),10000);
});

test('合法千位数量可读取，尺寸排除组数保留在销售来源，变更候选不能误报重复成功',t=>{
 const {store,mapping}=storeFor(t,[['花/40*60cm','1,000',1],['无尺寸',2,2]]);Size.aggregate(store,mapping);
 const state=Domain.seed(),plan=state.plans[0],item=plan.items[0];
 const c=Size.candidate(store,{basis:'orders',items:[{id:item.id,width:40,height:60}],bindings:[{rowId:2,excluded:true}]});
 assert.equal(c.total,1000);assert.equal(c.excluded,1);
 const draft=Sales.prepare(state,plan.id,c.items,{...c,importId:'same-import',filename:'sales.xlsx',period:'2026-09',missingPolicy:'zero'});
 const applied=Sales.apply(state,draft),saved=applied.state.plans[0];
 assert.equal(saved.salesSource.excluded,1);
 assert.equal(Sales.apply(applied.state,draft).duplicate,true);
 const changed=structuredClone(draft);changed.items[0].count=999;
 assert.throws(()=>Sales.apply(applied.state,changed),/已应用|重新导入/);
});
test('同一导入编号的数量变更不得误报已保存',()=>{
 const state=Domain.seed(),plan=state.plans[0];
 const draft=Sales.prepare(state,plan.id,[{itemId:plan.items[0].id,count:10}],{period:'2026-09',missingPolicy:'zero',importId:'same'});
 const applied=Sales.apply(state,draft);draft.items[0].count=20;
 assert.throws(()=>Sales.apply(applied.state,draft),/已应用|重新导入/);
});

test('缺失的明确尺寸可一键添加；未知、多尺寸、重复尺寸和已排除行不可添加',t=>{
 const {store,mapping}=storeFor(t,[['花/45*70cm',2,2],['无尺寸',3,3],['组合/40*60cm+50*80cm',4,4],['花/60*40cm',5,5]]);
 Size.aggregate(store,mapping);
 const c=Size.candidate(store,{basis:'orders',items:[planItems[0],{...planItems[0],id:'duplicate'}]});
 assert.deepEqual(c.groups.map(r=>r.canAdd),[true,false,false,false]);
 assert.deepEqual([c.groups[0].width,c.groups[0].height],[45,70]);
 assert.equal(Size.candidate(store,{basis:'orders',items:[],bindings:[{rowId:1,excluded:true}]}).groups[0].canAdd,false);
 assert.equal(Size.candidate(store,{basis:'orders',items:[]}).groups[0].canAdd,true);
});
function additionState(){
 const state=Domain.initialState(),plan=state.plans[0];plan.items=[];
 const material=state.materials.find(m=>m.weightRules.some(r=>r.default&&!r.deleted));plan.materialId=material.id;plan.materialRuleId=material.weightRules.find(r=>r.default&&!r.deleted).id;
 state.pricingStrategies.push({id:'import-price',name:'导入统一毛利',type:'uniform',margin:30,deleted:false});plan.strategyId='import-price';
 assert.ok(Domain.validateBackup(state));return {state,plan};
}
function additionDraft(state,plan,additions){return Sales.prepare(state,plan.id,additions.map((a,n)=>({itemId:a.itemId,count:10+n})),{matchBy:'size',period:'2026-09',filename:'sales.xlsx',importId:'new-dimensions',basis:'orders',excluded:0,additions});}
test('新增尺寸与占比一起应用，复用旋转后的已有尺寸，继承规则与定价并完整撤销',()=>{
 const {state,plan}=additionState();state.sizes.push({id:'reuse-rotated',name:'',salesW:73,salesH:47,irregular:false,productionW:'',productionH:'',active:true,deleted:false});
 const additions=[{itemId:'new-a',sizeId:'unused-size',width:47,height:73},{itemId:'new-b',sizeId:'new-size',width:53,height:87}],before=structuredClone(state);
 const draft=additionDraft(state,plan,additions),applied=Sales.apply(state,draft),p=applied.state.plans[0];
 assert.deepEqual(state,before);assert.equal(p.items.length,2);assert.equal(p.items[0].sizeId,'reuse-rotated');assert.equal(p.items[1].sizeId,'new-size');assert.equal(applied.state.sizes.length,state.sizes.length+1);
 assert.ok(p.items.every(i=>i.priceMode==='plan'&&i.productId===''&&i.skuId===''));assert.ok(Domain.calculate(applied.state,p).rows.every(r=>r.price>0));
 assert.equal(p.items.reduce((n,i)=>n+i.share,0),100);assert.equal(Sales.apply(applied.state,draft).duplicate,true);
 assert.deepEqual(Sales.undo(applied.state,applied.undo),state);
});
test('无效或重复新增尺寸、失效默认规则、无效销量全部失败且不修改原计划',()=>{
 const {state,plan}=additionState(),valid={itemId:'new-a',sizeId:'new-size',width:47,height:73};
 for(const additions of [[{...valid,width:0}],[valid,{...valid,itemId:'new-b',sizeId:'new-b-size',width:73,height:47}],[{...valid,sizeId:state.sizes[0].id}]]){
   const before=structuredClone(state);assert.throws(()=>Sales.apply(state,additionDraft(state,plan,additions)));assert.deepEqual(state,before);
 }
 let draft=additionDraft(state,plan,[valid]);draft.items[0].count=-1;assert.throws(()=>Sales.apply(state,draft),/销量/);assert.equal(plan.items.length,0);
 state.materials.find(m=>m.id===plan.materialId).deleted=true;assert.throws(()=>Sales.apply(state,additionDraft(state,plan,[valid])),/默认材料/);assert.equal(plan.items.length,0);
});
test('撤销新增规格时保留已被其他计划引用的新尺寸，不影响其他计划',()=>{
 const {state,plan}=additionState(),a={itemId:'new-a',sizeId:'new-size',width:47,height:73};
 const result=Sales.apply(state,additionDraft(state,plan,[a])),next=result.state;
 const other=Domain.newPlan(next,plan.shopId,'其他计划');other.items=[{...next.plans[0].items[0],id:'other-item'}];next.plans.push(other);
 const undone=Sales.undo(next,result.undo);assert.equal(undone.plans[0].items.length,0);assert.ok(undone.sizes.some(s=>s.id==='new-size'));assert.deepEqual(undone.plans[1],other);
});
