'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const baseline=path.resolve(process.env.MAT_BASELINE_ROOT),candidate=path.resolve(process.env.MAT_VERIFY_ROOT||path.join(__dirname,'../..')),out=path.resolve(process.env.MAT_VERIFY_OUTPUT);
const rules={materials:[{id:'m',name:'硅藻泥',weightRules:[{id:'3',thickness:3,coefficient:.9,costPerSqm:10},{id:'5',thickness:5,coefficient:1.2,costPerSqm:20}]}]};
const report={baseline,candidate,checks:[],ignoredNonBusinessFields:['operationId (random UUID)','timestamps','additional idempotency receipts'],passed:false};
const dirs=[];fs.mkdirSync(out,{recursive:true});
function load(root){return {root,R:require(path.join(root,'public/product-recognition.js')),Store:require(path.join(root,'server/import-session-store.cjs')).ImportSessionStore,Reader:require(path.join(root,'server/xlsx-stream-reader.cjs')),exportProduct:require(path.join(root,'server/product-stream-export.cjs')).exportProduct};}
function build(engine){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-refactor-equivalence-'));dirs.push(dir);
 const mapping=engine.R.mapFields(['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存']);
 const store=new engine.Store(dir,{create:true,meta:{ownerToken:'o',workspaceId:'isolated',storageEpoch:0,kind:'product',rules,mapping}});
 const rows=Array.from({length:4},(_,i)=>{const values=['抖音',i===3?'另一店':'店','硅藻泥商品',i===2?'50*80cm':'40*60cm',i<2?'000000000000000001':'000000000000000002',String(i).padStart(20,'0'),20,'在售',0],raw={rowId:i+1,sheetId:'sheet',sourceRow:i+2,values,mapping},d=engine.R.deriveTransferRow(raw,{},{rules});return {...raw,platform:d.platform,shop:d.shop,productId:d.productId,skuId:d.skuId,groupId:d.groupId,sourceHash:String(i)};});
 store.insertRawBatch(rows);store.rebuildDerived(rules,{applyUniformThickness:true,thicknessDefaults:{m:'3'}});
 return {...engine,dir,store};
}
function business(s){return {raw:s.db.prepare('SELECT row_id,sheet_id,source_row,raw_json,group_id FROM raw_rows ORDER BY row_id').all(),reviews:s.db.prepare('SELECT row_id,review_json,revision FROM reviews ORDER BY row_id').all(),derived:s.db.prepare('SELECT row_id,derived_json FROM derived_rows WHERE generation=? ORDER BY row_id').all(s.getMeta('generation')),groups:s.page({view:'products'}),revision:s.getMeta('revision')};}
async function main(){
 const old=build(load(baseline)),next=build(load(candidate)),compare=name=>{assert.deepEqual(business(next.store),business(old.store));report.checks.push(name);};
 try{
  compare('uniform import');const first=next.store.page().rows[0].derived;
  assert.equal(first.size.area,.24);assert.equal(first.weight,.216);assert.equal(first.cost,2.4);assert.equal(first.values[17],'000000000000000001');assert.equal(first.values[21],0);
  for(const e of [old,next])e.store.applyReview({mutationId:'single',ownerToken:'o',expectedSessionRevision:1,rowIds:[1],action:{type:'row-edit'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'5'}}},rules);
  compare('single SKU exception');
  for(const e of [old,next])e.store.rebuildDerived(rules);compare('ordinary recompute preserves exception');
  for(const e of [old,next])e.store.applyReview({mutationId:'group',ownerToken:'o',expectedSessionRevision:2,groupId:e.store.page().rows[0].groupId,action:{type:'group-unify'},patch:{thickness:{mode:'value',materialId:'m',ruleId:'3'}}},rules);
  compare('whole product modification');
  for(const e of [old,next])e.store.undo({mutationId:'undo',ownerToken:'o',expectedSessionRevision:3},rules);compare('undo');
  const schema=e=>e.store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();assert.deepEqual(schema(old),schema(next));report.sameSchema=true;
  const current=business(next.store);next.store.close();next.store=null;
  const oldReader=new old.Store(next.dir);assert.deepEqual(business(oldReader),current);oldReader.close();report.oldVersionReadsCandidateData=true;
  const exported=[];
  for(const e of [old,next]){
   const file=path.join(out,e===old?'baseline.xlsx':'candidate.xlsx');await e.exportProduct({sessionDirectory:e.dir,templatePath:path.join(e.root,'public/assets/product-template.xlsx'),outputPath:file});
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-refactor-readback-'));dirs.push(dir);new e.Store(dir,{create:true,meta:{rules}}).close();
   const inspected=await e.Reader.inspectWorkbook(file,dir);await e.Reader.importSheet(file,dir,{sheetId:inspected.sheets[0].sheetId,rules,derive:false});
   const s=new e.Store(dir),values=s.db.prepare('SELECT raw_json FROM raw_rows ORDER BY row_id').all().map(r=>JSON.parse(r.raw_json));s.close();exported.push(values);
   const xml=(await require(path.join(e.root,'server/product-stream-export.cjs')).templateParts(file)).get('xl/worksheets/sheet1.xml').toString();
   for(const address of ['R2','S2']){const cell=xml.match(new RegExp('<c\\b[^>]*\\br="'+address+'"[^>]*>[\\s\\S]*?</c>'))?.[0];assert.ok(cell);assert.match(cell,/t="inlineStr"/);}
   const zero=xml.match(/<c\b[^>]*\br="V2"[^>]*>[\s\S]*?<\/c>/)?.[0];assert.ok(zero);assert.match(zero,/<v>0<\/v>/);assert.doesNotMatch(zero,/inlineStr/);
   assert.equal(values.length,4);assert.ok(values.every(row=>row.length===29&&row[15]===''&&row[16]===''&&row[21]==='0'&&typeof row[17]==='string'&&typeof row[18]==='string'),JSON.stringify(values[0]));
  }
  assert.deepEqual(exported[0],exported[1]);report.exportHash=crypto.createHash('sha256').update(JSON.stringify(exported[1])).digest('hex');report.checks.push('29-column exact export readback, text IDs, blank barcodes and zero inventory');report.independentCostOracle={area:.24,weight:.216,cost:2.4};report.passed=true;
 }finally{old.store?.close();next.store?.close();for(const dir of dirs)fs.rmSync(dir,{recursive:true,force:true});fs.writeFileSync(path.join(out,'equivalence.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
