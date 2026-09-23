const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js'),E=require('../public/rules-editor.js'),Shell=require('../public/workbench-shell.js');
test('规则编辑失败不修改工作区或草稿，返回原字段定位',()=>{
 const state=M.initialState(),before=M.clone(state),draft=M.clone(state.materials[0]);draft.weightRules=[{id:'bad',thickness:3,coefficient:-1,costPerSqm:1}];
 const editor={type:'material',id:draft.id,draft},original=M.clone(editor);
 assert.throws(()=>E.save(state,editor),e=>e.selector==='[data-material-rule="0"][data-rule-key="coefficient"]');
 assert.deepEqual(state,before);assert.deepEqual(editor,original);
});
test('保存内置区域模板不允许编辑草稿覆盖费率或计费类型',()=>{
 const state=M.initialState(),before=M.clone(state),original=state.shippingTemplates[0];
 const {state:next}=E.save(state,{type:'shipping',id:original.id,draft:{...M.clone(original),name:'重命名',type:'fixed',fee:0,rates:{},provider:'篡改',ignoreWaybillFee:false}});
 const saved=next.shippingTemplates[0];assert.equal(saved.name,'重命名');
 for(const k of ['type','rates','provider','ignoreWaybillFee'])assert.deepEqual(saved[k],original[k]);assert.deepEqual(state,before);
});
test('尺寸创建仅返回候选，父窗口选中项不被提前修改',()=>{
 const state=M.initialState(),editor={type:'size',draft:{name:'测试',salesW:33,salesH:66},parent:{ids:[]}};
 const next=E.save(state,editor);assert.equal(state.sizes.length+1,next.state.sizes.length);assert.ok(next.addedSizeId);assert.deepEqual(editor.parent.ids,[]);
});
test('功能切页与销毁统一管理，保存保护覆盖隐藏销售草稿',()=>{
 const events=[];let salesSafe=false;
 const shell=Shell.create({product:()=>({activate:c=>events.push(['mount',c]),deactivate:()=>events.push('leave'),destroy:()=>events.push('product destroyed'),canQuit:()=>true}),sales:()=>({canQuit:()=>salesSafe,destroy:()=>events.push('sales destroyed')}),context:()=>({planId:'p'})});
 shell.navigate('product');shell.mount();shell.navigate('library');shell.mount();
 assert.deepEqual(events,[['mount',{planId:'p'}],'leave']);assert.equal(shell.canQuit(),false);salesSafe=true;assert.equal(shell.canQuit(),true);shell.destroy();assert.deepEqual(events.slice(-2),['product destroyed','sales destroyed']);
});
const Entries=require('../public/operating-records/entries.js'),Sales=require('../public/sales-import/model.js'),S=require('../public/sales-import.js');
test('冻结入账、更正、保存重试和作废只生成候选，不改试算或原记录金额',()=>{
 const state=M.seed();state.records=[];const before=M.clone(state),plan=state.plans[0],draft=Entries.start(state,plan,null,'2026-09-01');
 draft.frame.plan.params.actualGmv=500;draft.frame.plan.params.spend=100;
 const posted=Entries.confirm(state,draft),record=posted.records[0];assert.deepEqual(state,before);assert.equal(record.result.gmv,500);assert.deepEqual(posted.plans,state.plans);
 const retried=Entries.confirm(posted,{...draft,committed:true});assert.equal(retried.records.length,1);
 const correction=Entries.start(posted,plan,record);correction.reason='核对';correction.frame.plan.params.actualGmv=700;
 const corrected=Entries.confirm(posted,correction);assert.equal(posted.records[0].status,'confirmed');assert.equal(corrected.records[0].status,'superseded');assert.deepEqual(corrected.records[0].result,record.result);
 const active=corrected.records.find(h=>h.status==='confirmed'),voided=Entries.voidRecord(corrected,active.id);assert.equal(corrected.records.find(h=>h.id===active.id).status,'confirmed');assert.deepEqual(voided.records.find(h=>h.id===active.id).frame,active.frame);assert.equal(require('../public/operating-records/queries.js').summary(voided).count,0);
});
test('入账草稿的多材料成本校验独立于折叠区和 DOM',()=>{
 const state=M.seed(),plan=state.plans[0],draft=Entries.start(state,plan,null,'2026-09-01');
 const material=draft.frame.materials[0];material.weightRules=[{id:'one',thickness:3,coefficient:1,costPerSqm:10,default:true},{id:'two',thickness:5,coefficient:2,costPerSqm:-1}];
 draft.frame.plan.materialRuleId='one';draft.frame.plan.items.forEach((i,n)=>{i.materialRuleId=n?'two':'one';});
 assert.throws(()=>Entries.validate(draft),e=>e.selector?.includes('data-entry-rule="two"'));
});
test('销售提交校验工作区、规格、版本，候选计算不改源数据且重复提交不重复累计',()=>{
 const state=M.seed(),p=state.plans[0],before=M.clone(state),context={workspaceId:'isolated',storageEpoch:2,revision:7};
 const payload={planId:p.id,workspaceId:'isolated',storageEpoch:2,skuFingerprint:S.fingerprint(p),importId:'test-import',filename:'销量.xlsx',period:'2026-09-01',basis:'orders',matchBy:'size',excluded:0,missingPolicy:'zero',items:p.items.map((i,n)=>({itemId:i.id,count:n+1,bind:false}))};
 const next=Sales.prepareCommit(state,payload,{expectedRevision:7},context);assert.deepEqual(state,before);const changed=next.state.plans[0];assert.equal(changed.items.reduce((n,i)=>n+i.share,0),100);assert.equal(changed.salesSource.total,p.items.length*(p.items.length+1)/2);assert.equal(Sales.prepareCommit(next.state,payload,{},context).duplicate,true);
 for(const patch of [{workspaceId:'wrong'},{storageEpoch:3},{skuFingerprint:'old'}])assert.throws(()=>Sales.prepareCommit(state,{...payload,...patch},{},context));
 assert.throws(()=>Sales.prepareCommit(state,payload,{expectedRevision:6},context));assert.deepEqual(state,before);
});
test('销售与规则视图只读，分页裁剪不写复核状态',()=>{
 const controller=require('../public/sales-import/controller.js').create();controller.state.step='review';controller.state.page=99;
 const before=M.clone(controller.state),view=require('../public/sales-import/views.js').create({state:controller.state,selectors:controller});view.html();assert.deepEqual(controller.state,before);
 const state=M.seed(),original=M.clone(state),draft={kind:'sizeSchemes',draft:{name:'尺寸组合',sizeIds:[]}};
 const views=require('../public/rules-views.js').create({state,modal:draft,libraryTab:'materials'});views.libraryPage();views.reusableForm();assert.deepEqual(state,original);
});
test('纯边界不读取 DOM、网络或数据库，适配层不写销售复核字段',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const file of ['rules-editor.js','rules-views.js','sales-import/model.js','sales-import/controller.js','sales-import/views.js','operating-records/queries.js','operating-records/entries.js','operating-records/entry-views.js','compatibility.js']){
  const source=fs.readFileSync(path.join(__dirname,'../public',file),'utf8');assert.doesNotMatch(source,/\b(?:document|fetch|localStorage|sessionStorage)\b|node:sqlite/,file);
 }
 const adapter=fs.readFileSync(path.join(__dirname,'../public/sales-import-ui.js'),'utf8');assert.doesNotMatch(adapter,/local\.\w+\s*=(?!=)/);
});
