const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public/thickness-review-model.js');
test('automatic unique thickness calculates; missing unknown conflicting and pseudo wait',()=>{
 const s=M.seed(),r=M.derive(s);assert.equal(r.filter(x=>x.status==='pending').length,5);assert.equal(r[0].cost,2.28);assert.equal(r[0].weight,.24);assert.equal(r[2].rule,null);assert.match(r[2].reason,/8 mm/);assert.match(r[4].reason,/多个/);assert.equal(r[5].rule,null);
});
test('default scheme automatically fills missing thickness without changing unknown/conflicting rows',()=>{
 const s=M.seed();M.selectScheme(s,'defaults');const before=structuredClone(s),r=M.derive(s);
 assert.equal(r[1].ruleId,'silica-3');assert.equal(r[1].source,'default');assert.equal(r[1].status,'ready');assert.equal(r[1].cost,3.8000000000000003);assert.equal(r[3].ruleId,'linen-3');
 assert.equal(r[2].status,'pending');assert.equal(r[4].status,'pending');assert.equal(r[5].status,'pending');assert.deepEqual(s,before);
 M.selectRule(s,'r2','silica-5');M.saveScheme(s,{...s.schemes[1],defaults:{silica:'silica-27',linen:'linen-5'}});assert.equal(M.derive(s)[1].ruleId,'silica-5');assert.equal(M.derive(s)[3].ruleId,'linen-5');
 M.selectScheme(s,'manual');assert.equal(M.derive(s)[1].ruleId,'silica-5');assert.equal(M.derive(s)[3].status,'pending');
});
test('absent default stays pending and explicit blank never gets refilled',()=>{
 const s=M.seed();M.selectScheme(s,'defaults');M.saveScheme(s,{...s.schemes[1],defaults:{silica:'',linen:'linen-3'}});
 assert.equal(M.derive(s)[1].status,'pending');assert.equal(M.derive(s)[1].cost,null);
 M.setMaterial(s,'r4','');assert.equal(M.derive(s)[3].status,'blank');assert.equal(M.derive(s)[3].rule,null);assert.equal(M.derive(s)[3].cost,null);
});
test('manual mode never selects recognized thickness; confirmed choices survive mode changes',()=>{
 const s=M.seed();M.selectScheme(s,'manual');assert.equal(M.derive(s).filter(x=>x.status==='pending').length,6);M.selectRule(s,'r1','silica-5');M.selectScheme(s,'auto');assert.equal(M.derive(s)[0].rule.thickness,5);M.selectScheme(s,'manual');assert.equal(M.derive(s)[0].rule.thickness,5);
});
test('blank dependencies omit weight and cost; changing material clears previous thickness',()=>{
 const s=M.seed();M.selectRule(s,'r1','silica-5');M.setMaterial(s,'r1','linen');assert.equal(s.rows[0].manualRuleId,null);M.setDimension(s,'r1',null);assert.equal(M.derive(s)[0].status,'blank');assert.equal(M.derive(s)[0].cost,null);M.setMaterial(s,'r6','');assert.equal(M.derive(s)[5].status,'blank');assert.throws(()=>M.setDimension(s,'r2',{width:-1,length:60}));
});
test('batch respects material scope and confirmed values unless overwrite explicitly requested',()=>{
 const s=M.seed();assert.equal(M.applyBatch(s,s.rows.map(r=>r.id),'silica','silica-27'),3);assert.equal(M.derive(s)[0].rule.thickness,3);assert.equal(M.derive(s)[3].status,'pending');assert.equal(M.derive(s)[5].status,'pending');assert.equal(M.applyBatch(s,['r1'],'silica','silica-5',true),1);assert.equal(M.derive(s)[0].rule.thickness,5);assert.throws(()=>M.selectRule(s,'r1','linen-3'));
});
test('save validates without mutation, soft-deleted current scheme remains usable',()=>{
 const s=M.seed(),before=structuredClone(s);assert.throws(()=>M.saveScheme(s,{id:'new',name:'  ',mode:'manual',defaults:{}}));assert.deepEqual(s,before);assert.throws(()=>M.saveScheme(s,{id:'new',name:'新方案',mode:'defaults',defaults:{linen:'silica-3'}}));M.removeScheme(s,'auto');assert.equal(M.derive(s)[0].status,'ready');assert.throws(()=>M.selectScheme(s,'auto'));M.saveScheme(s,{...s.schemes[0],deleted:false});M.selectScheme(s,'auto');assert.equal(s.schemeId,'auto');
});
test('product grouping uses platform/shop/product and never groups missing IDs together',()=>{
 const s=M.seed();assert.deepEqual(M.productGroups(s).map(g=>g.rows.length),[3,1,2]);
 s.rows.push({...structuredClone(s.rows[0]),id:'other-shop',shopId:'second'});
 assert.equal(M.productGroups(s).length,4);
 s.rows[0].productId='';s.rows[1].productId='';
 assert.notEqual(M.groupKey(s.rows[0]),M.groupKey(s.rows[1]));
});
test('group material and thickness update atomically while independent SKU dimensions remain',()=>{
 const s=M.seed(),ids=M.productGroups(s)[0].rows.map(r=>r.id),before=s.rows.map(r=>structuredClone(r.dimension));
 const patch={material:'linen',thickness:{materialId:'linen',ruleId:'linen-5'}};
 const preview=M.previewReview(s,ids,patch,true);assert.deepEqual(s.rows.map(r=>r.dimension),before);assert.equal(s.rows[0].materialId,'silica');
 assert.equal(preview.counts.material,3);assert.equal(preview.counts.thickness,3);
 M.applyReview(s,ids,patch,true);assert(s.rows.slice(0,3).every(r=>r.materialId==='linen'&&r.manualRuleId==='linen-5'));assert.deepEqual(s.rows.map(r=>r.dimension),before);assert.equal(s.rows[3].materialId,'linen');assert.equal(s.rows[3].manualRuleId,null);
});
test('batch keep/value/blank changes only requested pending fields and protects manual values',()=>{
 const s=M.seed();M.selectRule(s,'r2','silica-5');
 const result=M.applyReview(s,['r2','r5','r6'],{material:'silica',dimension:{width:60,length:120}},false);
 assert.equal(result.counts.material,1);assert.equal(result.counts.dimension,1);assert.equal(s.rows[1].manualRuleId,'silica-5');assert.deepEqual(s.rows[1].dimension,{width:50,length:80});assert.equal(s.rows[5].materialConfirmed,true);assert.equal(M.derive(s)[5].thicknessStatus,'pending');
 M.applyReview(s,['r1'],{material:''},true);assert.equal(M.derive(s)[0].area,.24);assert.equal(M.derive(s)[0].cost,null);
 M.applyReview(s,['r4'],{dimension:null},true);assert.equal(s.rows[3].materialId,'linen');assert.equal(M.derive(s)[3].area,null);
 M.selectScheme(s,'defaults');assert.equal(M.derive(s)[0].materialStatus,'blank');assert.equal(M.derive(s)[3].dimensionStatus,'blank');
});
test('invalid batch rolls back all fields, and material switch forces new thickness confirmation',()=>{
 const s=M.seed(),before=structuredClone(s);
 assert.throws(()=>M.applyReview(s,['r1','r2'],{material:'linen',thickness:{materialId:'linen',ruleId:'invalid'}},true));assert.deepEqual(s,before);
 M.setMaterial(s,'r1','linen');assert.equal(M.derive(s)[0].thicknessStatus,'pending');assert.equal(s.rows[0].manualRuleId,null);
});
test('material and dimension modes are independent and never reapply over confirmed blanks',()=>{
 const s=M.seed();M.saveScheme(s,{...s.schemes[0],materialMode:'manual',dimensionMode:'manual'});let rows=M.derive(s);assert(rows.every(r=>r.materialStatus==='pending'&&r.dimensionStatus==='pending'));
 M.setMaterial(s,'r1','silica');M.setDimension(s,'r1',{width:40,length:60});assert.equal(M.derive(s)[0].status,'ready');
 M.setMaterial(s,'r2','');M.setDimension(s,'r2',null);assert.equal(M.derive(s)[1].status,'blank');M.selectScheme(s,'defaults');assert.equal(M.derive(s)[1].status,'blank');
});
