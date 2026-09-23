'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../public/domain.js'),R=require('../public/reusable-rules.js'),W=require('../public/workbook.js'),Excel=require('../public/assets/exceljs.min.js');
const UI=require('../public/product-transfer-ui.js'),Recognition=require('../public/product-recognition.js'),{ruleSnapshot}=require('../server/file-service.cjs');
const {Store}=require('../server/store.cjs'),{appHarness}=require('./app-harness.cjs');
const click=(h,action,id)=>h.dispatch('click',{closest:()=>({dataset:{action,id}})});
function sample(){const s=M.seed();s.records=[];s.active=s.plans[0].id;s.activeShop=s.plans[0].shopId;return s;}
function legacySize(s){const size=s.sizes[0];Object.assign(size,{name:'',irregular:true,salesW:99,salesH:88,productionW:50,productionH:120});return size;}

test('旧尺寸编辑只带出生产长宽；保存后计算、面积策略及历史快照保持一致',async()=>{
 const s=sample(),size=legacySize(s),p=s.plans[0];
 s.pricingStrategies.push({id:'area-strategy',name:'面积递增',type:'area',baseArea:.5,baseMargin:10,stepArea:.1,stepPoints:2,cap:50,deleted:false});p.strategyId='area-strategy';
 M.confirmRecord(s,{frame:M.makeFrame(s,p),date:'2026-09-20'});
 const records=JSON.stringify(s.records),before=M.calculate(s,p).rows[0],h=appHarness(s);
 await click(h,'edit-size',size.id);
 assert.equal(h.ui.modal.draft.salesW,50);assert.equal(h.ui.modal.draft.salesH,120);
 assert.doesNotMatch(h.elements.get('#dialog').innerHTML,/异形|销售尺寸|data-field="production[WH]"/);
 h.ui.saveModal();const after=M.calculate(h.ui.state,h.ui.state.plans[0]).rows[0];
 assert.deepEqual(['area','weight','material','cost','price','grossMargin'].map(k=>after[k]),['area','weight','material','cost','price','grossMargin'].map(k=>before[k]));
 assert.equal(after.area,.6);assert.equal(after.size.irregular,false);assert.equal(after.size.productionW,'');
 assert.equal(JSON.stringify(h.ui.state.records),records);assert.ok(M.validateBackup(h.ui.state));
});

test('常用尺寸、组合、自定义复用和转表都使用同一组实际生产长宽',()=>{
 const s=sample(),size=legacySize(s),p=s.plans[0];p.items=[];const material=s.materials.find(x=>x.weightRules.some(r=>r.default));p.materialId=material.id;p.materialRuleId=material.weightRules.find(r=>r.default).id;
 const h=appHarness(s);h.ui.open('add-skus',{ids:[],draft:{salesW:'',salesH:''}});assert.match(h.ui.commonSizeChoices(),/50 × 120 cm/);
 const added=R.addSizes(s,p.id,[size.id],{width:50,height:120});assert.equal(added.plans[0].items.length,1);assert.equal(added.sizes.length,s.sizes.length);
 s.sizeSchemes.push({id:'combo',name:'组合',sizeIds:[size.id],deleted:false});assert.equal(R.applySizeScheme(s,p.id,'combo').state.plans[0].items.length,1);
 assert.deepEqual(UI.canonicalRules(s),ruleSnapshot(s));
 const rules=ruleSnapshot(s),projected=rules.sizes.find(x=>x.id===size.id);assert.equal(projected.salesW,50);assert.equal(projected.salesH,120);assert.equal(projected.irregular,false);
 const raw={rowId:1,values:['硅藻泥地垫','未填尺寸'],mapping:{productName:0,specName:1}};
 for(const sizes of [s.sizes,rules.sizes]){const patch=Recognition.previewTransferRowPatch(raw,{}, {size:{mode:'value',id:size.id}}, {type:'row-edit'},{materials:s.materials,sizes});assert.equal(patch.review.size.area,.6);}
 size.needsReview=true;size.productionW='';size.productionH='';
 assert.equal(ruleSnapshot(s).sizes[0].salesW,'');assert.throws(()=>Recognition.previewTransferRowPatch(raw,{}, {size:{mode:'value',id:size.id}},{type:'row-edit'},{materials:s.materials,sizes:s.sizes}),/不可用/);assert.equal(R.applySizeScheme(s,p.id,'combo').skipped,1);
 assert.throws(()=>R.addSizes(s,p.id,[size.id]),/有效/);
});

