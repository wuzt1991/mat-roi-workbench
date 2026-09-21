'use strict';
// Synthetic fixture, also evaluated against the installed v1.1.10 renderer model.
function addLegacyLedgerFixture(model,state){
  const p=state.plans[0];
  p.items=[{sizeId:state.sizes[0].id,price:20,share:100,weight:.5}];
  Object.assign(p.params,{spend:100,actualRoi:3});
  const old=model.confirmRecord(state,{frame:model.makeFrame(state,p),date:'2026-09-01'});
  for(const key of ['netMargin','netRoi','netRevenue'])delete old.result[key];
  model.confirmRecord(state,{frame:model.makeFrame(state,p),date:'2026-09-02'});
  return state;
}
module.exports={addLegacyLedgerFixture};
