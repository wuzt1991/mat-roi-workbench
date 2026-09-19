'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ImportSessionStore,digest}=require('../server/import-session-store.cjs');
const Recognition=require('../public/product-recognition.js'),Domain=require('../public/domain.js');
const rules={materials:Domain.initialState().materials,sizes:Domain.initialState().sizes};
const mapping={platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8};
function fixture(t,n=3,{mixed=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-mutation-'));
 const store=new ImportSessionStore(directory,{create:true,meta:{sessionId:'s',ownerToken:'owner',workspaceId:'w',storageEpoch:1,rules,rulesFingerprint:digest(rules)}});
 t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});store.setMeta('mapping',mapping);
 const records=[];for(let i=1;i<=n;i++){const values=['抖音','店',mixed&&i===n?'亚麻地垫':'硅藻泥地垫','40*60cm 3mm','p','s'+i,20,'在售',1],d=Recognition.deriveTransferRow({rowId:i,sourceRow:i+1,values,mapping},{},{rules});records.push({rowId:i,sheetId:'r1',sourceRow:i+1,values,sourceHash:String(i),platform:d.platform,shop:d.shop,productId:d.productId,skuId:d.skuId,groupId:d.groupId,originalMissingThickness:false});}
 store.insertRawBatch(records);store.rebuildDerived(rules);return store;
}
function command(store,patch,extra={}){return {ownerToken:'owner',storageEpoch:1,expectedSessionRevision:store.getMeta('revision'),mutationId:'m-'+store.getMeta('revision'),rowIds:[1],action:{type:'row-edit'},patch,...extra};}
function snapshots(store){return Object.fromEntries(['reviews','derived_rows','groups','group_value_counts','operation_changes','receipts'].map(table=>[table,store.db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()]));}
test('review receipt replays before revision check while owner, epoch and body stay protected',t=>{
 const store=fixture(t),cmd=command(store,{size:{mode:'blank'}}),first=store.applyReview(cmd,rules);
 assert.deepEqual(store.applyReview(cmd,rules),{...first,replayed:true});assert.equal(store.getMeta('revision'),1);
 assert.throws(()=>store.applyReview({...cmd,patch:{material:{mode:'blank'}}},rules),e=>e.code==='MUTATION_CONFLICT');
 store.setMeta('ownerToken','another');assert.throws(()=>store.applyReview(cmd,rules),e=>e.code==='OWNER_CHANGED');store.setMeta('ownerToken','owner');
 store.setMeta('storageEpoch',2);assert.throws(()=>store.applyReview(cmd,rules),e=>e.code==='STORAGE_EPOCH_CHANGED');store.setMeta('storageEpoch',1);
 store.db.exec('DELETE FROM receipts');assert.throws(()=>store.applyReview(cmd,rules),e=>e.code==='SESSION_REVISION_CONFLICT');
});
test('sales receipt uses the same replay and ownership guarantees',t=>{
 const store=fixture(t),cmd=command(store,{itemId:'item',excluded:false}),first=store.salesReview(cmd);
 assert.deepEqual(store.salesReview(cmd),{...first,replayed:true});assert.equal(store.getMeta('revision'),1);
 assert.throws(()=>store.salesReview({...cmd,ownerToken:'wrong'}),e=>e.code==='OWNER_CHANGED');
});
test('row edits increment group counts, enter mixed state, unify and undo without rebuilding all groups',t=>{
 const store=fixture(t),groupId=store.page().groups[0].groupId;
 assert.equal(store.db.prepare('SELECT sum(count) n FROM group_value_counts').get().n,6);
 store.rebuildGroupsOutsideTransaction=()=>{throw Error('whole-group scan during mutation');};
 store.applyReview(command(store,{material:{mode:'blank'}}),rules);
 let group=store.page().groups[0];assert.equal(group.materialState,'mixed');assert.equal(group.thicknessState,'mixed');assert.equal(group.total,3);
 store.applyReview(command(store,{material:{mode:'blank'}},{groupId,rowIds:undefined,action:{type:'group-unify'}}),rules);
 group=store.page().groups[0];assert.equal(group.materialState,'blank');assert.equal(group.thicknessState,'not-required');
 assert.equal(store.db.prepare('SELECT sum(count) n FROM group_value_counts').get().n,6);
 store.undo({ownerToken:'owner',storageEpoch:1,expectedSessionRevision:2},rules);
 group=store.page().groups[0];assert.equal(group.materialState,'mixed');assert.equal(store.review(2).material,undefined);assert.equal(store.review(1).material.status,'blank');
 assert.equal(store.page().rows[2].derived.values[19],20);
});
test('late invalid row rolls back every earlier review, counters, receipt and undo record',t=>{
 const store=fixture(t,4,{mixed:true}),before=snapshots(store),material=rules.materials.find(x=>x.name==='硅藻泥'),rule=material.weightRules.find(x=>x.thickness===3&&!x.deleted);
 const cmd=command(store,{thickness:{mode:'value',materialId:material.id,ruleId:rule.id}},{rowIds:[1,2,3,4]});
 assert.throws(()=>store.applyReview(cmd,rules),e=>e.code==='INVALID_RULE');assert.deepEqual(snapshots(store),before);assert.equal(store.getMeta('revision'),0);
});
test('large group applies and undoes atomically without materializing all target IDs',t=>{
 const store=fixture(t,1205),before=store.page().rows.map(x=>x.derived.values),groupId=store.page().groups[0].groupId;
 store.targetRowIds=()=>{throw Error('unbounded target materialization');};
 const result=store.applyReview(command(store,{size:{mode:'blank'}},{groupId,rowIds:undefined,action:{type:'group-unify'}}),rules);
 assert.equal(result.changed,1205);assert.equal(store.page().groups[0].thicknessState,'not-required');
 const undone=store.undo({ownerToken:'owner',storageEpoch:1,expectedSessionRevision:1},rules);assert.equal(undone.undone,1205);assert.deepEqual(store.page().rows.map(x=>x.derived.values),before);
 assert.throws(()=>store.undo({ownerToken:'owner',storageEpoch:1,expectedSessionRevision:2},rules),e=>e.code==='UNDO_EXPIRED');
});
test('undo rejects changed rules without touching reviewed data',t=>{
 const store=fixture(t);store.applyReview(command(store,{size:{mode:'blank'}}),rules);const before=snapshots(store),changed=structuredClone(rules);changed.materials[0].name+=' changed';store.setMeta('rulesFingerprint',digest(changed));
 assert.throws(()=>store.undo({ownerToken:'owner',storageEpoch:1,expectedSessionRevision:1},changed),e=>e.code==='RULES_CHANGED');assert.deepEqual(snapshots(store),before);
});
