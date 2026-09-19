const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCandidate}=require('../public/sales-import-ui.js');

test('sales candidate uses the bounded backend aggregate, including SKUs outside the visible page',async()=>{
  const candidate=await buildCandidate({
    getContext:()=>({workspaceId:'w1',storageEpoch:2,shopId:'shop-1',planId:'plan-1',plan:{items:[{id:'item-a'},{id:'item-b'}]}}),
    session:{sessionId:'session-1'},filename:'sales.xlsx',period:'2026-09-01 至 2026-09-18',
    skuFingerprint:'fp-1',rows:[{rowId:'visible',itemId:'item-a',count:3}],pageComplete:false,
    aggregate:async()=>({total:8,items:[{id:'a',itemId:'item-a',count:3},{id:'b',itemId:'item-b',count:5}],missing:[]})
  });
  assert.equal(candidate.total,8);
  assert.deepEqual(candidate.items.map(x=>[x.itemId,x.count]),[['item-a',3],['item-b',5]]);
  assert.equal(candidate.itemsFingerprint,'fp-1');
});

test('sales candidate refuses a partial current page when no aggregate service is available',async()=>{
  await assert.rejects(()=>buildCandidate({
    getContext:()=>({planId:'plan-1',plan:{items:[{id:'item-a'}]}}),session:{sessionId:'session-1'},
    rows:[{rowId:'visible',itemId:'item-a',count:3}],pageComplete:false
  }),/全量汇总/);
});

test('sales candidate allows a complete bounded page only when explicitly marked complete',async()=>{
  const candidate=await buildCandidate({
    getContext:()=>({planId:'plan-1',plan:{items:[{id:'item-a'}]}}),session:{sessionId:'session-1'},
    rows:[{rowId:'only',itemId:'item-a',count:3}],pageComplete:true
  });
  assert.equal(candidate.total,3);
  assert.equal(candidate.items[0].itemId,'item-a');
});
