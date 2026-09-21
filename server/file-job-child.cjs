'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {pipeline}=require('node:stream/promises');
const {Readable}=require('node:stream');
const Reader=require('./xlsx-stream-reader.cjs');
const {exportProduct}=require('./product-stream-export.cjs');
const {ImportSessionStore,SessionError,digest}=require('./import-session-store.cjs');
const Recognition=require('../public/product-recognition.js');

let active=null;
const progress=value=>{if(active&&process.send)process.send({type:'progress',jobId:active.jobId,progress:value});};
const canceled=()=>!!active?.canceled;
const safeError=error=>({code:error.code||'FILE_JOB_FAILED',message:error.status?error.message:'文件处理失败，原会话已保留。',status:error.status||500});

async function rescue({sessionDirectory,outputPath}){
  const store=new ImportSessionStore(sessionDirectory),statement=store.db.prepare('SELECT r.row_id,r.sheet_id,r.source_row,r.raw_json,rv.review_json FROM raw_rows r LEFT JOIN reviews rv ON rv.row_id=r.row_id WHERE r.row_id>? ORDER BY r.row_id LIMIT 1000');let after=0,count=0;
  const source=Readable.from((async function*(){yield JSON.stringify({type:'mat-workbench-file-session-rescue',version:1,meta:store.metadata()})+'\n';while(true){if(canceled())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});const rows=statement.all(after);if(!rows.length)break;for(const row of rows){yield JSON.stringify({rowId:row.row_id,sheetId:row.sheet_id,sourceRow:row.source_row,raw:JSON.parse(row.raw_json),review:row.review_json?JSON.parse(row.review_json):{}})+'\n';after=row.row_id;count++;}progress({phase:'rescue',rowsCommitted:count});}})());
  try{await pipeline(source,fs.createWriteStream(outputPath,{flags:'wx'}));return {artifactPath:outputPath,artifactName:'转表会话救援.ndjson',rows:count};}finally{store.close();}
}
function aggregateSales(sessionDirectory,mapping){
  const store=new ImportSessionStore(sessionDirectory),totalRows=Number(store.db.prepare('SELECT count(*) n FROM raw_rows').get().n),page=store.db.prepare('SELECT row_id,raw_json FROM raw_rows WHERE row_id>? ORDER BY row_id LIMIT 1000'),find=store.db.prepare('SELECT quantity,source_count FROM sales_aggregates WHERE platform=? AND shop=? AND product_id=? AND sku_id=?'),put=store.db.prepare('INSERT INTO sales_aggregates VALUES(?,?,?,?,?,?,?) ON CONFLICT(platform,shop,product_id,sku_id) DO UPDATE SET quantity_text=excluded.quantity_text,quantity=excluded.quantity,source_count=excluded.source_count');let scanned=0,after=0,totalQuantity=0n;store.db.exec('DELETE FROM sales_aggregates');try{while(true){if(canceled())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});const rows=page.all(after);if(!rows.length)break;store.transaction(()=>{for(const row of rows){const raw=JSON.parse(row.raw_json),get=name=>Number.isInteger(mapping[name])?raw[mapping[name]]:'',platform=Recognition.text(get('platform')),shop=Recognition.text(get('shop')),sourceProductId=String(get('productId')??''),sourceSkuId=String(get('specId')??''),isolated=!platform||!shop||!sourceProductId||!sourceSkuId,productId=isolated?`@row:${row.row_id}`:sourceProductId,skuId=sourceSkuId||`@row:${row.row_id}`,quantityText=Recognition.text(get('sales'));if(!/^\d+$/.test(quantityText))throw new SessionError(422,`第 ${row.row_id} 条销量不是非负整数。`,'INVALID_SALES_QUANTITY');const quantity=BigInt(quantityText);if(quantity>1000000000000n)throw new SessionError(422,`第 ${row.row_id} 条销量超过安全上限。`,'SALES_QUANTITY_LIMIT');const old=find.get(platform,shop,productId,skuId),sum=BigInt(old?.quantity||0)+quantity;if(sum>1000000000000n)throw new SessionError(422,'同一 SKU 汇总销量超过安全上限。','SALES_QUANTITY_LIMIT');put.run(platform,shop,productId,skuId,sum.toString(),Number(sum),Number(old?.source_count||0)+1);totalQuantity+=quantity;after=row.row_id;scanned++;}});progress({phase:'aggregating-sales',rowsRead:scanned,rowsTotal:totalRows});}
    const hash=require('node:crypto').createHash('sha256');for(const item of store.db.prepare('SELECT platform,shop,product_id,sku_id,quantity_text FROM sales_aggregates ORDER BY platform,shop,product_id,sku_id').iterate())hash.update(JSON.stringify(item));store.setMeta('salesFingerprint',hash.digest('hex'));return {sourceRows:totalRows,items:Number(store.db.prepare('SELECT count(*) n FROM sales_aggregates').get().n),totalQuantity:totalQuantity.toString()};
  }finally{store.close();}
}

