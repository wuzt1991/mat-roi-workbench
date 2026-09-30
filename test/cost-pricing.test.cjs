'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const M=require('../public/domain.js'),P=require('../public/pricing-rules.js'),R=require('../public/reusable-rules.js'),A=require('../public/promotion-rules.js'),W=require('../public/workbook.js'),E=require('../public/assets/exceljs.min.js'),{appHarness}=require('./app-harness.cjs');
const legacy=require('./fixtures/pricing-1.2.16.json');
function setup(type='uniform'){
 const s=M.clone(legacy.state);s.records=[];s.plans=s.plans.filter(p=>p.strategyId==='capture-'+type);const p=s.plans[0];s.active=p.id;
 Object.assign(p.params,{fee:5,tax:3,spend:100,actualRoi:3});
 return {s,p,strategy:s.pricingStrategies.find(x=>x.id===p.strategyId)};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function checkRow(row,params){
 const c=row.material+row.baseShipping+row.price*(params.fee+params.tax)/100;
 near(row.grossMargin,(row.price-c)/c*100);
 if(row.targetMargin!==null){assert.ok(row.grossMargin>=row.targetMargin-1e-8);const previous=row.price-.01,oldCost=row.material+row.baseShipping+previous*(params.fee+params.tax)/100;assert.ok((previous-oldCost)/oldCost*100<row.targetMargin);}
}
test('成本反推支持 100% 以上目标、精确分价边界及不可达费率',()=>{
 assert.equal(P.quote(12,60,5,3).price,22.02);assert.deepEqual(P.quote(10,200),{price:30,margin:200,targetMargin:200});
 assert.equal(P.quote(10,100,25,0).price,40);assert.equal(P.quote(.1,200,0,0).price,.3);
 for(const args of [[12,100,50,0],[12,100,50.0001,0],[0,60,5,3],[12,'',5,3],[12,60,Infinity,3],[12,60,-1,3],[1e12,200,0,0]])assert.ok(P.quote(...args).error,args.join(','));
 assert.equal(P.quote(12,100,49.9999,0).price,12000000);
 // Independent integer ledger, with costs in cents, targets/fees in hundredths
 // of a percent. Verify exact target achievement and one-cent minimality.
 let seed=913;const rand=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
 for(let i=0;i<3000;i++){
  const b=1+rand(200000),m=rand(50001),f=rand(1001),t=rand(1001),q=P.quote(b/100,m/100,f/100,t/100),growth=10000n+BigInt(m),den=100000000n-BigInt(f+t)*growth;
  if(den<=0n){assert.ok(q.error);continue;}
  const cents=BigInt(Math.round(q.price*100)),costTarget=BigInt(b)*10000n*growth;
  assert.ok(cents*den>=costTarget);assert.ok((cents-1n)*den<costTarget);
 }
});
test('统一、阶梯、面积策略的目标与显示毛利一致，方案允许超过 100%',()=>{
 for(const type of ['uniform','rank','area']){
  let {s,p,strategy}=setup(type);
  Object.assign(strategy,type==='uniform'?{margin:160}:type==='rank'?{tiers:[100,150,200],fallback:250}:{baseArea:.12,baseMargin:60,stepArea:.1,stepPoints:110,cap:200});
  assert.ok(P.valid(strategy));assert.ok(M.validateBackup(s));
  for(const row of M.calculate(s,p).rows)checkRow(row,p.params);
  const h=appHarness(s);h.ui.open('reusable',{kind:'pricingStrategies',id:strategy.id,draft:M.clone(strategy)});
  assert.match(h.elements.get('#dialog').innerHTML,/毛利率 = 利润 ÷ 成本/);assert.doesNotMatch(h.elements.get('#dialog').innerHTML,/销售口径|max="99\.99"/);
  h.ui.saveModal();assert.equal(h.ui.modal,null);assert.ok(M.validateBackup(h.ui.state));
 }
});
test('截图面积策略按完整面积档递增，零费率时 60% 对应售价为成本的 1.6 倍',()=>{
 const {s,p,strategy}=setup('area');Object.assign(strategy,{baseArea:.24,baseMargin:60,stepArea:.1,stepPoints:10,cap:90});Object.assign(p.params,{fee:0,tax:0});
 const expected=[[.12,60],[.24,60],[.3399,60],[.34,70],[.44,80],[.54,90],[2,90]];
 for(const [area,margin] of expected)assert.equal(P.target(strategy,{area},[]),margin);
 for(const row of M.calculate(s,p).rows){checkRow(row,p.params);assert.equal(row.targetMargin,60);assert.ok(row.price<=(row.material+row.baseShipping)*1.6+.01);}
});
test('材料、单次运费、费率和厚度变更联动策略；手动价、恢复策略、复制和取消跟随正确',()=>{
 let {s,p}=setup();const original=M.calculate(s,p).rows[0].price;
 const material=s.materials.find(x=>x.id===p.materialId),rule=M.materialRule(material,p);
 if(rule)rule.costPerSqm+=10;else material.price+=10;
 s=R.save(s,'materials',material);p=s.plans[0];assert.ok(M.calculate(s,p).rows[0].price>original);
 const shipping=s.shippingTemplates.find(x=>x.id===p.shippingId);shipping.fee+=2;s=R.save(s,'shippingTemplates',shipping);p=s.plans[0];p.params.fee=10;
 for(const row of M.calculate(s,p).rows)checkRow(row,p.params);
 s=R.setItemPrice(s,p.id,p.items[0].id,50);p=s.plans[0];assert.equal(M.calculate(s,p).rows[0].price,50);p.params.tax=4;assert.equal(M.calculate(s,p).rows[0].price,50);
 s=R.resumePrice(s,p.id,p.items[0].id);p=s.plans[0];checkRow(M.calculate(s,p).rows[0],p.params);
 const before=M.calculate(s,p).rows.map(x=>x.price),copy=R.copyPlan(s,p.id,'成本口径副本');assert.deepEqual(M.calculate(copy,copy.plans.at(-1)).rows.map(x=>x.price),before);
 const stopped=R.setStrategy(s,p.id,'');assert.deepEqual(M.calculate(stopped,stopped.plans[0]).rows.map(x=>x.price),before);
 // A different plan's cost ranks cannot influence this plan.
 const other=M.clone(p);other.id='unrelated';other.name='其他计划';other.items=other.items.map(x=>({...x,id:x.id+'-other'}));s.plans.push(other);assert.deepEqual(M.calculate(s,p).rows.map(x=>x.price),before);
});
test('活动逆算、实际界面及后台价格表使用相同的成本目标售价',async()=>{
 const {s,p}=setup('area');const scheme={id:'cost-promotion',name:'多步活动',steps:[{type:'discount',discount:8.83},{type:'reduction',amount:1.15},{type:'discount',discount:9.5}],deleted:false};s.promotionSchemes.push(scheme);p.promotionSchemeId=scheme.id;
 const rows=M.calculate(s,p).rows,h=appHarness(s);h.ui.open('listing-calculator');const html=h.elements.get('#dialog').innerHTML;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cost-listing-test-'));
 try{const result=await require('../server/auxiliary-file-jobs.cjs').handlers['export-listing']({state:s,planId:p.id},{outputDir:dir});const book=new E.Workbook();await book.xlsx.load(await fs.readFile(result.artifactPath));
  for(const [i,row] of rows.entries()){
   const q=A.reverse(row.price,scheme);assert.ok(P.actualMargin(row.material+row.baseShipping,q.finalPrice,p.params.fee,p.params.tax)>=row.targetMargin);assert.match(html,new RegExp(row.price.toFixed(2).replace('.','\\.')));
   assert.equal(book.getWorksheet('上架价格').getCell(i+2,4).value,row.price);assert.equal(book.getWorksheet('上架价格').getCell(i+2,6).value,q.finalPrice);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('真实 1.2.16 格式 5/6/7 备份严格兼容；恢复后当前策略更新、历史账目不变',async()=>{
 for(const format of [5,6,7]){
  assert.deepEqual(W.tables(legacy.state,format),legacy.tables[format]);
  const book=new E.Workbook();for(const [name,rows] of legacy.tables[format])book.addWorksheet(name).addRows(rows);book.addWorksheet('恢复数据').addRows([['MAT-ROI-XLSX',format],[0,JSON.stringify(legacy.state)]]);
  const restored=await W.importWorkbook(await book.xlsx.writeBuffer());assert.deepEqual(restored.records,legacy.state.records);
  for(const p of restored.plans)for(const row of M.calculate(restored,p).rows)checkRow(row,p.params);
  assert.deepEqual(M.calculate(restored.records[0].frame,restored.records[0].frame.plan),M.calculate(legacy.state.records[0].frame,legacy.state.records[0].frame.plan));
 }
});
test('新格式 9 导出显示策略目标与实际毛利，完整恢复及篡改检测通过',async()=>{
 const {s,p}=setup();const bytes=await W.exportWorkbook(s),book=new E.Workbook();await book.xlsx.load(bytes);assert.equal(book.getWorksheet('恢复数据').getCell('B1').value,9);
 const rows=W.tables(s).find(x=>x[0]==='商品规格')[1],target=rows[0].indexOf('策略目标毛利率（利润÷成本，%）');assert.ok(target>0);
 for(const [i,row] of M.calculate(s,p).rows.entries()){assert.equal(rows[i+1][6],row.price);assert.equal(rows[i+1][17],row.grossMargin);assert.equal(rows[i+1][target],row.targetMargin);}
 assert.deepEqual(await W.importWorkbook(bytes),s);assert.doesNotMatch(JSON.stringify(W.tables(s)),/定价策略目标（销售口径）/);
 book.getWorksheet('商品规格').getCell(2,target+1).value+=1;await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/改动/);
});

test('材料面积与运费相加的浮点尾差不多收一分钱，真实小数边界仍向上取分',()=>{
 const {s,p,strategy}=setup();strategy.margin=0;Object.assign(p.params,{fee:0,tax:0});
 const size=s.sizes.find(x=>x.id===p.items[0].sizeId);Object.assign(size,{salesW:20,salesH:50,irregular:false});
 const mat=s.materials.find(x=>x.id===p.materialId);mat.price=1;mat.weightRules=[];mat.legacyCostFallback=true;p.materialRuleId='';
 const ship=s.shippingTemplates.find(x=>x.id===p.shippingId);Object.assign(ship,{type:'fixed',fee:.2});
 assert.equal(M.calculate(s,p).rows[0].price,.3);assert.equal(M.calculate(s,p).rows[0].grossMargin,0);
 ship.fee=.2000001;assert.equal(M.calculate(s,p).rows[0].price,.31);
 Object.assign(ship,{type:'step',firstWeight:.05,firstFee:.1,stepWeight:.05,stepFee:.2,maxWeight:1});p.items[0].weight=.1;
 assert.equal(M.calculate(s,p).rows[0].price,.4);assert.equal(M.calculate(s,p).rows[0].grossMargin,0);
});

test('真实 1.2.17 格式 8 含待核对尺寸也可恢复，恢复后新策略安全暂停',async()=>{
 const fixture=require('./fixtures/backup-1.2.17.json');
 for(const {pending,state,tables} of fixture.cases){
  assert.deepEqual(W.tables(state,8),tables);
  const book=new E.Workbook();for(const [name,rows] of tables)book.addWorksheet(name).addRows(rows);book.addWorksheet('恢复数据').addRows([['MAT-ROI-XLSX',8],[0,JSON.stringify(state)]]);
  const restored=await W.importWorkbook(await book.xlsx.writeBuffer());assert.deepEqual(restored,state);
  for(const plan of restored.plans)for(const row of M.calculate(restored,plan).rows)if(pending){assert.equal(row.price,'');assert.ok(row.priceError);}else checkRow(row,plan.params);
  assert.deepEqual(await W.importWorkbook(await W.exportWorkbook(restored)),restored);
 }
});
