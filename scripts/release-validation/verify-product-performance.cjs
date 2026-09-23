'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.env.MAT_VERIFY_ROOT||path.join(__dirname,'../..')),output=path.resolve(process.env.MAT_VERIFY_OUTPUT);
const {ImportSessionStore}=require(path.join(root,'server/import-session-store.cjs')),R=require(path.join(root,'public/product-recognition.js'));
const rules={materials:[{id:'m',name:'硅藻泥',weightRules:[{id:'3',thickness:3,coefficient:.9,costPerSqm:10}]}]};
const mapping=R.mapFields(['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存']);
const report={root,platform:process.platform,node:process.version,cpu:os.cpus()[0].model,rowsPerDistribution:50000,results:[]};
fs.mkdirSync(output,{recursive:true});
for(const distribution of ['single-product','many-products','same-name-products']){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-group-performance-')),store=new ImportSessionStore(dir,{create:true,meta:{ownerToken:'test',rules,mapping}});
 try{
  const started=performance.now();let firstGroup;
  for(let start=0;start<50000;start+=500){
   const batch=Array.from({length:500},(_,offset)=>{const i=start+offset,product=distribution==='single-product'?0:Math.floor(i/5),values=['抖音','测试店',distribution==='many-products'?`硅藻泥商品 ${product}`:'同名硅藻泥商品',`图案 ${i} 40*60cm 3mm`,String(product).padStart(18,'0'),`SKU-${i}`,20,'在售',0];const raw={rowId:i+1,sourceRow:i+2,sheetId:'s',mapping,values},d=R.deriveTransferRow(raw,{},{rules});firstGroup??=d.groupId;return {...raw,platform:d.platform,shop:d.shop,productId:d.productId,skuId:d.skuId,groupId:d.groupId,sourceHash:String(i)};});
   store.insertRawBatch(batch);
  }
  store.rebuildDerived(rules);const buildMs=performance.now()-started,totalGroups=distribution==='single-product'?1:10000;
  const queries=[['first',{view:'products'}],['deep',{view:'products',page:Math.ceil(totalGroups/20)}],['sparse-search',{view:'products',search:'SKU-49999'}],['broad-search',{view:'products',search:'图案'}],['sku-first',{groupId:firstGroup}],['sku-deep',{groupId:firstGroup,page:distribution==='single-product'?500:1}]];
  const measurements=[];
  for(const [name,query] of queries){
   const times=[];let result;
   for(let i=0;i<21;i++){const t=performance.now();result=store.page(query);if(i)times.push(performance.now()-t);}
   assert.equal(result.counts.total,50000);if(name==='sparse-search')assert.equal(result.matchedRows,1);
   if(name==='first'||name==='deep')assert.equal(result.total,totalGroups);
   measurements.push({name,query,p95Ms:times.sort((a,b)=>a-b)[18],total:result.total,returnedGroups:result.groups.length,returnedRows:result.rows.length,payloadBytes:Buffer.byteLength(JSON.stringify(result))});
  }
  const hash=crypto.createHash('sha256');for(const row of store.db.prepare('SELECT raw_json FROM raw_rows ORDER BY row_id').iterate())hash.update(row.raw_json+'\n');
  report.results.push({distribution,rows:50000,groups:totalGroups,buildMs,rawHash:hash.digest('hex'),measurements});
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}
report.maxRssMiB=process.resourceUsage().maxRSS/1024;
report.withinPagingTarget=report.results.every(r=>r.measurements.every(m=>m.p95Ms<=500));report.passed=true;
fs.writeFileSync(path.join(output,'product-performance.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
