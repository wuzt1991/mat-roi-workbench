'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const M = require('../public/domain.js');

class StoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
class Store {
  constructor(directory, { now=()=>new Date().toISOString() }={}) {
    this.now=now;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.filename = path.join(directory, 'workbench.sqlite');
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery (id INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, reason TEXT NOT NULL);`);
    try { this.upgrade(); } catch(error) { this.db.close(); throw error; }
  }
  upgrade() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare('SELECT * FROM workspace WHERE id=1').get();
      if(row){
        const original=JSON.parse(row.data);
        if(original.version!==3){
          const state=M.migrate(original);
          if(!M.validateBackup(state))throw new StoreError(500,'旧版数据升级检查未通过，原数据已保留。请使用旧版导出备份。');
          const updated=this.now();
          this.db.prepare('INSERT INTO recovery(revision,data,created,reason) VALUES(?,?,?,?)').run(row.revision,row.data,updated,'schema-upgrade-original');
          this.db.prepare('UPDATE workspace SET revision=?,data=?,updated=? WHERE id=1').run(row.revision+1,JSON.stringify(state),updated);
        }
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  read() {
    const row = this.db.prepare('SELECT * FROM workspace WHERE id=1').get();
    if (!row) return { revision: 0, state: null, updated: null };
    const state = JSON.parse(row.data);
    if (!M.validateBackup(state)) throw new StoreError(500, '数据库内容校验失败。请保留数据文件并从恢复点下载备份。');
    return { revision: row.revision, state, updated: row.updated };
  }
  write(input, revision, reason = 'save') {
    const state = M.migrate(input);
    if (!M.validateBackup(state)) throw new StoreError(422, '数据校验失败：请检查输入或备份中的历史账目。当前数据库未改变。');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new StoreError(400, '缺少有效的数据版本。');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.read();
      if (revision !== previous.revision) throw new StoreError(409, '另一个窗口已更新数据。请先导出本页草稿，再加载最新数据。');
      // A migration only materializes normalized compatibility fields; it must not be
      // treated as an edit to frozen historical records.
      if (previous.state && reason !== 'restore' && reason !== 'migration') this.checkHistory(previous.state, state);
      const serialized = JSON.stringify(state), updated = this.now();
      // Ordinary edits update one workspace. Checkpoints are coalesced by day;
      // business records and originals retained by earlier versions are never pruned.
      if(previous.state){
        const checkpointReason=reason==='restore'?'before-restore-v3':'daily-v3';
        const exists=this.db.prepare('SELECT id FROM recovery WHERE reason=? AND substr(created,1,10)=? LIMIT 1').get(checkpointReason,updated.slice(0,10));
        if(reason==='restore'||!exists){
          this.db.prepare('INSERT INTO recovery(revision,data,created,reason) VALUES(?,?,?,?)').run(previous.revision,JSON.stringify(previous.state),updated,checkpointReason);
          const keep=checkpointReason==='daily-v3'?30:10;
          this.db.prepare('DELETE FROM recovery WHERE reason=? AND id NOT IN (SELECT id FROM recovery WHERE reason=? ORDER BY id DESC LIMIT ?)').run(checkpointReason,checkpointReason,keep);
        }
      }else this.db.prepare('INSERT INTO recovery(revision,data,created,reason) VALUES(?,?,?,?)').run(0,serialized,updated,'initial-import');
      this.db.prepare('INSERT INTO workspace(id,revision,data,updated) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated=excluded.updated')
        .run(revision + 1, serialized, updated);
      this.db.exec('COMMIT');
      return { revision: revision + 1, updated };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  checkHistory(before, after) {
    for (const plan of before.plans) {
      const next = after.plans.find(p => p.id === plan.id);
      if (!next||next.shopId!==plan.shopId) throw new StoreError(422, '计划和所属店铺不能移除或改写；请使用计划管理中的删除功能。');
    }
    const nextRecords=new Map(after.records.map(h=>[h.id,h]));
    for(const record of before.records){
      const candidate=nextRecords.get(record.id);
      const immutable=h=>{const {status,replacedBy,voidedAt,...values}=h;return values;};
      if(!candidate||!isDeepStrictEqual(immutable(record),immutable(candidate)))
        throw new StoreError(422,'已入账的数据不能改写或删除，请使用更正或作废。');
      if(record.status!=='confirmed'&&!isDeepStrictEqual(record,candidate))
        throw new StoreError(422,'已更正或已作废的版本不能重新启用。');
      if(record.status==='confirmed'&&candidate.status==='confirmed'&&!isDeepStrictEqual(record,candidate))
        throw new StoreError(422,'账目状态修改无效。');
    }
  }
  backups() { return this.db.prepare('SELECT id,revision,created,reason FROM recovery ORDER BY id DESC LIMIT 100').all(); }
  backup(id) {
    const row = this.db.prepare('SELECT data FROM recovery WHERE id=?').get(id);
    if (!row) throw new StoreError(404, '恢复点不存在。');
    return JSON.parse(row.data);
  }
  close() { this.db.close(); }
}
module.exports = { Store, StoreError };
