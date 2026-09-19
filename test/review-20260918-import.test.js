const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../public/review-20260918-model.js'),I=require('../public/review-20260918-import.js'),X=require('../public/assets/exceljs.min.js');
const setup=()=>{const s=R.seed();return {s,shop:s.shops[0],p:I.analyzeProducts(I.productExample(),s)};};
test('型号噪音不做尺寸，多候选及混合单位正确处理',()=>{assert.equal(I.dimensionCandidates('MZJ90-3;40*60cm')[0].area,.24);assert.equal(I.dimensionCandidates('编号123 3mm 红色').length,0);assert.equal(I.dimensionCandidates('40-60').length,0);assert.equal(I.dimensionCandidates('40*60*3mm').length,0);assert.equal(I.dimensionCandidates('400mm×60cm')[0].width,40);assert.equal(I.dimensionCandidates('40*60cm','400*600mm').length,1);assert.equal(I.dimensionCandidates('40*60cm / 50*80cm').length,2);});
test('伪亚麻必须人工确认，普通长词不重叠命中',()=>{const {p}=setup();assert.equal(p.rows[1].materialStatus,'pending');assert.equal(p.rows[4].material,'冰丝水洗底');assert.deepEqual(p.rows[4].issues,['未写厚度，请人工确认']);});
test('材质与尺寸分别留空，清除依赖值且不会重新自动填充',()=>{const {s,p}=setup();I.reviewProduct(p,[p.rows[0].id],{material:''},s);assert.equal(p.rows[0].values[8],.24);assert.equal(p.rows[0].values[11],'');assert.equal(p.rows[0].values[12],'');I.recalculateProducts(p,s);assert.equal(p.rows[0].materialStatus,'blank');I.reviewProduct(p,[p.rows[4].id],{dimensions:null},s);assert.equal(p.rows[4].values[5],'冰丝水洗底');assert.equal(p.rows[4].values[8],'');assert.equal(p.rows[4].values[11],'');});
test('确认伪亚麻留空后可导出真空单元格，模板 29 列和文本 ID 保留',async()=>{
  const {s,p}=setup();await assert.rejects(()=>I.exportProducts(p,s),/待复核/);
  I.reviewProduct(p,[p.rows[1].id],{material:''},s);
  I.reviewProduct(p,[p.rows[2].id],{dimensions:null},s);
  I.reviewProduct(p,[p.rows[3].id],{material:'',dimensions:null},s);
  for(const index of [0,4]){const row=p.rows[index],rule=s.materials.find(m=>m.name===row.material).weightRules.find(r=>r.default);I.reviewProduct(p,[row.id],{thicknessRuleId:rule.id},s);}
  assert.equal(p.summary.ready,true);assert.equal(p.summary.blanks,3);
  const bytes=await I.exportProducts(p,s,fs.readFileSync('public/assets/product-template.xlsx'));
  const book=new X.Workbook();await book.xlsx.load(bytes);const sheet=book.worksheets[0];
  assert.equal(sheet.columnCount,29);assert.equal(sheet.rowCount,6);
  assert.equal(sheet.getCell('F3').value,null);assert.equal(sheet.getCell('I3').value,.5);assert.equal(sheet.getCell('L3').value,null);assert.equal(sheet.getCell('M3').value,null);
  assert.equal(sheet.getCell('F4').value,'亚麻');assert.equal(sheet.getCell('H4').value,null);assert.equal(sheet.getCell('I4').value,null);
  assert.equal(sheet.getCell('R2').type,X.ValueType.String);assert.equal(sheet.getCell('S2').value,'S-01');
  sheet.eachRow(row=>row.eachCell(cell=>assert.equal(cell.formula,undefined)));
});
test('批量只改指定行和字段，原始规格始终保留',()=>{const {s,p}=setup(),before=structuredClone(p.rows[1]);I.reviewProduct(p,[p.rows[0].id],{dimensions:null},s);assert.deepEqual(p.rows[1],before);assert.equal(p.rows[0].originalSpec,'MZJ90-3;40*60cm');assert.equal(p.rows[0].material,'硅藻泥');});
test('销售导入匹配 SKU，重复导入替换不累加，不覆盖售价',()=>{const {s,shop}=setup();const draft=I.analyzeSales(I.salesExample(shop),shop,s);draft.filename='销量.xlsx';shop.rows[0].priceMode='manual';shop.rows[0].manualPrice=88;I.applySales(draft,shop);const first=JSON.stringify(shop);I.applySales(draft,shop);assert.equal(JSON.stringify(shop),first);assert.equal(shop.rows[0].manualPrice,88);assert.equal(shop.rows.reduce((a,r)=>a+r.sales,0),130);assert.ok(Math.abs(shop.rows.reduce((a,r)=>a+r.share,0)-100)<1e-8);});
test('未匹配、零销量、未覆盖 SKU 和件数口径均需明确处理',()=>{const {s,shop}=setup();let draft=I.analyzeSales([['SKU ID','支付订单数'],['unknown',10]],shop,s);draft.period='9月';assert.throws(()=>I.applySales(draft,shop),/匹配/);draft.items[0].match=shop.rows[0].id;assert.throws(()=>I.applySales(draft,shop),/未覆盖/);draft.missing='zero';I.applySales(draft,shop);assert.equal(shop.rows[0].share,100);assert.equal(shop.rows[1].sales,0);draft.items[0].count=0;assert.throws(()=>I.applySales(draft,shop),/总销量/);
  draft=I.analyzeSales([['SKU ID','销售件数'],[shop.rows[0].skuId,2]],shop,s);draft.period='9月';draft.missing='zero';assert.throws(()=>I.applySales(draft,shop),/件数/);draft.allowUnits=true;I.applySales(draft,shop);
});
test('销售表真实 Excel 可读取，文本 SKU ID 与前导零保留',async()=>{const rows=[['SKU ID','支付订单数'],['000123',10]],bytes=await I.simpleWorkbook(rows,'销售');assert.deepEqual(await I.readRows(bytes),rows);});
test('名称厚度可识别，名称与规格冲突时人工确认',()=>{
  const {s}=setup();const rows=I.productExample();rows[1][2]='硅藻泥 5mm 地垫';rows[1][3]='40*60cm';let result=I.analyzeProducts(rows,s);assert.equal(result.rows[0].values[11],.24*1.3);
  rows[1][3]='40*60cm 3mm';result=I.analyzeProducts(rows,s);assert.equal(result.rows[0].values[11],'');assert.match(result.rows[0].thicknessReason,/多个厚度/);
});
test('多个厚度不能静默选一个默认规则',()=>{const {s}=setup(),rows=I.productExample();rows[1][2]='硅藻泥 3mm 5mm 地垫';rows[1][3]='40*60cm';const r=I.analyzeProducts(rows,s);assert.ok(r.rows[0].issues.some(x=>x.includes('厚度')));assert.equal(r.rows[0].values[11],'');});