test('格式 5 原始备份仍可恢复；格式 6 只导出生产长宽且完整恢复原始数据',async()=>{
 const s=sample();legacySize(s);M.confirmRecord(s,{frame:M.makeFrame(s,s.plans[0]),date:'2026-09-20'});s.plans[0].pinned=true;
 const json=JSON.stringify(s),old=new Excel.Workbook();for(const [name,rows] of W.tables(s,5))old.addWorksheet(name).addRows(rows);
 const hidden=old.addWorksheet('恢复数据');hidden.addRow(['MAT-ROI-XLSX',5]);hidden.addRow([0,json]);
 assert.equal(old.getWorksheet('商品规格').getCell('F2').value,'是');assert.equal(JSON.stringify(await W.importWorkbook(await old.xlsx.writeBuffer())),json);
 const book=new Excel.Workbook();await book.xlsx.load(await W.exportWorkbook(s));assert.equal(book.getWorksheet('恢复数据').getCell('B1').value,6);
 for(const name of ['商品规格','尺寸库'])assert.doesNotMatch(book.getWorksheet(name).getRow(1).values.join(','),/销售[长宽尺]|异形/);
 const sheet=book.getWorksheet('商品规格');assert.equal(sheet.getCell('D2').value,50);assert.equal(sheet.getCell('E2').value,120);assert.equal(sheet.getCell('C2').value,'50 × 120 cm');assert.equal(book.getWorksheet('入账规格').getCell('F2').value,'50 × 120 cm');
 assert.equal(JSON.stringify(await W.importWorkbook(await book.xlsx.writeBuffer())),json);
 sheet.getCell('D2').value=51;await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/改动/);
});

test('新建计划能打开，材料切换联动厚度，并保存选定策略及正确厚度',async()=>{
 const s=M.initialState(),h=appHarness(s);s.pricingStrategies.push({id:'uniform',name:'统一毛利',type:'uniform',margin:30,deleted:false});
 await click(h,'new-plan');assert.equal(h.ui.modal.type,'plan');assert.equal(h.ui.modal.draft.name,'');
 const material=s.materials.find(x=>x.name==='亚麻'),rule=material.weightRules.find(x=>x.default);
 await h.dispatch('change',{type:'select-one',value:material.id,dataset:{field:'materialId'},matches:q=>q==='[data-field="materialId"]'||q==='[data-field]'});
 assert.equal(h.ui.modal.draft.materialRuleId,rule.id);
 Object.assign(h.ui.modal.draft,{name:'新方案',strategyId:'uniform'});h.ui.saveModal();
 const p=h.ui.state.plans.find(x=>x.id===h.ui.state.active);assert.equal(p.materialId,material.id);assert.equal(p.materialRuleId,rule.id);assert.equal(p.strategyId,'uniform');assert.ok(M.validateBackup(h.ui.state));
});

test('新建计划拒绝失效厚度与策略，不丢草稿、不污染工作区',async()=>{
 const s=M.initialState(),h=appHarness(s),before=JSON.stringify(s);await click(h,'new-plan');Object.assign(h.ui.modal.draft,{name:'保留草稿',materialRuleId:'missing'});h.ui.saveModal();assert.equal(h.ui.modal.draft.name,'保留草稿');assert.equal(JSON.stringify(h.ui.state),before);
 h.ui.modal.draft.materialRuleId=M.newPlan(s,s.activeShop,'测试').materialRuleId;h.ui.modal.draft.strategyId='missing';h.ui.saveModal();assert.match(h.elements.get('#dialog-error').textContent,/定价策略/);assert.equal(JSON.stringify(h.ui.state),before);
});

test('侧栏置顶、取消置顶和删除不切换其他计划；删除当前计划自动选择剩余项',async()=>{
 const s=sample(),p=s.plans[0];M.confirmRecord(s,{frame:M.makeFrame(s,p),date:'2026-09-20'});const records=JSON.stringify(s.records);
 const next=M.newPlan(s,s.activeShop,'第二个计划');s.plans.push(next);const h=appHarness(s);h.ui.render();
 assert.doesNotMatch(h.elements.get('#app').innerHTML,/id="active-plan"/);
 await click(h,'pin-plan',next.id);assert.equal(h.ui.state.active,p.id);assert.equal(next.pinned,true);
 let html=h.elements.get('#app').innerHTML;assert.ok(html.indexOf('data-action="select-plan" data-id="'+next.id)<html.indexOf('data-action="select-plan" data-id="'+p.id));
 await click(h,'pin-plan',next.id);assert.equal(next.pinned,false);
 await click(h,'delete-plan',next.id);await click(h,'confirm-action');assert.equal(h.ui.state.active,p.id);assert.ok(next.deleted);
 await click(h,'restore-plan',next.id);await click(h,'pin-plan',next.id);
 await click(h,'delete-plan',p.id);await click(h,'confirm-action');assert.equal(h.ui.state.active,next.id);assert.equal(JSON.stringify(h.ui.state.records),records);
 await click(h,'delete-plan',next.id);await click(h,'confirm-action');assert.equal(h.ui.state.active,'');assert.match(h.elements.get('#app').innerHTML,/暂无计划/);
});

test('置顶跨 SQLite 重启和 Excel 恢复保留，非法置顶值拒绝',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'plan-pin-'));let store=new Store(directory);try{const s=sample();s.plans[0].pinned=true;store.restore(s,0,'test-pin');store.close();store=new Store(directory);const state=store.read().state;assert.equal(state.plans[0].pinned,true);assert.equal((await W.importWorkbook(await W.exportWorkbook(state))).plans[0].pinned,true);state.plans[0].pinned='yes';assert.equal(M.validateBackup(state),false);}finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