async function run(jobType,payload,context){
  const common={progress,canceled};
  if(context.sessionDirectory){const store=new ImportSessionStore(context.sessionDirectory);try{const meta=store.metadata();if(meta.workspaceId!==context.workspaceId||Number(meta.storageEpoch)!==Number(context.storageEpoch)||Number(meta.revision)!==Number(context.revision)||Number(meta.generation)!==Number(context.generation))throw new SessionError(409,'文件会话已变更，请刷新后重试。','SESSION_CONTEXT_CHANGED');}finally{store.close();}}
  if(jobType==='inspect')return Reader.inspectWorkbook(context.sourcePath,context.sessionDirectory,common);
  if(jobType==='import')return Reader.importSheets(context.sourcePath,context.sessionDirectory,{...payload,...common,selections:payload.selections||[{sheetId:payload.sheetId,mapping:payload.mapping}]});
  if(jobType==='aggregate-sales'){
    const imported=await Reader.importSheet(context.sourcePath,context.sessionDirectory,{...payload,derive:false,...common});
    if(payload.matchBy==='size'){
      const store=new ImportSessionStore(context.sessionDirectory);
      try{return {...imported,sales:require('./sales-size-import.cjs').aggregate(store,payload.mapping||imported.header.mapping,{basis:payload.basis,progress,canceled})};}
      finally{store.close();}
    }
    return {...imported,sales:aggregateSales(context.sessionDirectory,payload.mapping||imported.header.mapping)};
  }
  if(jobType==='apply-review'){
    const store=new ImportSessionStore(context.sessionDirectory);try{return store.applyReview(payload.command||payload,payload.rules||store.getMeta('rules',{}));}finally{store.close();}
  }
  if(jobType==='recompute'){
    const store=new ImportSessionStore(context.sessionDirectory);try{const rules=payload.rules,old=store.metadata();if(!rules)throw new SessionError(400,'缺少重算规则。','RULES_REQUIRED');const result=store.rebuildDerived(rules,{...common});store.updateMeta({artifact:null,lastOperation:null,rulesFingerprint:digest(rules)});return {...result,revision:old.revision,recomputed:true};}finally{store.close();}
  }
  if(jobType==='export-product')return exportProduct({sessionDirectory:context.sessionDirectory,templatePath:context.templatePath,outputPath:context.outputPath,...common});
  if(jobType==='export-rescue')return rescue({sessionDirectory:context.sessionDirectory,outputPath:context.outputPath});
  if(['export-backup','inspect-backup','export-listing'].includes(jobType)){
    const auxiliary=require('./auxiliary-file-jobs.cjs'),handler=auxiliary.handlers?.[jobType];if(typeof handler!=='function')throw new SessionError(501,'该文件任务尚未接入。','AUXILIARY_JOB_MISSING');return handler(payload,{progress,isCanceled:canceled,outputDir:context.outputDir,inputPath:context.inputPath});
  }
  throw new SessionError(400,'未知文件任务。','UNKNOWN_FILE_JOB');
}

process.on('message',async message=>{
  if(message?.type==='cancel'&&active?.jobId===message.jobId){active.canceled=true;return;}
  if(message?.type!=='run'||active)return;active={jobId:message.jobId,canceled:false};let reply;
  try{const result=await run(message.jobType,message.payload||{},message.context||{});if(canceled())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});reply={type:'result',jobId:active.jobId,result};}
  catch(error){reply={type:'error',jobId:active.jobId,error:safeError(error)};}
  // A fixed exit delay can truncate buffered IPC. Flush the result, then close naturally.
  try{if(process.connected)await new Promise((resolve,reject)=>process.send(reply,error=>error?reject(error):resolve()));}
  catch{process.exitCode=1;}
  finally{if(process.connected)process.disconnect();}
});
