'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const M = require('../public/domain.js');
const SCHEMA_VERSION = 4;
class StoreError extends Error {
  constructor(status, message, code='STORAGE_ERROR') { super(message); this.status=status; this.code=code; }
}
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
class Store {
  constructor(directory, { now=()=>new Date().toISOString(), model=M }={}) {
    this.now=now;this.model=model;this.filename=path.join(directory,'workbench.sqlite');this.db=null;this.startupError=null;
    try {
      mkdirSync(directory,{recursive:true,mode:0o700});
      this.db=new DatabaseSync(this.filename);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS recovery (id INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, reason TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_meta (id INTEGER PRIMARY KEY CHECK(id=1), workspace_id TEXT NOT NULL, storage_epoch INTEGER NOT NULL DEFAULT 0, restore_receipt TEXT);`);
      this.db.prepare('INSERT OR IGNORE INTO workspace_meta(id,workspace_id,storage_epoch) VALUES(1,?,0)').run(randomUUID());
      try { this.upgrade(); } catch(error) { this.startupError=this.asError(error); }
    } catch(error) {
      this.startupError=new StoreError(503,'数据库无法读取。请关闭工作台，保全数据库及 WAL/SHM 文件后，在隔离目录恢复合法备份。','SQL_UNREADABLE');
      try{this.db?.close();}catch{}this.db=null;
    }
  }
  asError(error) {return error instanceof StoreError?error:new StoreError(422,error instanceof SyntaxError?'工作区 JSON 已损坏，请下载原件并从合法备份恢复。':'工作区升级或校验失败，原始数据已保留，请从合法备份恢复。',error instanceof SyntaxError?'INVALID_JSON':'INVALID_WORKSPACE');}
  requireDB(){if(!this.db)throw this.startupError||new StoreError(503,'数据库不可用。','SQL_UNREADABLE');}
  metadata(){this.requireDB();const row=this.db.prepare('SELECT * FROM workspace_meta WHERE id=1').get();return {workspaceId:row.workspace_id,storageEpoch:row.storage_epoch};}
  rawRow(){this.requireDB();return this.db.prepare('SELECT * FROM workspace WHERE id=1').get();}
  validate(state){return state?.version===SCHEMA_VERSION&&this.model.validateBackup(state);}
  candidate(source) {
    if(!source||typeof source!=='object'||!Number.isInteger(source.version))throw new StoreError(422,'工作区版本无效。','INVALID_WORKSPACE');
    if(source.version>SCHEMA_VERSION)throw new StoreError(409,'该数据由更新版本创建，请使用对应新版工作台。','FUTURE_SCHEMA');
    let state;
    try{state=source.version===SCHEMA_VERSION?structuredClone(source):(this.model.migrateWorkspace||this.model.migrate)(source,source.version);}catch(error){throw this.asError(error);}
    if(!this.validate(state))throw new StoreError(422,'数据校验失败：请检查输入或备份中的历史账目。原数据未改变。','INVALID_WORKSPACE');
    return state;
  }
  upgrade() {
    this.requireDB();this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.rawRow();
      if(!row){
        const state=this.model.initialState();
        if(!this.validate(state))throw new StoreError(500,'初始工作区校验未通过。','INVALID_SEED');
        this.db.prepare('INSERT INTO workspace VALUES(1,0,?,?)').run(JSON.stringify(state),this.now());
      }else{
        const original=JSON.parse(row.data),state=this.candidate(original);
        if(original.version!==SCHEMA_VERSION){
          const updated=this.now();this.checkpoint(row,'schema-upgrade-original',updated);
          this.db.prepare('UPDATE workspace SET revision=?,data=?,updated=? WHERE id=1').run(row.revision+1,JSON.stringify(state),updated);
        }
      }
      this.db.exec('COMMIT');this.startupError=null;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  read() {
    this.requireDB();if(this.startupError)throw this.startupError;
    const row=this.rawRow();
    if(!row)throw new StoreError(503,'工作区尚未初始化。','WORKSPACE_UNAVAILABLE');
    let state;try{state=JSON.parse(row.data);}catch(error){throw this.asError(error);}
    if(state?.version>SCHEMA_VERSION)throw new StoreError(409,'该数据由更新版本创建，请使用对应新版工作台。','FUTURE_SCHEMA');
    if(!this.validate(state))throw new StoreError(422,'数据库内容校验失败，请下载原件并从合法备份恢复。','INVALID_WORKSPACE');
    return {revision:row.revision,state,updated:row.updated,...this.metadata()};
  }
  recoveryStatus(){
    try{
      const row=this.rawRow(),meta=this.metadata();let error=this.startupError;
      if(!error)try{this.read();}catch(e){error=this.asError(e);}
      return {ok:!error,canRestore:true,revision:row?.revision??0,updated:row?.updated??null,...meta,...(error?{code:error.code,error:error.message}:{code:'READY'})};
    }catch(error){return {ok:false,canRestore:false,revision:null,workspaceId:null,storageEpoch:null,code:'SQL_UNREADABLE',error:this.asError(error).message};}
  }
  checkpoint(row,reason,created=this.now()) {
    if(row)this.db.prepare('INSERT INTO recovery(revision,data,created,reason) VALUES(?,?,?,?)').run(row.revision,row.data,created,reason);
  }
  write(input,revision,reason='save') {
    if(reason!=='save')throw new StoreError(400,'普通保存不允许迁移或整库恢复，请使用恢复接口。','INVALID_SAVE_REASON');
    if(input?.version!==SCHEMA_VERSION)throw new StoreError(409,'工作区已升级，请刷新工作台后重试。','SCHEMA_REFRESH_REQUIRED');
    if(!this.validate(input))throw new StoreError(422,'数据校验失败，当前数据库未改变。','INVALID_WORKSPACE');
    if(!Number.isSafeInteger(revision)||revision<0)throw new StoreError(400,'缺少有效的数据版本。','INVALID_REVISION');
    this.requireDB();if(this.startupError)throw this.startupError;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=this.read();
      if(revision!==previous.revision)throw new StoreError(409,'另一个窗口已更新数据。请先导出本页草稿，再加载最新数据。','REVISION_CONFLICT');
      this.checkHistory(previous.state,input);
      const updated=this.now(),row=this.rawRow();
      if(!this.db.prepare("SELECT id FROM recovery WHERE reason='daily-v4' AND substr(created,1,10)=? LIMIT 1").get(updated.slice(0,10))){
        this.checkpoint(row,'daily-v4',updated);
        this.db.exec("DELETE FROM recovery WHERE reason='daily-v4' AND id NOT IN (SELECT id FROM recovery WHERE reason='daily-v4' ORDER BY id DESC LIMIT 30)");
      }
      this.db.prepare('UPDATE workspace SET revision=?,data=?,updated=? WHERE id=1').run(revision+1,JSON.stringify(input),updated);
      const result={revision:revision+1,updated,...this.metadata()};this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  restore(input,expectedRevision,operationId) {
    this.requireDB();
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new StoreError(400,'缺少有效的数据版本。','INVALID_REVISION');
    if(typeof operationId!=='string'||!/^[-A-Za-z0-9_:.]{1,128}$/.test(operationId))throw new StoreError(400,'恢复操作标识无效。','INVALID_OPERATION_ID');
    const state=this.candidate(input),digest=createHash('sha256').update(canonical(state)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.rawRow(),meta=this.db.prepare('SELECT * FROM workspace_meta WHERE id=1').get();
      const receipt=meta.restore_receipt?JSON.parse(meta.restore_receipt):null,currentRevision=row?.revision??0;
      if(receipt?.operationId===operationId){
        if(receipt.digest!==digest||receipt.result.revision!==currentRevision||receipt.result.storageEpoch!==meta.storage_epoch)throw new StoreError(409,'该恢复操作已有不同内容或其后数据已更新，请重新复核。','RESTORE_REPLAY_CONFLICT');
        this.db.exec('COMMIT');this.startupError=null;return {...receipt.result,replayed:true};
      }
      if(currentRevision!==expectedRevision)throw new StoreError(409,'数据库已更新，请重新复核恢复范围。','REVISION_CONFLICT');
      const updated=this.now(),result={revision:currentRevision+1,updated,workspaceId:meta.workspace_id,storageEpoch:meta.storage_epoch+1};
      this.checkpoint(row,this.startupError?'before-recovery-original':'before-restore-v4',updated);
      this.db.exec("DELETE FROM recovery WHERE reason='before-restore-v4' AND id NOT IN (SELECT id FROM recovery WHERE reason='before-restore-v4' ORDER BY id DESC LIMIT 10)");
      this.db.prepare('INSERT INTO workspace(id,revision,data,updated) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated=excluded.updated').run(result.revision,JSON.stringify(state),updated);
      this.db.prepare('UPDATE workspace_meta SET storage_epoch=?,restore_receipt=? WHERE id=1').run(result.storageEpoch,JSON.stringify({operationId,digest,result}));
      this.db.exec('COMMIT');this.startupError=null;return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  checkHistory(before,after) {
    for(const plan of before.plans){const next=after.plans.find(p=>p.id===plan.id);if(!next||next.shopId!==plan.shopId)throw new StoreError(422,'计划和所属店铺不能移除或改写；请使用计划管理中的删除功能。','HISTORY_PROTECTED');}
    const nextRecords=new Map(after.records.map(h=>[h.id,h]));
    for(const record of before.records){
      const candidate=nextRecords.get(record.id),immutable=h=>{const {status,replacedBy,voidedAt,...values}=h;return values;};
      if(!candidate||!isDeepStrictEqual(immutable(record),immutable(candidate)))throw new StoreError(422,'已入账的数据不能改写或删除，请使用更正或作废。','HISTORY_PROTECTED');
      if(record.status!=='confirmed'&&!isDeepStrictEqual(record,candidate))throw new StoreError(422,'已更正或已作废的版本不能重新启用。','HISTORY_PROTECTED');
      if(record.status==='confirmed'&&candidate.status==='confirmed'&&!isDeepStrictEqual(record,candidate))throw new StoreError(422,'账目状态修改无效。','HISTORY_PROTECTED');
    }
  }
  backups(){this.requireDB();return this.db.prepare('SELECT id,revision,created,reason FROM recovery ORDER BY id DESC LIMIT 100').all();}
  backupRaw(id){this.requireDB();const row=this.db.prepare('SELECT data FROM recovery WHERE id=?').get(id);if(!row)throw new StoreError(404,'恢复点不存在。','BACKUP_NOT_FOUND');return row.data;}
  rawCurrent(){const row=this.rawRow();if(!row)throw new StoreError(404,'工作区原件不存在。','WORKSPACE_NOT_FOUND');return row.data;}
  backup(id){try{return JSON.parse(this.backupRaw(id));}catch(error){if(error instanceof StoreError)throw error;throw new StoreError(422,'该恢复点 JSON 已损坏，请下载原始文件。','INVALID_BACKUP_JSON');}}
  close(){try{this.db?.close();}finally{this.db=null;}}
}
module.exports={Store,StoreError};
