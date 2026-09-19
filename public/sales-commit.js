(function(root){
  'use strict';
  const apiRoot=typeof module==='object'?require('./sales-import.js'):root.SalesImport;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));

  /**
   * Apply one bounded sales candidate to the latest state snapshot.
   * This adapter deliberately does not mutate the caller's state. Price and
   * other plan fields are read from the snapshot passed to the function;
   * SalesImport.apply only writes sales/share/source and permitted bindings.
   */
  function applyCandidate(state,payload={},context={}){
    if(!apiRoot?.prepare||!apiRoot?.apply)throw Error('销售保存规则未加载');
    const planId=payload.planId||context.planId||'';
    if(!planId)throw Error('缺少目标计划');
    const fingerprint=payload.skuFingerprint||payload.itemsFingerprint||payload.itemFingerprint||context.skuFingerprint||context.itemsFingerprint||'';
    if(!fingerprint)throw Error('缺少 SKU 集合指纹');
    const rows=(payload.items||[]).map((row,index)=>({
      id:row.id||row.itemId||`candidate-${index}`,
      itemId:row.itemId||'',
      count:row.count??row.quantity??row.sales??0,
      sales:row.sales??row.count??row.quantity??0,
      productId:row.productId||'',
      skuId:row.skuId||'',
      excluded:!!row.excluded,
      bind:!!row.bind||!!row.itemId
    }));
    const draft=apiRoot.prepare(state,planId,rows,{
      importId:payload.importId||payload.sessionId,
      filename:payload.filename||'',period:payload.period||'',basis:payload.basis||'orders',
      missingPolicy:payload.missingPolicy||'',unitsAcknowledged:!!payload.unitsAcknowledged,
      shopId:payload.shopId||context.shopId||'',skuFingerprint:fingerprint
    });
    draft.sessionId=payload.sessionId||'';
    draft.workspaceId=payload.workspaceId||context.workspaceId;
    draft.storageEpoch=payload.storageEpoch??context.storageEpoch;
    draft.itemsFingerprint=fingerprint;
    const applied=apiRoot.apply(clone(state),draft,{
      ...context,planId,workspaceId:payload.workspaceId||context.workspaceId,
      storageEpoch:payload.storageEpoch??context.storageEpoch
    });
    return {state:applied.state,undoToken:applied.undo||null,duplicate:!!applied.duplicate,importId:draft.importId};
  }
  const api={applyCandidate};
  root.SalesCommit=api;
  if(typeof module==='object')module.exports=api;
})(typeof window==='object'?window:globalThis);
