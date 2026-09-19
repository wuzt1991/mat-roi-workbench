'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const N=require('../public/pricing-inline-model.js');

test('v4 state receives global v5 preferences without changing snapshots',()=>{
  const state=N.seed(),frozen=JSON.stringify(state.records);
  delete state.prefs.metrics;delete state.prefs.skuColumns;
  state.plans.forEach(p=>{delete p.pinned;delete p.sortOrder;});
  const migrated=N.migrate(state);
  assert.deepEqual(migrated.prefs.metrics,['profit','roi']);
  assert.deepEqual(migrated.prefs.skuColumns,['spec','price','share','status']);
  assert.equal(JSON.stringify(migrated.records),frozen);
  assert.ok(N.validState(migrated));
});

test('active plan restores valid selection then falls back to pinned and first ordered plan',()=>{
  const state=N.seed(),shop=state.shops[0],first=state.plans[0];
  const second=N.newPlan(state,shop.id,'第二计划'),third=N.newPlan(state,shop.id,'置顶计划');
  state.plans.push(second,third);third.pinned=true;third.sortOrder=20;
  shop.activePlanId=second.id;assert.equal(N.activePlan(state,shop.id).id,second.id);
  second.archived=true;assert.equal(N.activePlan(state,shop.id).id,third.id);
  third.pinned=false;first.sortOrder=9;third.sortOrder=1;assert.equal(N.activePlan(state,shop.id).id,third.id);
});

test('global metric and column preferences survive cross-plan calculation and JSON roundtrip',()=>{
  const state=N.seed(),shop=state.shops[0],plan=N.newPlan(state,shop.id,'空白计划');state.plans.push(plan);
  state.prefs.metrics=['roi','profit','refundGmv'];state.prefs.skuColumns=['spec','price','share','status','shipping'];
  const restored=N.migrate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.prefs.metrics,state.prefs.metrics);
  assert.deepEqual(restored.prefs.skuColumns,state.prefs.skuColumns);
  assert.equal(restored.plans.find(p=>p.id===plan.id).rows.length,0);
  assert.ok(N.validState(restored));
});
