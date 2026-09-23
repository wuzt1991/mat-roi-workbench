'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../public/domain.js'),V3=require('../public/domain-v3.js');
const W=require('../public/workbook.js'),OldW=require('../public/workbook-v3.js');
const Excel=require('../public/assets/exceljs.min.js');
const {Store}=require('../server/store.cjs');
const {addLegacyLedgerFixture}=require('../scripts/release-validation/legacy-ledger-fixture.cjs');
const netKeys=['netMargin','netRoi','netRevenue'];

// Early v3 records predate the net metrics; later v3 records have all of them.
// Use synthetic business data, never a user's backup, as the committed fixture.
function oldWorkspace(){
  const s=addLegacyLedgerFixture(V3,V3.initialState());
  assert.equal(V3.validateBackup(s),true);
  return s;
}

test('v3 mixed-age ledger upgrades once without rewriting historical frames or results',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-legacy-ledger-'));let store=new Store(dir);
  t.after(()=>{store?.close();fs.rmSync(dir,{recursive:true,force:true});});
  const old=oldWorkspace(),raw=JSON.stringify(old,null,2);
  store.db.prepare('UPDATE workspace SET data=?,revision=7 WHERE id=1').run(raw);
  store.close();store=new Store(dir);
  const saved=store.read();assert.equal(saved.state.version,4);assert.equal(saved.revision,8);
  assert.deepEqual(saved.state.records,old.records);assert.deepEqual(M.ledger(saved.state),V3.ledger(old));
  assert.equal(store.backupRaw(store.backups().find(b=>b.reason==='schema-upgrade-original').id),raw);
  saved.state.plans[0].note='Ordinary edit after upgrade';store.write(saved.state,8);
  store.close();store=new Store(dir);assert.equal(store.read().revision,9);
  assert.deepEqual(store.read().state.records,old.records);
  assert.equal(store.backups().filter(b=>b.reason==='schema-upgrade-original').length,1);
});

test('v3 format-3 backup restores unchanged and still rejects altered visible data',async()=>{
  const s=oldWorkspace(),book=new Excel.Workbook();
  for(const [name,rows] of OldW.tables(s,3))book.addWorksheet(name).addRows(rows);
  const data=book.addWorksheet('恢复数据');data.state='veryHidden';
  data.addRow(['MAT-ROI-XLSX',3]);
  const raw=JSON.stringify(s);for(let start=0,index=0;start<raw.length;start+=24000)data.addRow([index++,raw.slice(start,start+24000)]);
  const restored=await W.importWorkbook(await book.xlsx.writeBuffer());
  assert.equal(M.validateBackup(restored),true);assert.deepEqual(restored.records,s.records);
  assert.deepEqual(await W.importWorkbook(await W.exportWorkbook(restored)),restored);
  book.getWorksheet('历史账目').getCell('I2').value=999999;
  await assert.rejects(W.importWorkbook(await book.xlsx.writeBuffer()),/已被改动/);
});

test('legacy exceptions are limited to absent net metrics; recorded values and core fields remain checked',()=>{
  const original=oldWorkspace();
  assert.equal(M.validateBackup(original),true);
  const migrated=M.migrate(original);assert.equal(M.validateBackup(migrated),true);
  for(const key of Object.keys(original.records[0].result)){
    const broken=structuredClone(original);delete broken.records[0].result[key];
    assert.equal(M.validateBackup(broken),false,`missing core field ${key}`);
    assert.throws(()=>M.migrate(broken));
  }
  for(const key of netKeys){
    const wrong=structuredClone(original);wrong.records[0].result[key]=999999;
    assert.equal(M.validateBackup(wrong),false);assert.throws(()=>M.migrate(wrong));
    const wrongV4=structuredClone(migrated);wrongV4.records[0].result[key]=999999;
    assert.equal(M.validateBackup(wrongV4),false);
  }
  const changed=structuredClone(migrated);changed.records[0].frame.plan.items[0].price+=1;
  assert.equal(M.validateBackup(changed),false);
});

test('new v4 records still require every net metric and old record correction keeps the original',()=>{
  const s=M.migrate(oldWorkspace()),original=structuredClone(s.records[0]);
  const h=M.confirmRecord(s,{frame:M.makeFrame(s,s.plans[0]),date:original.date,previousId:original.id,reason:'Correction'});
  assert.equal(M.validateBackup(s),true);assert.deepEqual(s.records[0].frame,original.frame);assert.deepEqual(s.records[0].result,original.result);
  assert.equal(h.frame.calculationVersion,4);
  for(const key of netKeys){const broken=structuredClone(s);delete broken.records.at(-1).result[key];assert.equal(M.validateBackup(broken),false);assert.throws(()=>M.migrate(broken));}
});
