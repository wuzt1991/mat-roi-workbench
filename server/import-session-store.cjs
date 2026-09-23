'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Recognition=require('../public/product-recognition.js');

class SessionError extends Error{
  constructor(status,message,code='SESSION_ERROR'){super(message);this.status=status;this.code=code;}
}
const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]))):value;
const stable=value=>JSON.stringify(canonical(value));
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const parse=(value,fallback=null)=>{try{return value==null?fallback:JSON.parse(value);}catch{return fallback;}};
const now=()=>new Date().toISOString();

class ImportSessionStore{
  constructor(directory,{create=false,meta={}}={}){
    this.directory=directory;fs.mkdirSync(directory,{recursive:true});
    this.filename=path.join(directory,'session.sqlite');this.db=new DatabaseSync(this.filename);
    try{
    // Set the busy handler before journal_mode can encounter another process's lock.
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shared_strings(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS raw_rows(row_id INTEGER PRIMARY KEY,sheet_id TEXT NOT NULL,source_row INTEGER NOT NULL,raw_json TEXT NOT NULL,source_hash TEXT NOT NULL,platform TEXT NOT NULL DEFAULT '',shop TEXT NOT NULL DEFAULT '',product_id TEXT NOT NULL DEFAULT '',sku_id TEXT NOT NULL DEFAULT '',group_id TEXT NOT NULL,original_missing_thickness INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reviews(row_id INTEGER PRIMARY KEY REFERENCES raw_rows(row_id) ON DELETE CASCADE,review_json TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS derived_rows(row_id INTEGER NOT NULL REFERENCES raw_rows(row_id) ON DELETE CASCADE,generation INTEGER NOT NULL,group_id TEXT NOT NULL,status TEXT NOT NULL,original_missing_thickness INTEGER NOT NULL,derived_json TEXT NOT NULL,PRIMARY KEY(row_id,generation));
      CREATE TABLE IF NOT EXISTS groups(generation INTEGER NOT NULL,group_id TEXT NOT NULL,first_row INTEGER NOT NULL,platform TEXT NOT NULL,shop TEXT NOT NULL,product_id TEXT NOT NULL,total INTEGER NOT NULL,pending INTEGER NOT NULL,confirmed INTEGER NOT NULL,missing_thickness INTEGER NOT NULL,material_state TEXT NOT NULL,thickness_state TEXT NOT NULL,spec_examples TEXT NOT NULL,PRIMARY KEY(generation,group_id));
      CREATE TABLE IF NOT EXISTS generation_counts(generation INTEGER PRIMARY KEY,total INTEGER NOT NULL,pending INTEGER NOT NULL,confirmed INTEGER NOT NULL,missing_thickness INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS group_value_counts(generation INTEGER NOT NULL,group_id TEXT NOT NULL,field TEXT NOT NULL,status TEXT NOT NULL,value TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(generation,group_id,field,status,value));
      CREATE TABLE IF NOT EXISTS operation_changes(operation_id TEXT NOT NULL,row_id INTEGER NOT NULL,old_review TEXT NOT NULL,new_review TEXT NOT NULL,fields TEXT NOT NULL,PRIMARY KEY(operation_id,row_id));
      CREATE TABLE IF NOT EXISTS receipts(mutation_id TEXT PRIMARY KEY,digest TEXT NOT NULL,result_json TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(artifact_id TEXT PRIMARY KEY,filename TEXT NOT NULL,name TEXT NOT NULL,fingerprint TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sales_aggregates(platform TEXT NOT NULL,shop TEXT NOT NULL,product_id TEXT NOT NULL,sku_id TEXT NOT NULL,quantity_text TEXT NOT NULL,quantity INTEGER NOT NULL,source_count INTEGER NOT NULL,PRIMARY KEY(platform,shop,product_id,sku_id));
      CREATE TABLE IF NOT EXISTS sales_bindings(row_id INTEGER PRIMARY KEY REFERENCES raw_rows(row_id) ON DELETE CASCADE,item_id TEXT NOT NULL DEFAULT '',excluded INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS raw_order ON raw_rows(row_id);
      CREATE INDEX IF NOT EXISTS raw_group ON raw_rows(group_id,row_id);
      CREATE INDEX IF NOT EXISTS raw_identity ON raw_rows(platform,shop,product_id,sku_id);
      CREATE INDEX IF NOT EXISTS derived_filter ON derived_rows(generation,status,original_missing_thickness,group_id,row_id);
      CREATE INDEX IF NOT EXISTS derived_group ON derived_rows(generation,group_id,row_id);
      CREATE INDEX IF NOT EXISTS derived_page ON derived_rows(generation,row_id,status,original_missing_thickness);
      CREATE INDEX IF NOT EXISTS groups_order ON groups(generation,first_row);`);
    if(create){for(const [key,value] of Object.entries({schemaVersion:1,revision:0,generation:0,phase:'uploading',created:now(),updated:now(),...meta}))this.setMeta(key,value);}
    }catch(error){try{this.db.close();}catch{}this.db=null;throw error;}
  }
  close(){if(this.db){try{this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}this.db.close();this.db=null;}}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  setMeta(key,value){this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  getMeta(key,fallback=null){return parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value,fallback);}
  metadata(){const rows=this.db.prepare('SELECT key,value FROM meta').all(),result={};for(const row of rows)result[row.key]=parse(row.value);return result;}
  updateMeta(values){this.transaction(()=>{for(const [key,value] of Object.entries({...values,updated:now()}))this.setMeta(key,value);});return this.metadata();}
  assertContext({ownerToken,expectedSessionRevision,storageEpoch}={}){
    const meta=this.metadata();
    if(ownerToken!==undefined&&ownerToken!==meta.ownerToken)throw new SessionError(409,'该文件会话已在其他窗口接管。','OWNER_CHANGED');
    if(expectedSessionRevision!==undefined&&Number(expectedSessionRevision)!==Number(meta.revision))throw new SessionError(409,'复核内容已更新，请刷新后重试。','SESSION_REVISION_CONFLICT');
    if(storageEpoch!==undefined&&Number(storageEpoch)!==Number(meta.storageEpoch))throw new SessionError(409,'工作区已恢复，请重新导入或复核。','STORAGE_EPOCH_CHANGED');
    return meta;
  }
  resetImport({keepSharedStrings=false}={}){this.transaction(()=>{if(!keepSharedStrings)this.db.exec('DELETE FROM shared_strings');for(const table of ['raw_rows','reviews','derived_rows','groups','generation_counts','group_value_counts','operation_changes','receipts','artifacts','sales_aggregates','sales_bindings'])this.db.exec(`DELETE FROM ${table}`);this.setMeta('generation',0);this.setMeta('revision',0);});}
  insertSharedString(id,value){this.db.prepare('INSERT INTO shared_strings(id,value) VALUES(?,?)').run(id,value);}
  sharedString(id){return this.db.prepare('SELECT value FROM shared_strings WHERE id=?').get(id)?.value;}
  insertRawBatch(records){
    if(!records.length)return;const insert=this.db.prepare('INSERT INTO raw_rows(row_id,sheet_id,source_row,raw_json,source_hash,platform,shop,product_id,sku_id,group_id,original_missing_thickness) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    this.transaction(()=>{for(const record of records)insert.run(record.rowId,record.sheetId,record.sourceRow,JSON.stringify(record.values),record.sourceHash,record.platform||'',record.shop||'',record.productId||'',record.skuId||'',record.groupId,record.originalMissingThickness?1:0);});
  }
  raw(rowId){const row=this.db.prepare('SELECT * FROM raw_rows WHERE row_id=?').get(rowId);if(!row)return null;return {rowId:row.row_id,sheetId:row.sheet_id,sourceRow:row.source_row,values:parse(row.raw_json,[]),sourceHash:row.source_hash,platform:row.platform,shop:row.shop,productId:row.product_id,skuId:row.sku_id,groupId:row.group_id,originalMissingThickness:!!row.original_missing_thickness,mapping:this.getMeta('sheetMappings',{})[row.sheet_id]||this.getMeta('mapping',{})};}
  review(rowId){return parse(this.db.prepare('SELECT review_json FROM reviews WHERE row_id=?').get(rowId)?.review_json,{});}
  putDerived(derived,generation){this.db.prepare('INSERT OR REPLACE INTO derived_rows(row_id,generation,group_id,status,original_missing_thickness,derived_json) VALUES(?,?,?,?,?,?)').run(derived.rowId,generation,derived.groupId,derived.status,derived.originalMissingThickness?1:0,JSON.stringify(derived));}
  rebuildDerived(rules,{generation=this.getMeta('generation',0)+1,progress,canceled,thicknessDefaults=this.getMeta('thicknessDefaults',{}),thicknessMode=this.getMeta('thicknessMode','missing'),applyUniformThickness=false,materialAssignments={},fallbackMaterialId='',command}={}){
    if(command?.mutationId){const replay=this.checkedReceipt(command);if(replay)return replay;this.assertContext(command);}
    const select=this.db.prepare('SELECT row_id FROM raw_rows ORDER BY row_id'),rows=select.all(),batch=500;let done=0;
    if(applyUniformThickness){
      Recognition.normalizeThicknessDefaults(thicknessDefaults,rules);thicknessMode='uniform';
      if(!materialAssignments||typeof materialAssignments!=='object'||Array.isArray(materialAssignments)||Object.keys(materialAssignments).length>5000)throw new SessionError(422,'材质指定内容无效。','INVALID_MATERIAL_ASSIGNMENT');
      for(const id of [...Object.values(materialAssignments),fallbackMaterialId].filter(Boolean))if(!(rules.materials||[]).some(m=>m.id===id&&!m.deleted))throw new SessionError(422,'指定的材质已不可用。','INVALID_MATERIAL_ASSIGNMENT');
    }
    this.db.exec('CREATE TEMP TABLE IF NOT EXISTS uniform_reviews(row_id INTEGER PRIMARY KEY,review_json TEXT NOT NULL); DELETE FROM uniform_reviews');
    const stageReview=this.db.prepare('INSERT INTO uniform_reviews VALUES(?,?)');
    this.transaction(()=>{this.db.prepare('DELETE FROM derived_rows WHERE generation=?').run(generation);});
    for(let start=0;start<rows.length;start+=batch){
      if(canceled?.())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});
      this.transaction(()=>{for(const item of rows.slice(start,start+batch)){
        const raw=this.raw(item.row_id),review=this.review(item.row_id);let derived=Recognition.deriveTransferRow(raw,review,{rules,mapping:raw.mapping,thicknessDefaults,thicknessMode});
        let reviewChanged=false;
        if(applyUniformThickness&&['pending','blocked'].includes(derived.material.status)){
          const materialId=materialAssignments[derived.groupId]||fallbackMaterialId;
          if(materialId){review.material={status:'value',source:'manual',materialId};delete review.thickness;reviewChanged=true;derived=Recognition.deriveTransferRow(raw,review,{rules,mapping:raw.mapping,thicknessDefaults,thicknessMode});}
        }
        if(applyUniformThickness&&review.thickness&&derived.material.status==='value'&&Object.hasOwn(thicknessDefaults,derived.material.materialId)){
          delete review.thickness;reviewChanged=true;derived=Recognition.deriveTransferRow(raw,review,{rules,mapping:raw.mapping,thicknessDefaults,thicknessMode});
        }
        if(applyUniformThickness&&derived.material.status==='value'&&!Object.hasOwn(thicknessDefaults,derived.material.materialId)&&(rules.materials||[]).find(m=>m.id===derived.material.materialId)?.weightRules?.some(r=>!r.deleted))throw new SessionError(422,'请为本表所有已确认材质选择统一厚度。','THICKNESS_SETUP_REQUIRED');
        if(reviewChanged)stageReview.run(item.row_id,JSON.stringify(review));
        this.putDerived(derived,generation);
      }});done=Math.min(rows.length,start+batch);progress?.({phase:'deriving',rowsRead:done,rowsTotal:rows.length});
    }
    if(canceled?.())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});
    this.rebuildGroups(generation);if(canceled?.())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});
    this.transaction(()=>{
      if(applyUniformThickness){const revision=this.getMeta('revision',0)+1;this.db.prepare('INSERT INTO reviews(row_id,review_json,revision) SELECT row_id,review_json,? FROM uniform_reviews WHERE true ON CONFLICT(row_id) DO UPDATE SET review_json=excluded.review_json,revision=excluded.revision').run(revision);this.setMeta('revision',revision);this.setMeta('uniformConfirmed',true);this.setMeta('lastOperation',null);}
      this.setMeta('generation',generation);this.setMeta('rules',rules);this.setMeta('thicknessDefaults',thicknessDefaults);this.setMeta('thicknessMode',thicknessMode);this.setMeta('rulesFingerprint',digest(rules));this.setMeta('derivationVersion',Recognition.DERIVATION_VERSION);this.setMeta('phase','reviewing');
      if(command?.mutationId){this.setMeta('artifact',null);this.setMeta('lastOperation',null);this.saveReceipt(command,{generation,revision:this.getMeta('revision',0),...this.counts(generation),recomputed:true});}
    });return {generation,revision:this.getMeta('revision',0),...this.counts(generation)};
  }

  rebuildGroups(generation){this.transaction(()=>this.rebuildGroupsOutsideTransaction(generation));}
  rebuildGroupsOutsideTransaction(generation){
    this.db.prepare('DELETE FROM groups WHERE generation=?').run(generation);
    this.db.prepare('DELETE FROM group_value_counts WHERE generation=?').run(generation);
    // Aggregation stays in SQLite, including workbooks with one distinct group per row.
    for(const field of ['material','thickness']){
      const value=field==='material'?"coalesce(json_extract(derived_json,'$.material.materialId'),'')":"coalesce(json_extract(derived_json,'$.thickness.materialId'),'')||':'||coalesce(json_extract(derived_json,'$.thickness.ruleId'),'')";
      this.db.prepare(`INSERT INTO group_value_counts SELECT generation,group_id,?,coalesce(json_extract(derived_json,'$.${field}.status'),'pending'),CASE WHEN json_extract(derived_json,'$.${field}.status')='value' THEN ${value} ELSE '' END,count(*) FROM derived_rows WHERE generation=? GROUP BY group_id,4,5`).run(field,generation);
    }
    this.db.prepare(`INSERT INTO groups SELECT d.generation,d.group_id,min(d.row_id),r.platform,r.shop,r.product_id,count(*),sum(d.status<>'confirmed'),sum(d.status='confirmed'),sum(d.original_missing_thickness),'mixed','mixed','[]' FROM derived_rows d JOIN raw_rows r ON r.row_id=d.row_id WHERE d.generation=? GROUP BY d.group_id`).run(generation);
    const examples=this.db.prepare("SELECT derived_json FROM derived_rows WHERE generation=? AND group_id=? ORDER BY row_id LIMIT 3"),putExamples=this.db.prepare('UPDATE groups SET spec_examples=? WHERE generation=? AND group_id=?');
    for(const row of this.db.prepare('SELECT group_id FROM groups WHERE generation=?').iterate(generation)){
      this.refreshGroupStates(generation,row.group_id);
      putExamples.run(JSON.stringify(examples.all(generation,row.group_id).map(x=>parse(x.derived_json,{}).specName).filter(Boolean)),generation,row.group_id);
    }
    this.db.prepare(`INSERT OR REPLACE INTO generation_counts SELECT ?,coalesce(sum(total),0),coalesce(sum(pending),0),coalesce(sum(confirmed),0),coalesce(sum(missing_thickness),0) FROM groups WHERE generation=?`).run(generation,generation);
  }
  refreshGroupStates(generation,groupId){
    const query=this.db.prepare('SELECT status,value FROM group_value_counts WHERE generation=? AND group_id=? AND field=? AND count>0 LIMIT 2');
    const state=field=>{const values=query.all(generation,groupId,field);return values.length===1?(values[0].status==='value'?values[0].value:values[0].status):'mixed';};
    this.db.prepare('UPDATE groups SET material_state=?,thickness_state=? WHERE generation=? AND group_id=?').run(state('material'),state('thickness'),generation,groupId);
  }
  ensureGroupCounts(generation){
    if(!this.db.prepare('SELECT 1 FROM generation_counts WHERE generation=?').get(generation))this.rebuildGroupsOutsideTransaction(generation);
  }
  replaceDerivedIncrementally(previous,next,generation){
    if(!previous||previous.groupId!==next.groupId)throw new SessionError(409,'商品分组已变化，请重新导入。','GROUP_CHANGED');
    const pending=(next.status==='confirmed'?0:1)-(previous.status==='confirmed'?0:1),missing=Number(!!next.originalMissingThickness)-Number(!!previous.originalMissingThickness);
    this.db.prepare('UPDATE groups SET pending=pending+?,confirmed=confirmed-?,missing_thickness=missing_thickness+? WHERE generation=? AND group_id=?').run(pending,pending,missing,generation,next.groupId);
    this.db.prepare('UPDATE generation_counts SET pending=pending+?,confirmed=confirmed-?,missing_thickness=missing_thickness+? WHERE generation=?').run(pending,pending,missing,generation);
    const add=this.db.prepare('INSERT INTO group_value_counts VALUES(?,?,?,?,?,1) ON CONFLICT(generation,group_id,field,status,value) DO UPDATE SET count=count+1'),subtract=this.db.prepare('UPDATE group_value_counts SET count=count-1 WHERE generation=? AND group_id=? AND field=? AND status=? AND value=?'),remove=this.db.prepare('DELETE FROM group_value_counts WHERE generation=? AND group_id=? AND field=? AND status=? AND value=? AND count=0');
    for(const field of ['material','thickness']){
      const key=d=>{const part=d[field]||{},status=part.status||'pending';return [status,status==='value'?(field==='material'?String(part.materialId||''):`${part.materialId||''}:${part.ruleId||''}`):''];};
      const oldKey=key(previous),newKey=key(next);if(oldKey[0]===newKey[0]&&oldKey[1]===newKey[1])continue;
      subtract.run(generation,next.groupId,field,...oldKey);remove.run(generation,next.groupId,field,...oldKey);add.run(generation,next.groupId,field,...newKey);
    }
    this.putDerived(next,generation);
    this.db.prepare('INSERT OR IGNORE INTO mutation_groups VALUES(?)').run(next.groupId);
  }
  finishMutationGroups(generation){for(const row of this.db.prepare('SELECT group_id FROM mutation_groups').iterate())this.refreshGroupStates(generation,row.group_id);}
  counts(generation=this.getMeta('generation',0)){
    const cached=this.db.prepare('SELECT total n,pending,confirmed,missing_thickness missing FROM generation_counts WHERE generation=?').get(generation);
    const total=cached||this.db.prepare("SELECT count(*) n,sum(status<>'confirmed') pending,sum(status='confirmed') confirmed,sum(original_missing_thickness) missing FROM derived_rows WHERE generation=?").get(generation);
    return {total:Number(total?.n||0),pending:Number(total?.pending||0),confirmed:Number(total?.confirmed||0),missingThickness:Number(total?.missing||0),ready:Number(total?.n||0)>0&&Number(total?.pending||0)===0};
  }
  materialSummary(generation=this.getMeta('generation',0),page=1){
    const rows=this.db.prepare("SELECT status,value,sum(count) total FROM group_value_counts WHERE generation=? AND field='material' AND count>0 GROUP BY status,value ORDER BY value").all(generation);
    const thicknesses=this.db.prepare("SELECT value,sum(count) count FROM group_value_counts WHERE generation=? AND field='thickness' AND status='value' AND count>0 GROUP BY value ORDER BY value").all(generation);
    const unknownSql="SELECT group_id,sum(count) total FROM group_value_counts WHERE generation=? AND field='material' AND status IN ('pending','blocked') AND count>0 GROUP BY group_id";
    const groupCount=Number(this.db.prepare(`SELECT count(*) n FROM (${unknownSql})`).get(generation).n),totalPages=Math.max(1,Math.ceil(groupCount/30));page=Math.max(1,Math.min(totalPages,Number(page)||1));
    const examples=this.db.prepare("SELECT derived_json FROM derived_rows WHERE generation=? AND group_id=? AND json_extract(derived_json,'$.material.status') IN ('pending','blocked') ORDER BY row_id LIMIT 3");
    const unknownGroups=this.db.prepare(`${unknownSql} ORDER BY group_id LIMIT 30 OFFSET ?`).all(generation,(page-1)*30).map(g=>{const sample=examples.all(generation,g.group_id).map(r=>parse(r.derived_json,{}));return {groupId:g.group_id,count:Number(g.total),productName:sample[0]?.productName||'未命名商品',productId:sample[0]?.productId||'',examples:sample.map(r=>r.specName),reason:sample[0]?.material.reason||'missing'};});
    return {materials:rows.filter(r=>r.status==='value').map(r=>({materialId:r.value,count:Number(r.total)})),thicknesses,unknown:rows.filter(r=>['pending','blocked'].includes(r.status)).reduce((sum,r)=>sum+Number(r.total),0),unknownGroups,groupCount,page,totalPages};
  }
  productPage({generation,clause,params,page,pageSize,search,status,missingThickness,materialPage}){
    pageSize=Math.min(20,pageSize);
    const filtered=!!search||status!=='all'||missingThickness;
    const source=filtered?`WITH matches AS (SELECT d.group_id,count(*) matched FROM derived_rows d WHERE ${clause} GROUP BY d.group_id) SELECT g.*,m.matched FROM groups g JOIN matches m ON m.group_id=g.group_id WHERE g.generation=?`:'SELECT g.*,g.total matched FROM groups g WHERE g.generation=?';
    const args=filtered?[...params,generation]:[generation];
    const totals=this.db.prepare(`SELECT count(*) total,coalesce(sum(matched),0) matchedRows FROM (${source})`).get(...args);
    const total=Number(totals.total),totalPages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,totalPages);
    const first=this.db.prepare('SELECT derived_json FROM derived_rows WHERE generation=? AND row_id=?');
    const groups=this.db.prepare(`${source} ORDER BY g.first_row LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize).map(g=>({groupId:g.group_id,productName:parse(first.get(generation,g.first_row)?.derived_json,{}).productName||'未命名商品',platform:g.platform,shop:g.shop,productId:g.product_id,total:g.total,matched:g.matched,pending:g.pending,confirmed:g.confirmed,materialState:g.material_state,thicknessState:g.thickness_state,specExamples:parse(g.spec_examples,[])}));
    const productCounts=this.db.prepare('SELECT count(*) total,coalesce(sum(pending>0),0) pending FROM groups WHERE generation=?').get(generation),counts=this.counts(generation);
    return {view:'products',rows:[],groups,page,pageSize,total,totalPages,matchedRows:Number(totals.matchedRows),productCounts,search,counts,materialSummary:this.materialSummary(generation,materialPage),thicknessConfigured:this.getMeta('uniformConfirmed',false),thicknessDefaults:this.getMeta('thicknessDefaults',{}),revision:this.getMeta('revision',0),generation,ready:counts.ready};
  }
  page({status='all',missingThickness=false,page=1,pageSize=100,attention=false,search='',materialPage=1,view='rows',groupId=''}={}){
    if(attention){search='';status='pending';missingThickness=false;page=1;pageSize=1;}
    pageSize=Math.max(1,Math.min(100,Number(pageSize)||100));page=Math.max(1,Number(page)||1);const generation=this.getMeta('generation',0),where=['d.generation=?'],params=[generation];
    if(status==='pending'){where.push("d.status<>'confirmed'");}else if(status==='confirmed'){where.push("d.status='confirmed'");}else if(status!=='all')throw new SessionError(400,'筛选条件无效。','INVALID_FILTER');
    if(missingThickness){where.push('d.original_missing_thickness=1');}
    search=String(search||'').trim();if(search.length>200)throw new SessionError(400,'搜索内容最多 200 个字符。','INVALID_SEARCH');
    if(search){where.push('('+['productName','specName','productId','skuId'].map(key=>`instr(lower(coalesce(json_extract(d.derived_json,'$.${key}'),'')),lower(?))>0`).join(' OR ')+')');params.push(search,search,search,search);}
    if(groupId){where.push('d.group_id=?');params.push(String(groupId));}
    const clause=where.join(' AND ');
    if(view==='products'&&!attention)return this.productPage({generation,clause,params,page,pageSize,search,status,missingThickness,materialPage});
    const total=Number(this.db.prepare(`SELECT count(*) n FROM derived_rows d WHERE ${clause}`).get(...params).n),totalPages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,totalPages);const offset=(page-1)*pageSize;
    // Limit the covering index to a page before loading or sorting any full row JSON.
    const sheetNames=new Map(this.getMeta('selectedSheets',[]).map(sheet=>[sheet.sheetId,sheet.name]));
    const rows=this.db.prepare(`WITH visible AS MATERIALIZED (SELECT d.row_id,d.generation FROM derived_rows d INDEXED BY ${groupId?'derived_group':'derived_page'} WHERE ${clause} ORDER BY d.row_id LIMIT ? OFFSET ?) SELECT r.row_id,r.sheet_id,r.source_row,r.raw_json,rv.review_json,d.derived_json,d.group_id FROM visible v JOIN derived_rows d ON d.row_id=v.row_id AND d.generation=v.generation JOIN raw_rows r ON r.row_id=v.row_id LEFT JOIN reviews rv ON rv.row_id=v.row_id ORDER BY v.row_id`).all(...params,pageSize,offset).map(row=>{const review=parse(row.review_json,{}),derived=parse(row.derived_json,{});return {rowId:row.row_id,sourceRow:row.source_row,sheetId:row.sheet_id,sheetName:sheetNames.get(row.sheet_id)||'',groupId:row.group_id,raw:parse(row.raw_json,[]),review:{...review,materialId:review.material?.materialId||'',sizeId:review.size?.sizeId||'',materialRuleId:review.thickness?.ruleId||''},derived};});
    if(attention&&rows[0]){const row=rows[0],field=Recognition.attentionField(row.derived);row.missingPeers=field?Number(this.db.prepare(`SELECT count(*) n FROM derived_rows WHERE generation=? AND group_id=? AND json_extract(derived_json,'$.${field}.status')='pending' AND json_extract(derived_json,'$.${field}.reason')='missing' AND coalesce(json_extract(derived_json,'$.${field}.source'),'auto')<>'manual' ${field==='thickness'?"AND json_extract(derived_json,'$.material.materialId')=?":''}`).get(generation,row.groupId,...(field==='thickness'?[row.derived.material.materialId||'']:[])).n):0;}
    const ids=[...new Set(rows.map(x=>x.groupId))],groups=ids.map(id=>{const g=this.db.prepare('SELECT * FROM groups WHERE generation=? AND group_id=?').get(generation,id),visible=rows.filter(x=>x.groupId===id).length;return {groupId:id,platform:g.platform,shop:g.shop,productId:g.product_id,total:g.total,visible,hidden:g.total-visible,pending:g.pending,confirmed:g.confirmed,missingThickness:g.missing_thickness,materialState:g.material_state,thicknessState:g.thickness_state,specExamples:parse(g.spec_examples,[])};});
    const counts=this.counts(generation);
    return {rows,groups,page,pageSize,total,totalPages,search,materialSummary:this.materialSummary(generation,materialPage),thicknessConfigured:this.getMeta('uniformConfirmed',false),thicknessDefaults:this.getMeta('thicknessDefaults',{}),duplicateRows:this.getMeta('duplicateRows',0),counts,revision:this.getMeta('revision',0),generation,ready:counts.ready};
  }
  targetRowIds({rowIds,groupId}){if(groupId)return this.db.prepare('SELECT row_id FROM raw_rows WHERE group_id=? ORDER BY row_id').all(groupId).map(x=>x.row_id);const ids=[...new Set((rowIds||[]).map(Number).filter(Number.isSafeInteger))];if(!ids.length)throw new SessionError(422,'请选择需处理的规格。','EMPTY_TARGET');return ids;}
  targetRowCount(command){return command.groupId?Number(this.db.prepare('SELECT count(*) n FROM raw_rows WHERE group_id=?').get(command.groupId).n):this.targetRowIds(command).length;}
  *iterateTargets(command){
    if(command.groupId){for(const item of this.db.prepare('SELECT row_id FROM raw_rows WHERE group_id=? ORDER BY row_id').iterate(command.groupId))yield item.row_id;}
    else yield* this.targetRowIds(command);
  }
  checkedReceipt(command){
    this.assertContext({...command,expectedSessionRevision:undefined});
    if(!command.mutationId)throw new SessionError(400,'操作编号不能为空。','MISSING_MUTATION_ID');
    const receipt=this.db.prepare('SELECT * FROM receipts WHERE mutation_id=?').get(command.mutationId);
    if(!receipt)return null;
    if(receipt.digest!==digest(command))throw new SessionError(409,'同一操作编号已用于其他内容。','MUTATION_CONFLICT');
    return {...parse(receipt.result_json,{}),replayed:true};
  }
  saveReceipt(command,result){
    this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(command.mutationId,digest(command),JSON.stringify(result),now());
    this.db.prepare('DELETE FROM receipts WHERE mutation_id IN (SELECT mutation_id FROM receipts ORDER BY created DESC LIMIT -1 OFFSET 1000)').run();
    return result;
  }
  applyReview(command,rules){
    const replay=this.checkedReceipt(command);if(replay)return replay;
    return this.transaction(()=>{
      const meta=this.assertContext(command),generation=Number(meta.generation),revision=Number(meta.revision)+1,operationId=crypto.randomUUID();
      this.ensureGroupCounts(generation);this.db.exec('CREATE TEMP TABLE IF NOT EXISTS mutation_groups(group_id TEXT PRIMARY KEY); DELETE FROM mutation_groups');
      const fields=JSON.stringify(Object.keys(command.patch||{}).filter(k=>(command.patch[k]?.mode||command.patch[k]?.status||command.patch[k])!=='keep'));
      const previous=this.db.prepare('SELECT derived_json FROM derived_rows WHERE row_id=? AND generation=?'),upsert=this.db.prepare('INSERT INTO reviews(row_id,review_json,revision) VALUES(?,?,?) ON CONFLICT(row_id) DO UPDATE SET review_json=excluded.review_json,revision=excluded.revision'),change=this.db.prepare('INSERT INTO operation_changes VALUES(?,?,?,?,?)');
      let changed=0,protectedCount=0;
      // The transaction is the staging boundary: a late invalid row or killed process
      // rolls back reviews, counters, undo data and receipts together. Only one row's
      // preview is retained in JS, even for a whole 500,000-row group.
      for(const rowId of this.iterateTargets(command)){
        const raw=this.raw(rowId);if(!raw)throw new SessionError(422,'包含已失效的规格，请刷新后重试。','ROW_NOT_FOUND');
        if(command.action?.type==='group-fill-missing'){const derived=parse(previous.get(rowId,generation)?.derived_json),keys=Object.keys(command.patch||{});if(keys.length!==1||!['material','thickness'].includes(keys[0]))throw new SessionError(422,'仅支持补齐同商品缺失的材质或厚度。','INVALID_FILL');const field=keys[0],value=derived[field];if(value?.status!=='pending'||value.reason!=='missing'||value.source==='manual'||(field==='thickness'&&derived.material?.materialId!==command.patch.thickness.materialId)){protectedCount++;continue;}}
        const review=this.review(rowId),preview=Recognition.previewTransferRowPatch(raw,review,command.patch,command.action,rules,this.getMeta('thicknessDefaults',{}),this.getMeta('thicknessMode','missing')),oldJson=JSON.stringify(review),newJson=JSON.stringify(preview.review);protectedCount+=preview.protectedFields.length;
        if(oldJson===newJson)continue;
        const oldDerived=parse(previous.get(rowId,generation)?.derived_json);
        this.replaceDerivedIncrementally(oldDerived,preview.derived,generation);upsert.run(rowId,newJson,revision);change.run(operationId,rowId,oldJson,newJson,fields);changed++;
      }
      if(!changed)throw new SessionError(422,'没有可保存的变更。','NO_CHANGES');
      this.finishMutationGroups(generation);this.setMeta('revision',revision);this.setMeta('lastOperation',{operationId,revision,rulesFingerprint:meta.rulesFingerprint});
      const summary={mutationId:command.mutationId,operationId,revision,changed,protected:protectedCount,counts:this.counts(generation)};
      this.saveReceipt(command,summary);
      this.db.prepare('DELETE FROM operation_changes WHERE operation_id<>?').run(operationId);
      return summary;
    });
  }
  undo(command,rules){
    if(command.mutationId){const replay=this.checkedReceipt(command);if(replay)return replay;}
    return this.transaction(()=>{
      const meta=this.assertContext(command),last=meta.lastOperation;if(!last||last.revision!==meta.revision)throw new SessionError(409,'最近操作已无法撤销。','UNDO_EXPIRED');
      if(last.rulesFingerprint&&last.rulesFingerprint!==meta.rulesFingerprint)throw new SessionError(409,'规则已变更，最近操作已无法撤销。','RULES_CHANGED');
      const generation=Number(meta.generation),revision=Number(meta.revision)+1;this.ensureGroupCounts(generation);this.db.exec('CREATE TEMP TABLE IF NOT EXISTS mutation_groups(group_id TEXT PRIMARY KEY); DELETE FROM mutation_groups');
      const put=this.db.prepare('INSERT INTO reviews(row_id,review_json,revision) VALUES(?,?,?) ON CONFLICT(row_id) DO UPDATE SET review_json=excluded.review_json,revision=excluded.revision'),previous=this.db.prepare('SELECT derived_json FROM derived_rows WHERE row_id=? AND generation=?');let undone=0;
      for(const item of this.db.prepare('SELECT * FROM operation_changes WHERE operation_id=? ORDER BY row_id').iterate(last.operationId)){
        const review=parse(item.old_review,{}),derived=Recognition.deriveTransferRow(this.raw(item.row_id),review,{rules,thicknessDefaults:this.getMeta('thicknessDefaults',{}),thicknessMode:this.getMeta('thicknessMode','missing')});
        this.replaceDerivedIncrementally(parse(previous.get(item.row_id,generation)?.derived_json),derived,generation);put.run(item.row_id,JSON.stringify(review),revision);undone++;
      }
      if(!undone)throw new SessionError(409,'没有可撤销的操作。','UNDO_MISSING');
      this.finishMutationGroups(generation);this.setMeta('revision',revision);this.setMeta('lastOperation',null);this.db.prepare('DELETE FROM operation_changes WHERE operation_id=?').run(last.operationId);
      const result={revision,undone,counts:this.counts(generation)};
      return command.mutationId?this.saveReceipt(command,result):result;
    });
  }
  registerArtifact(filename,name,fingerprint){const artifactId=crypto.randomUUID();this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?)').run(artifactId,filename,name,fingerprint,now());return {artifactId,name};}
  artifact(id){return this.db.prepare('SELECT * FROM artifacts WHERE artifact_id=?').get(id)||null;}
  salesPage({page=1,pageSize=100}={}){pageSize=Math.max(1,Math.min(100,Number(pageSize)||100));page=Math.max(1,Number(page)||1);const total=Number(this.db.prepare('SELECT count(*) n FROM sales_aggregates').get().n),totalPages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,totalPages);const representative=this.db.prepare('SELECT row_id FROM raw_rows WHERE platform=? AND shop=? AND product_id=? AND sku_id=? ORDER BY row_id LIMIT 1'),binding=this.db.prepare('SELECT item_id,excluded FROM sales_bindings WHERE row_id=?'),items=this.db.prepare('SELECT platform,shop,product_id,sku_id,quantity_text,quantity,source_count FROM sales_aggregates ORDER BY platform,shop,product_id,sku_id LIMIT ? OFFSET ?').all(pageSize,(page-1)*pageSize).map(row=>{const isolated=/^@row:(\d+)$/.exec(row.product_id),rowId=isolated?Number(isolated[1]):representative.get(row.platform,row.shop,row.product_id,row.sku_id)?.row_id||null,saved=rowId?binding.get(rowId):null;return {rowId,platform:row.platform,shop:row.shop,productId:isolated?'':row.product_id,skuId:/^@row:/.test(row.sku_id)?'':row.sku_id,quantityText:row.quantity_text,quantity:row.quantity,sourceCount:row.source_count,needsBinding:!!isolated,itemId:saved?.item_id||'',excluded:!!saved?.excluded};});const totals=this.db.prepare('SELECT coalesce(sum(quantity),0) quantity,coalesce(sum(source_count),0) sourceRows,count(distinct platform) platforms,count(distinct shop) shops FROM sales_aggregates').get();return {items,page,pageSize,total,totalPages,summary:{quantity:Number(totals.quantity),sourceRows:Number(totals.sourceRows),platforms:Number(totals.platforms),shops:Number(totals.shops),fingerprint:this.getMeta('salesFingerprint','')},revision:this.getMeta('revision',0),workspaceId:this.getMeta('workspaceId'),storageEpoch:this.getMeta('storageEpoch'),target:this.getMeta('target')};}
  salesReview(command){const replay=this.checkedReceipt(command);if(replay)return replay;this.assertContext(command);const commandDigest=digest(command);const seeds=this.targetRowIds(command),expanded=new Set();for(const rowId of seeds){const raw=this.raw(rowId);if(raw?.platform&&raw.shop&&raw.productId&&raw.skuId)for(const item of this.db.prepare('SELECT row_id FROM raw_rows WHERE platform=? AND shop=? AND product_id=? AND sku_id=?').all(raw.platform,raw.shop,raw.productId,raw.skuId))expanded.add(item.row_id);else expanded.add(rowId);}const ids=[...expanded],itemId=String(command.patch?.itemId||''),excluded=!!command.patch?.excluded;if(!excluded&&!itemId)throw new SessionError(422,'请选择绑定的 SKU，或明确排除。','INVALID_SALES_BINDING');const meta=this.metadata(),revision=Number(meta.revision)+1;return this.transaction(()=>{const put=this.db.prepare('INSERT INTO sales_bindings(row_id,item_id,excluded,revision) VALUES(?,?,?,?) ON CONFLICT(row_id) DO UPDATE SET item_id=excluded.item_id,excluded=excluded.excluded,revision=excluded.revision');for(const rowId of ids)put.run(rowId,itemId,excluded?1:0,revision);this.setMeta('revision',revision);const result={mutationId:command.mutationId,revision,changed:ids.length};this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(command.mutationId,commandDigest,JSON.stringify(result),now());return result;});}
  salesCandidate(meta={}){
    if(meta.matchBy==='size'){
      if(this.getMeta('phase')!=='reviewing')throw new SessionError(409,'请等待销售文件汇总完成。','SALES_NOT_READY');
      return require('./sales-size-import.cjs').candidate(this,meta);
    }
    const planItems=meta.items||meta.planItems||[];if(!Array.isArray(planItems)||planItems.length>10000)throw new SessionError(422,'计划 SKU 数量超限。','PLAN_ITEM_LIMIT');const seen=new Set(),matchedKeys=new Set(),items=[],byId=new Map();let missing=0,excluded=0,total=0;const query=this.db.prepare('SELECT * FROM sales_aggregates WHERE product_id=? AND sku_id=?'),filtered=this.db.prepare('SELECT * FROM sales_aggregates WHERE product_id=? AND sku_id=? AND platform=? AND shop=?');for(const item of planItems){const itemId=String(item.itemId||item.id||'');if(!itemId||seen.has(itemId))throw new SessionError(422,'计划 SKU 编号缺失或重复。','INVALID_PLAN_ITEMS');seen.add(itemId);const productId=String(item.productId||''),skuId=String(item.skuId||''),rows=meta.platform&&meta.sourceShop?filtered.all(productId,skuId,String(meta.platform),String(meta.sourceShop)):query.all(productId,skuId);let count=0,isExcluded=false;if(!productId||!skuId||rows.length===0){missing++;isExcluded=meta.missingPolicy!=='zero';if(isExcluded)excluded++;}else if(rows.length>1&&!meta.platform&&!meta.sourceShop){isExcluded=true;excluded++;}else{count=rows.reduce((sum,row)=>sum+Number(row.quantity),0);for(const row of rows)matchedKeys.add(JSON.stringify([row.platform,row.shop,row.product_id,row.sku_id]));total+=count;}const output={id:itemId,itemId,count,productId,skuId,excluded:isExcluded};items.push(output);byId.set(itemId,output);}
    const supplied=new Map((meta.bindings||[]).filter(x=>Number.isSafeInteger(Number(x.rowId))).map(x=>[Number(x.rowId),x])),stored=this.db.prepare('SELECT row_id,item_id,excluded FROM sales_bindings').all();for(const row of stored)if(!supplied.has(row.row_id))supplied.set(row.row_id,{rowId:row.row_id,itemId:row.item_id,excluded:!!row.excluded});const mapping=this.getMeta('mapping',{});for(const binding of supplied.values()){const raw=this.raw(Number(binding.rowId));if(!raw)continue;const get=name=>Number.isInteger(mapping[name])?raw.values[mapping[name]]:'',quantityText=Recognition.text(get('sales'));if(!/^\d+$/.test(quantityText))continue;const quantity=Number(quantityText),sourceProductId=String(get('productId')??''),sourceSkuId=String(get('specId')??''),platform=Recognition.text(get('platform')),shop=Recognition.text(get('shop')),isolated=!platform||!shop||!sourceProductId||!sourceSkuId,productId=isolated?`@row:${raw.rowId}`:sourceProductId,skuId=sourceSkuId||`@row:${raw.rowId}`,auto=items.find(x=>x.productId===sourceProductId&&x.skuId===sourceSkuId&&!x.excluded);if(auto){auto.count=Math.max(0,auto.count-quantity);total=Math.max(0,total-quantity);}matchedKeys.add(JSON.stringify([platform,shop,productId,skuId]));if(!binding.excluded&&byId.has(String(binding.itemId))){const target=byId.get(String(binding.itemId));if(target.excluded){target.excluded=false;excluded=Math.max(0,excluded-1);}target.count+=quantity;total+=quantity;}}
    let unknown=0;for(const row of this.db.prepare('SELECT platform,shop,product_id,sku_id FROM sales_aggregates').iterate())if(!matchedKeys.has(JSON.stringify([row.platform,row.shop,row.product_id,row.sku_id])))unknown++;return {items,total,excluded,unknown,missing,revision:this.getMeta('revision',0),fingerprint:this.getMeta('salesFingerprint',''),itemsFingerprint:meta.itemsFingerprint||meta.skuFingerprint||'',skuFingerprint:meta.skuFingerprint||meta.itemsFingerprint||'',workspaceId:this.getMeta('workspaceId'),storageEpoch:this.getMeta('storageEpoch'),sessionId:this.getMeta('sessionId'),target:this.getMeta('target'),period:meta.period||null,basis:meta.basis||'quantity',missingPolicy:meta.missingPolicy||'exclude'};
  }
}

module.exports={ImportSessionStore,SessionError,digest};