const integrated=()=>{const s=R.seed();return {s,p:I.analyzeProducts(I.integratedProductExample(),s)};};
const ruleId=(s,name,thickness)=>s.materials.find(m=>m.name===name).weightRules.find(r=>r.thickness===thickness&&!r.variant).id;
test('六行综合示例保留明确厚度、缺失、未知、冲突及伪亚麻状态',()=>{
  const {p}=integrated();assert.equal(p.summary.pending,5);assert.equal(p.summary.thicknessPending,4);
  assert.deepEqual(I.productGroups(p).map(g=>g.rows.length),[3,1,2]);
  assert.equal(p.rows[0].values[11],.24*.9);assert.equal(p.rows[0].values[12],.24*9.5);
  assert.deepEqual(p.rows.filter(r=>r.thicknessCandidates.length===0).map(r=>r.id),['transfer-1','transfer-3']);
  assert.match(p.rows[2].thicknessReason,/没有对应规则/);assert.equal(p.rows[4].dimensionStatus,'pending');
});
test('不读取旧默认厚度或全人工策略，未写厚度始终保持待确认',()=>{
  const {s,p}=integrated();for(const mode of ['default','manual']){p.thicknessPolicy={mode,defaults:{硅藻泥:ruleId(s,'硅藻泥',3)}};I.recalculateProducts(p,s);assert.equal(p.thicknessPolicy,undefined);assert.equal(p.rows[0].thicknessStatus,'value');assert.equal(p.rows[1].thicknessStatus,'pending');}
});
test('只有商品名称用于材质识别，规格里的伪亚麻仍要求人工确认',()=>{
  const {s}=integrated(),source=I.productExample();source[1][2]='浴室地垫';source[1][3]='硅藻泥 40×60cm / 3mm';let p=I.analyzeProducts(source,s);assert.equal(p.rows[0].materialStatus,'pending');
  source[1][2]='硅藻泥地垫';source[1][3]='伪亚麻 40×60cm / 3mm';p=I.analyzeProducts(source,s);assert.equal(p.rows[0].materialStatus,'pending');assert.equal(p.rows[0].pseudo,true);
});
test('相同厚度多个规则不可静默取首项，删除人工规则后不自动替代',()=>{
  const {s,p}=integrated(),m=s.materials.find(m=>m.name==='硅藻泥'),rule=m.weightRules.find(r=>r.thickness===3);m.weightRules.push({...rule,id:'duplicate-3'});I.recalculateProducts(p,s);assert.equal(p.rows[0].thicknessStatus,'pending');assert.match(p.rows[0].thicknessReason,/多个厚度规则/);
  I.reviewProduct(p,[p.rows[0].id],{thicknessRuleId:rule.id},s);assert.equal(p.rows[0].thicknessStatus,'value');m.weightRules=m.weightRules.filter(r=>r.id!==rule.id);I.recalculateProducts(p,s);assert.equal(p.rows[0].thicknessStatus,'pending');assert.match(p.rows[0].thicknessReason,/不存在/);
});
test('材质或尺寸明确留空后不再要求厚度，恢复有效尺寸仍需确认厚度',()=>{
  const {s,p}=integrated(),row=p.rows[1];I.reviewProduct(p,[row.id],{dimensions:null},s);assert.equal(p.rows[1].thicknessStatus,'blank');assert.deepEqual(p.rows[1].issues,[]);assert.equal(p.rows[1].values[11],'');assert.equal(p.rows[1].values[12],'');
  I.reviewProduct(p,[row.id],{dimensions:{width:50,length:80}},s);assert.equal(p.rows[1].thicknessStatus,'pending');
  I.reviewProduct(p,[row.id],{material:''},s);assert.equal(p.rows[1].thicknessStatus,'blank');assert.deepEqual(p.rows[1].issues,[]);
});
test('手改材质使旧厚度失效，即使新材质原文厚度可匹配也等待人工确认',()=>{
  const {s,p}=integrated(),silica=s.materials.find(m=>m.name==='硅藻泥').weightRules.find(r=>r.thickness===3),linen=s.materials.find(m=>m.name==='亚麻');linen.weightRules.push({...silica,id:'linen-three'});
  I.reviewProduct(p,[p.rows[0].id],{material:'亚麻'},s);assert.equal(p.rows[0].thicknessStatus,'pending');assert.equal(p.rows[0].values[11],'');assert.equal(p.rows[0].thicknessRuleId,'');
  I.reviewProduct(p,[p.rows[0].id],{thicknessRuleId:'linen-three'},s);assert.equal(p.rows[0].thicknessStatus,'value');I.recalculateProducts(p,s);assert.equal(p.rows[0].thicknessSource,'人工确认');
});
test('商品分组保留完整 ID，跨平台、店铺不合并，缺少身份逐行隔离',()=>{
  const {p}=integrated();p.rows=p.rows.slice(0,3);const id='000123456789012345678901234567890';p.rows.forEach(r=>r.values[17]=id);assert.equal(I.productGroups(p).length,1);assert.equal(I.productGroups(p)[0].productId,id);
  p.rows[1].values[1]='淘宝';p.rows[2].values[2]='另一个店铺';assert.equal(I.productGroups(p).length,3);
  p.rows.forEach(r=>r.values[2]='');assert.equal(I.productGroups(p).length,3);assert.equal(new Set(I.productGroups(p).map(g=>g.key)).size,3);
});
test('批量预览只补待确认字段且不改源数据，兼容性按行计算',()=>{
  const {s,p}=integrated(),before=structuredClone(p),patch={thicknessRuleId:ruleId(s,'硅藻泥',3)},ids=p.rows.map(r=>r.id),out=I.previewProductReview(p,ids,patch,s);
  assert.deepEqual(p,before);assert.deepEqual(out.counts,{material:0,thickness:3,dimension:0});assert.equal(out.changed,3);assert.equal(out.protected,1);assert.equal(out.incompatible,2);
  assert.equal(out.result.rows[4].dimensionStatus,'pending');assert.equal(out.result.rows[3].thicknessStatus,'pending');
  const committed=I.applyProductReview(p,ids,patch,s);assert.deepEqual(committed.counts,out.counts);assert.deepEqual(p,out.result);
});
test('批量字段保护独立判断，待复核行的已确认材质与尺寸不被覆盖',()=>{
  const {s,p}=integrated(),ids=p.rows.map(r=>r.id),out=I.applyProductReview(p,ids,{material:'硅藻泥',dimensions:{width:40,length:60},thicknessRuleId:ruleId(s,'硅藻泥',3)},s);
  assert.deepEqual(out.counts,{material:1,thickness:4,dimension:1});assert.equal(out.changed,4);assert.equal(out.incompatible,1);
  assert.deepEqual(p.rows[1].dimensions,{width:50,length:80});assert.equal(p.rows[3].material,'亚麻');assert.equal(p.rows[5].material,'硅藻泥');assert.equal(p.rows[5].thicknessStatus,'value');
});
test('同链接显式覆盖材质和厚度不改变逐 SKU 尺寸，其他商品不变',()=>{
  const {s,p}=integrated(),group=I.productGroups(p)[0],before=structuredClone(p.rows),ids=group.rows.map(r=>r.id);
  const out=I.applyProductReview(p,ids,{material:'亚麻',thicknessRuleId:ruleId(s,'亚麻',5)},s,true);assert.equal(out.changed,3);assert.deepEqual(out.counts,{material:3,thickness:3,dimension:0});
  p.rows.slice(0,3).forEach((r,i)=>{assert.equal(r.material,'亚麻');assert.deepEqual(r.dimensions,before[i].dimensions);assert.equal(r.thicknessSource,'人工确认');});assert.deepEqual(p.rows.slice(3),before.slice(3));
});
test('无效尺寸、材质、不兼容厚度及过期选择均不产生部分写入',()=>{
  const {s,p}=integrated(),before=structuredClone(p),ids=p.rows.map(r=>r.id);
  for(const patch of [{material:'不存在'},{dimensions:{width:NaN,length:40}},{dimensions:{width:40,length:10001}},{thicknessRuleId:'missing'},{material:'亚麻',thicknessRuleId:ruleId(s,'硅藻泥',3)}]){assert.throws(()=>I.applyProductReview(p,ids,patch,s,true));assert.deepEqual(p,before);}
  assert.throws(()=>I.reviewProduct(p,ids,{dimensions:{width:90,length:100},thicknessRuleId:ruleId(s,'硅藻泥',3)},s),/不兼容/);assert.deepEqual(p,before);
  assert.throws(()=>I.applyProductReview(p,['missing'],{dimensions:null},s,true),/不存在/);assert.deepEqual(p,before);
});
test('批量无可更新字段不会报告成功，空值明确保留为 null',()=>{
  const {s,p}=integrated(),id=p.rows[0].id;assert.throws(()=>I.applyProductReview(p,[id],{},s),/至少选择/);assert.throws(()=>I.applyProductReview(p,[id],{dimensions:null},s),/没有需要更新/);
  const out=I.applyProductReview(p,[id],{dimensions:null},s,true);assert.equal(out.counts.dimension,1);assert.equal(p.rows[0].dimensions,null);assert.equal(p.rows[0].values[8],'');assert.equal(p.rows[0].values[11],'');assert.equal(p.rows[0].thicknessStatus,'blank');
});
test('批量只处理传入范围，保留原文未写厚度用于后续筛选',()=>{
  const {s,p}=integrated(),before=structuredClone(p.rows),ids=p.rows.filter(r=>!r.thicknessCandidates.length).map(r=>r.id);
  const out=I.applyProductReview(p,ids,{thicknessRuleId:ruleId(s,'硅藻泥',3)},s);assert.equal(out.changed,1);assert.equal(out.incompatible,1);
  assert.deepEqual(p.rows[0],before[0]);assert.deepEqual(p.rows[2],before[2]);assert.equal(p.rows[1].thicknessStatus,'value');assert.equal(p.rows[1].thicknessCandidates.length,0);
});


test('删除材料不改变已确认转表行的厚度成本，新导入不再识别该材料',()=>{
 const state=R.seed(),result=I.analyzeProducts(I.integratedProductExample(),state),before=structuredClone(result.rows[0]);
 const material=state.materials.find(m=>m.name===before.material);R.deleteReusable(state,'materials',material.id);
 I.recalculateProducts(result,state);assert.equal(result.rows[0].thicknessStatus,'value');assert.equal(result.rows[0].resolvedThicknessRuleId,before.resolvedThicknessRuleId);assert.equal(result.rows[0].values[12],before.values[12]);assert.equal(result.rows[0].values[11],before.values[11]);
 assert.equal(I.analyzeProducts(I.integratedProductExample(),state).rows[0].materialStatus,'pending');
});
