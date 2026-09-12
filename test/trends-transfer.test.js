const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js'),H=require('../public/trends.js'),T=require('../public/transfer.js'),W=require('../public/workbook.js'),Legacy=require('../public/legacy-domain.js'),Excel=require('../public/assets/exceljs.min.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const seed=()=>{const s=M.seed();s.records=[];return s;};
function enter(s,date,plan=s.plans[0],spend=1000,actualRoi=3){const frame=M.makeFrame(s,plan);Object.assign(frame.plan.params,{spend,actualRoi});return M.confirmRecord(s,{frame,date});}
const scope=(s,overrides={})=>({mode:'scoped',shopIds:[s.shops[0].id],planIds:[s.plans[0].id],from:'',to:'',...overrides});

test('两条历史线按实际日期合计：零值保留、负利润保留，缺失日期不补零',()=>{
  const s=seed();const a=enter(s,'2026-09-01'),b=enter(s,'2026-09-03',s.plans[0],2000,1);enter(s,'2026-09-04',s.plans[0],0,0);
  const r=H.series(s,{from:'2026-09-01',to:'2026-09-05',unit:'day'});
  assert.equal(r.points.length,5);assert.equal(r.count,3);close(r.points[0].investment,a.result.investment);close(r.points[2].profit,b.result.profit);
  assert.ok(r.points[2].profit<0);assert.equal(r.points[1].profit,null);assert.equal(r.points[1].investment,null);assert.equal(r.points[3].investment,0);assert.equal(r.points[3].profit,0);assert.equal(r.points[4].profit,null);
});
test('调价、修改当前草稿和删除计划不改变曲线，更正只采用最新有效版本',()=>{
  const s=seed(),a=enter(s,'2026-09-01'),frame=M.clone(a.frame);frame.plan.params.refund=20;
  const b=M.confirmRecord(s,{frame,date:'2026-09-01',previousId:a.id,reason:'更新实际退货'});enter(s,'2026-09-02').status='void';
  const expected=H.series(s);s.materials[0].price=999;s.sizes[0].salesW=999;s.shippingTemplates[0].fee=999;s.plans[0].params.spend='';s.plans[0].deleted=true;
  assert.deepEqual(H.series(s),expected);assert.equal(expected.count,1);close(expected.profit,b.result.profit);close(expected.investment,b.result.investment);
});
test('店铺、计划过滤和跨年周/月汇总，边缘周期标记为部分范围',()=>{
  const s=seed();enter(s,'2025-12-31');enter(s,'2026-01-01');enter(s,'2026-01-02',s.plans[1]);
  const day=H.series(s,{shopId:s.shops[0].id}),week=H.series(s,{shopId:s.shops[0].id,unit:'week'}),month=H.series(s,{unit:'month',from:'2025-12-31',to:'2026-01-31'});
  assert.equal(day.count,2);assert.equal(week.points.length,1);assert.equal(week.points[0].key,'2025-12-29');close(week.profit,day.profit);assert.equal(month.points.length,2);assert.ok(month.points[0].partial);assert.equal(month.points[1].partial,false);
  assert.equal(H.series(s,{shopId:s.shops[0].id,planId:s.plans[1].id}).count,0);
  assert.throws(()=>H.series(s,{from:'2026-09-30',to:'2026-09-01'}));assert.throws(()=>H.series(s,{from:'2026-02-30'}));
  assert.throws(()=>H.series(s,{from:'1900-01-01',to:'2026-09-01'}),/跨度/);
});
test('旧版日账总投入只由冻结报价和费用还原，旧版试算不进入趋势',()=>{
  const old=Legacy.seed(),p=old.plans[0],h=Legacy.createRecord(old,p,'2026-09-01');p.history.push(h);
  const s=M.migrate(old),before=H.series(s);close(before.investment,h.spend+h.gmv/h.price*h.cost);assert.equal(before.count,1);
  s.materials[0].price=900;assert.deepEqual(H.series(s),before);
  delete s.records.find(x=>x.id===h.id).legacy.params;const incomplete=H.series(s);assert.equal(incomplete.investment,null);assert.equal(incomplete.missingInvestment,1);close(incomplete.profit,h.profit);
});
test('按店铺和计划导出包含必要公共资料，可恢复空店铺',()=>{
  const s=seed();enter(s,'2026-09-01');enter(s,'2026-09-01',s.plans[1]);
  const subset=T.select(s,scope(s));assert.equal(subset.shops.length,1);assert.equal(subset.plans.length,1);assert.equal(subset.records.length,1);assert.equal(subset.materials.length,1);assert.equal(subset.shippingTemplates.length,1);assert.equal(subset.sizes.length,2);assert.ok(T.validScope(subset));assert.ok(M.validateBackup(subset));
  s.shops.push({id:'empty-shop',name:'空店铺',deleted:false});const empty=T.select(s,scope(s,{shopIds:['empty-shop'],planIds:[]}));assert.ok(M.validateBackup(empty));assert.equal(empty.plans.length,0);assert.equal(empty.records.length,0);
  assert.throws(()=>T.select(s,scope(s,{shopIds:[]})),/店铺/);assert.throws(()=>T.select(s,scope(s,{from:'2026-09-04',to:'2026-09-01'})),/日期/);
});
test('日期范围外的关联更正版本完整保留，合计不重复',async()=>{
  const s=seed(),a=enter(s,'2026-09-01'),b=M.confirmRecord(s,{frame:M.clone(a.frame),date:'2026-09-02',previousId:a.id,reason:'日期写错'});enter(s,'2026-09-03',s.plans[1]);
  const subset=T.select(s,scope(s,{from:'2026-09-01',to:'2026-09-01'}));assert.deepEqual(subset.exportScope.relatedIds,[b.id]);assert.equal(subset.records.length,2);assert.equal(M.ledger(subset,{from:'2026-09-01',to:'2026-09-01'}).count,0);
  const bytes=await W.exportWorkbook(subset),restored=await W.importWorkbook(bytes);assert.deepEqual(restored,JSON.parse(JSON.stringify(subset)));assert.ok(M.validateBackup(restored));
  const book=new Excel.Workbook();await book.xlsx.load(bytes);assert.equal(book.getWorksheet('导出范围').getCell('B9').value,1);assert.equal(book.getWorksheet('历史账目').getCell('P3').value,'关联更正版本');
});
test('合并恢复保留其他店铺、日期外账目和本机试算，重复导入不累计',()=>{
  const source=seed();enter(source,'2026-09-01');const incoming=T.select(source,scope(source)),target=seed();enter(target,'2026-09-03');enter(target,'2026-09-02',target.plans[1]);target.plans[0].params.refund=25;target.materials[0].price=25;target.prefs.ids=['investment'];
  const old=M.clone(target),first=T.merge(target,incoming);assert.equal(first.report.added,1);assert.equal(first.state.records.length,3);assert.deepEqual(first.state.plans,old.plans);assert.deepEqual(first.state.prefs,old.prefs);assert.equal(first.state.materials[0].price,25);assert.deepEqual(target,old);
  const second=T.merge(first.state,incoming);assert.equal(second.report.added,0);assert.equal(second.report.duplicates,1);assert.equal(second.report.resources,0);assert.deepEqual(second.state,first.state);
});
test('新计划的公共资料冲突时独立保存，不影响其他计划的报价与运费',()=>{
  const target=seed(),source=seed();source.shops[0].id='incoming-shop';source.plans[0].id='incoming-plan';source.plans[0].shopId='incoming-shop';source.materials[0].price=22;source.shippingTemplates[0].fee=5;source.sizes[0].salesW=31;
  enter(source,'2026-09-01');const incoming=T.select(source,scope(source)),merged=T.merge(target,incoming);const p=merged.state.plans.find(x=>x.id==='incoming-plan');
  assert.equal(merged.report.shops,1);assert.equal(merged.report.plans,1);assert.notEqual(p.materialId,target.plans[0].materialId);assert.notEqual(p.shippingId,target.plans[0].shippingId);close(M.calculate(merged.state,p).cost,M.calculate(source,source.plans[0]).cost);close(M.calculate(merged.state,target.plans[0]).cost,M.calculate(target,target.plans[0]).cost);assert.ok(M.validateBackup(merged.state));
});
test('可选择恢复已有计划的试算，公共资料冲突不会重算其他计划',()=>{
  const source=seed(),target=seed();source.materials[0].price=30;source.shippingTemplates[0].fee=10;source.plans[0].params.refund=20;
  target.plans[1].materialId=target.plans[0].materialId;target.plans[1].shippingId=target.plans[0].shippingId;
  const cost=M.calculate(target,target.plans[1]).cost,incoming=T.select(source,scope(source)),restored=T.merge(target,incoming,{restorePlans:true});
  assert.equal(restored.report.plansUpdated,1);assert.equal(restored.state.plans[0].params.refund,20);close(M.calculate(restored.state,restored.state.plans[0]).cost,M.calculate(source,source.plans[0]).cost);close(M.calculate(restored.state,restored.state.plans[1]).cost,cost);assert.deepEqual(target.materials,seed().materials);
});
test('导入较新更正更新状态，较旧备份不能复活旧账或覆盖最新更正',()=>{
  const source=seed(),a=enter(source,'2026-09-01'),older=M.clone(source),frame=M.clone(a.frame);frame.plan.params.refund=18;
  const b=M.confirmRecord(source,{frame,date:'2026-09-01',previousId:a.id,reason:'实退更新'}),merged=T.merge(older,T.select(source,scope(source)));
  assert.equal(merged.report.updated,1);assert.equal(merged.report.added,1);assert.equal(merged.report.conflicts.length,0);assert.equal(M.ledger(merged.state).count,1);close(M.ledger(merged.state).profit,b.result.profit);
  const reverse=T.merge(merged.state,T.select(older,scope(older)));assert.equal(reverse.report.conflicts.length,0);assert.deepEqual(reverse.state,merged.state);
});
test('同日不同账目及分叉更正明确报告冲突，保留本机整项计划账目',()=>{
  const a=seed(),b=seed();enter(a,'2026-09-01');enter(b,'2026-09-01');enter(b,'2026-09-02');
  let merged=T.merge(a,T.select(b,scope(b)));assert.equal(merged.report.conflicts.length,1);assert.deepEqual(merged.state.records,a.records);assert.equal(merged.report.added,0);
  const shared=seed(),original=enter(shared,'2026-09-01'),fork=M.clone(shared);
  M.confirmRecord(shared,{frame:M.clone(original.frame),date:'2026-09-01',previousId:original.id,reason:'A'});M.confirmRecord(fork,{frame:M.clone(original.frame),date:'2026-09-01',previousId:original.id,reason:'B'});
  merged=T.merge(shared,T.select(fork,scope(fork)));assert.equal(merged.report.conflicts.length,1);assert.deepEqual(merged.state.records,shared.records);
});
test('旧版 v0.5 Excel 仍可导入，新版导出范围被改动会拒绝恢复',async()=>{
  const s=seed();enter(s,'2026-09-01');const oldBook=new Excel.Workbook();for(const [name,rows] of W.tables(s,1))oldBook.addWorksheet(name).addRows(rows);const hidden=oldBook.addWorksheet('恢复数据');hidden.addRow(['MAT-ROI-XLSX',1]);hidden.addRow([0,JSON.stringify(s)]);
  const old=await W.importWorkbook(await oldBook.xlsx.writeBuffer());assert.deepEqual(old,JSON.parse(JSON.stringify(s)));
  const book=new Excel.Workbook();await book.xlsx.load(await W.exportWorkbook(s,scope(s)));book.getWorksheet('导出范围').getCell('B6').value='2026-09-08';await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/改动/);
  const subset=T.select(s,scope(s));subset.exportScope.relatedIds.push('missing');assert.equal(T.validScope(subset),false);assert.throws(()=>T.merge(s,subset),/检查/);
});
