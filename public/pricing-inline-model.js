'use strict';
(function(root){
  const B=typeof module==='object'?require('./pricing-plan-model.js'):root.PricingPrototype;
  const VERSION='pricing-prototype-3';
  const DEFAULT_METRICS=['profit','roi'];
  const DEFAULT_COLUMNS=['spec','price','share','status'];
  const METRICS=['profit','roi','gmv','refundAmount','refundGmv','paymentRoi','refundRoi','investment'];
  const COLUMNS=['spec','price','share','status','materialCost','shipping','targetMargin','actualMargin','rowRoi'];
  function normalizeUi(s){
    s.prefs={...s.prefs,metrics:Array.isArray(s.prefs?.metrics)?s.prefs.metrics.filter(x=>METRICS.includes(x)):DEFAULT_METRICS,skuColumns:Array.isArray(s.prefs?.skuColumns)?s.prefs.skuColumns.filter(x=>COLUMNS.includes(x)):DEFAULT_COLUMNS};
    if(!s.prefs.metrics.length)s.prefs.metrics=[...DEFAULT_METRICS];
    for(const key of DEFAULT_COLUMNS)if(!s.prefs.skuColumns.includes(key))s.prefs.skuColumns.push(key);
    s.plans.forEach((p,index)=>{if(typeof p.pinned!=='boolean')p.pinned=false;if(!Number.isFinite(p.sortOrder))p.sortOrder=index;});
    return s;
  }
  function projected(state){return {...state,version:B.version,plans:state.plans.map(p=>({...p,settings:{...p.settings,packagingGrams:0},groups:p.groups.map(g=>({...g,...state.publicGroups.find(x=>x.id===g.id)})),rows:p.rows.map(r=>({...r,strategyId:''}))}))};}
  function migrate(input){
    if(input.version===VERSION){const current=normalizeUi(B.clone(input));if(!validState(current))throw Error('公共组合数据校验失败');return current;}
    const s=B.migrate(input);s.publicGroups=[];
    for(const p of s.plans){
      const before=B.calculate(s,p.id);
      for(const r of p.rows){if(r.strategyId){const calculated=before.rows.find(x=>x.id===r.id);if(r.priceMode!=='manual'&&B.positive(calculated.price)){r.priceMode='manual';r.manualPrice=calculated.price;r.priceSource='迁移保留原单行策略售价';}r.strategyId='';}}
      delete p.settings.packagingGrams;
      for(const g of p.groups){let shared=s.publicGroups.find(x=>x.name===g.name&&x.strategyId===g.strategyId);if(!shared){shared={...B.clone(g),id:B.id('publicgroup')};s.publicGroups.push(shared);}const old=g.id;Object.assign(g,shared);p.rows.filter(r=>r.groupId===old).forEach(r=>r.groupId=shared.id);}
    }
    s.version=VERSION;normalizeUi(s);if(!validState(s))throw Error('公共组合迁移失败');return s;
  }
  function validState(s){try{return s.version===VERSION&&Array.isArray(s.publicGroups)&&new Set(s.publicGroups.map(g=>g.id)).size===s.publicGroups.length&&s.publicGroups.every(g=>/^[\w.-]{1,120}$/.test(g.id)&&typeof g.name==='string'&&g.name.trim()&&g.name.length<=80&&s.strategies.some(x=>x.id===g.strategyId))&&Array.isArray(s.prefs?.metrics)&&s.prefs.metrics.length>0&&s.prefs.metrics.every(x=>METRICS.includes(x))&&new Set(s.prefs.metrics).size===s.prefs.metrics.length&&Array.isArray(s.prefs?.skuColumns)&&DEFAULT_COLUMNS.every(x=>s.prefs.skuColumns.includes(x))&&s.prefs.skuColumns.every(x=>COLUMNS.includes(x))&&new Set(s.prefs.skuColumns).size===s.prefs.skuColumns.length&&s.plans.every(p=>typeof p.pinned==='boolean'&&Number.isFinite(p.sortOrder)&&p.groups.every(g=>s.publicGroups.some(x=>x.id===g.id))&&p.rows.every(r=>!r.strategyId)&&!Object.hasOwn(p.settings,'packagingGrams'))&&B.validState(projected(s));}catch{return false;}}
  function activePlan(state,shopId=state.activeShop){const owner=state.shops.find(x=>x.id===shopId),plans=state.plans.filter(p=>p.shopId===shopId&&!p.archived).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.sortOrder-b.sortOrder);return plans.find(p=>p.id===owner?.activePlanId)||plans[0]||state.plans.find(p=>p.shopId===shopId);}
  const api={...B,version:VERSION,migrate,validState,activePlan,ui:{metrics:METRICS,columns:COLUMNS,defaultMetrics:DEFAULT_METRICS,defaultColumns:DEFAULT_COLUMNS},seed:()=>migrate(B.seed()),newPlan:(s,...args)=>{const p=B.newPlan(s,...args);delete p.settings.packagingGrams;p.pinned=false;p.sortOrder=Math.max(-1,...s.plans.filter(x=>x.shopId===p.shopId).map(x=>x.sortOrder||0))+1;return p;},calculate:(s,id)=>B.calculate(projected(s),id),shopSummary:(s,id)=>B.shopSummary(projected(s),id),makeRecord:(s,...args)=>{const t=s.version===VERSION?projected(s):s;const r=B.makeRecord(t,...args);s.records=t.records;return r;},correctionState:(s,r)=>B.correctionState(projected(s),r)};
  if(typeof module==='object')module.exports=api;else root.PricingPrototype=api;
})(typeof window==='object'?window:{});
