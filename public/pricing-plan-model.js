'use strict';
(function(root){
  const B=typeof module==='object'?require('./pricing-prototype-model.js'):root.PricingPrototype;
  const M=typeof module==='object'?require('./domain.js'):root.MatModel;
  const VERSION='pricing-prototype-2',clone=B.clone;
  const canonical=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  function newPlan(state,shopId,name='新广告计划'){
    const defaults=B.seed().shops[1].settings;
    return {id:B.id('adplan'),shopId,name,settings:{...clone(defaults),spend:'',actualRoi:'',shippingId:state.shippingTemplates[0].id},groups:[],rows:[],archived:false};
  }
  function migrate(input){
    if(input?.version===VERSION){if(!validState(input))throw Error('新版原型数据校验失败');return clone(input);}
    if(!B.validState(input))throw Error('旧原型数据校验失败，原数据保留');
    const state=clone(input);state.version=VERSION;state.plans=[];
    const planFor=new Map();
    state.shops=input.shops.map(s=>{const p={id:'ad-'+s.id,shopId:s.id,name:'默认广告计划',settings:clone(s.settings),groups:clone(s.groups),rows:clone(s.rows),archived:false};state.plans.push(p);planFor.set(s.id,p.id);return {id:s.id,name:s.name,activePlanId:p.id};});
    // Preserve v1 financial results and snapshot bytes. Only add ownership metadata.
    state.records=state.records.map(h=>({...h,planId:planFor.get(h.shopId),planName:'默认广告计划',snapshotVersion:1,source:'旧版店铺测算表'}));
    if(!validState(state))throw Error('迁移后校验失败，原数据保留');return state;
  }
  function seed(){return migrate(B.seed());}
  function activePlan(state,shopId=state.activeShop){const s=state.shops.find(x=>x.id===shopId);return state.plans.find(p=>p.id===s?.activePlanId&&p.shopId===shopId)||state.plans.find(p=>p.shopId===shopId&&!p.archived)||state.plans.find(p=>p.shopId===shopId);}
  function projected(state,plans=state.plans){return {...state,version:'pricing-prototype-1',shops:plans.map(p=>({id:p.id,name:p.name,settings:clone(p.settings),groups:clone(p.groups),rows:clone(p.rows)})),activeShop:plans[0]?.id,records:[],archives:[]};}
  function calculate(state,planId=activePlan(state)?.id){
    const plan=state.plans.find(p=>p.id===planId);if(!plan)throw Error('广告计划不存在');
    const r=B.calculate(projected(state,[plan]),plan.id);
    r.errors=r.errors.map(e=>e.replaceAll('全店','计划内'));
    const rates=M.refundMetrics(plan.settings),refundRate=rates.refundTotal;
    const validRefund=['unshipped','shippedOnly','returnRefund'].every(k=>B.nonnegative(plan.settings.refundRates[k]))&&B.finite(refundRate)&&refundRate<=100;
    const forecast=B.nonnegative(plan.settings.spend)&&B.nonnegative(plan.settings.actualRoi);
    const gmv=forecast?plan.settings.spend*plan.settings.actualRoi:null;
    const validGmv=B.nonnegative(gmv);
    // Sales forecasts do not depend on SKU mix completeness. Profit/cost still do.
    r.gmv=validGmv?gmv:null;
    r.refundAmount=validGmv&&validRefund?gmv*refundRate/100:null;
    r.refundGmv=B.nonnegative(r.refundAmount)?gmv-r.refundAmount:null;
    r.refundRoi=B.positive(plan.settings.spend)&&B.nonnegative(r.refundGmv)?r.refundGmv/plan.settings.spend:null;
    r.paymentRoi=B.positive(plan.settings.spend)&&validGmv?gmv/plan.settings.spend:null;
    r.refundRate=validRefund?refundRate:null;
    r.planId=plan.id;r.planName=plan.name;r.shopId=plan.shopId;
    if(!validGmv&&forecast){r.valid=false;r.errors.push('预估 GMV 超出计算范围');r.profit=null;r.investment=null;}
    return r;
  }
  function summarize(results){
    const complete=results.length>0&&results.every(r=>r.valid&&B.nonnegative(r.spend)&&B.nonnegative(r.gmv)&&B.nonnegative(r.refundAmount)&&B.nonnegative(r.refundGmv)&&B.finite(r.profit)&&B.finite(r.investment));
    const sum=k=>complete?results.reduce((n,r)=>n+r[k],0):null;
    const spend=sum('spend'),gmv=sum('gmv'),refundGmv=sum('refundGmv');
    return {complete,count:results.length,missing:results.filter(r=>!r.valid||!B.nonnegative(r.gmv)||!B.nonnegative(r.refundGmv)||!B.finite(r.profit)).map(r=>r.planName),spend,gmv,refundAmount:sum('refundAmount'),refundGmv,profit:sum('profit'),investment:sum('investment'),paymentRoi:B.positive(spend)?gmv/spend:null,refundRoi:B.positive(spend)?refundGmv/spend:null};
  }
  function shopSummary(state,shopId=state.activeShop){const results=state.plans.filter(p=>p.shopId===shopId&&!p.archived).map(p=>calculate(state,p.id));return {...summarize(results),plans:results};}
  function recordMetrics(record){
    if(record.snapshotVersion===2)return clone(record.result);
    const r=clone(record.result),settings=record.frame.shop.settings,rate=M.refundMetrics(settings).refundTotal;
    return {...r,planId:record.planId,planName:record.planName,refundRate:rate,refundAmount:r.gmv*rate/100,refundGmv:r.gmv*(1-rate/100),refundRoi:B.positive(r.spend)?r.gmv*(1-rate/100)/r.spend:null,paymentRoi:B.positive(r.spend)?r.gmv/r.spend:null};
  }
  function ledger(state,{shopId=state.activeShop,planId='',from='',to=''}={}){
    if(from&&!M.validDate(from)||to&&!M.validDate(to)||from&&to&&from>to)throw Error('日期范围无效');
    const rows=state.records.filter(h=>h.shopId===shopId&&(!planId||h.planId===planId)&&(!from||h.date>=from)&&(!to||h.date<=to)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    const effective=rows.filter(h=>h.status==='confirmed');
    const points=[...new Set(effective.map(h=>h.date))].sort().map(date=>({date,...summarize(effective.filter(h=>h.date===date).map(recordMetrics))}));
    return {rows,summary:summarize(effective.map(recordMetrics)),points};
  }
  function makeRecord(state,planId,date,note='',previousId=null,reason=''){
    if(!M.validDate(date)||date>B.today())throw Error('请选择今天或过去的有效日期');
    const plan=state.plans.find(p=>p.id===planId),previous=state.records.find(h=>h.id===previousId);
    if(!plan||plan.archived)throw Error('请选择使用中的广告计划');
    if(previousId&&(!previous||previous.status!=='confirmed'||previous.planId!==planId||!reason.trim()))throw Error('请检查原记录状态并填写更正原因');
    if(state.records.some(h=>h.planId===planId&&h.date===date&&h.status==='confirmed'&&h.id!==previousId))throw Error('本计划当天已有有效日账，请更正原记录');
    const result=calculate(state,planId);if(!result.valid||!B.finite(result.profit)||!B.nonnegative(result.gmv))throw Error(result.errors[0]||'请填写广告消耗和支付 ROI');
    const shop=state.shops.find(s=>s.id===plan.shopId);
    const record={id:B.id('record'),snapshotVersion:2,planId,planName:plan.name,shopId:shop.id,shopName:shop.name,date,note,reason,previousId,status:'confirmed',result:clone(result),frame:{plan:clone(plan),materials:clone(state.materials),sizes:clone(state.sizes),strategies:clone(state.strategies),shippingTemplates:clone(state.shippingTemplates)},createdAt:new Date().toISOString()};
    if(previous){previous.status='superseded';previous.replacedBy=record.id;}state.records.push(record);return record;
  }
  function correctionState(state,record){
    const next=clone(state),f=record.frame;
    for(const k of ['materials','sizes','strategies','shippingTemplates'])next[k]=clone(f[k]);
    const plan=record.snapshotVersion===2?clone(f.plan):{...clone(f.shop),id:record.planId,shopId:record.shopId,name:record.planName,archived:false};
    next.plans=next.plans.map(p=>p.id===record.planId?plan:p);return next;
  }
  function validState(state){
    try{
      if(state?.version!==VERSION||!Array.isArray(state.plans)||!state.plans.length||state.plans.length>10000||!Array.isArray(state.shops)||!state.shops.length||!Array.isArray(state.records)||!Array.isArray(state.archives))return false;
      const unique=a=>a.every(x=>x&&typeof x.id==='string'&&/^[\w.-]{1,120}$/.test(x.id))&&new Set(a.map(x=>x.id)).size===a.length;
      if(![state.shops,state.plans,state.records].every(unique)||!state.shops.some(s=>s.id===state.activeShop))return false;
      for(const s of state.shops)if(typeof s.name!=='string'||!s.name.trim()||s.name.length>80||!state.plans.some(p=>p.id===s.activePlanId&&p.shopId===s.id))return false;
      if(state.plans.some(p=>!state.shops.some(s=>s.id===p.shopId)||typeof p.archived!=='boolean'))return false;
      const check=projected(state);check.archives=state.archives;
      if(!B.validState(check))return false;
      const seen=new Set();
      for(const h of state.records){
        if(!state.plans.some(p=>p.id===h.planId&&p.shopId===h.shopId)||!M.validDate(h.date)||!['confirmed','superseded','void'].includes(h.status)||!h.frame||!h.result?.valid||!B.finite(h.result.profit)||!B.nonnegative(h.result.gmv)||typeof h.note!=='string'||typeof h.createdAt!=='string'||!h.createdAt)return false;
        if(h.status==='confirmed'){const key=h.planId+'|'+h.date;if(seen.has(key))return false;seen.add(key);}
        if(h.previousId){const old=state.records.find(x=>x.id===h.previousId);if(!old||old.planId!==h.planId||old.status!=='superseded'||old.replacedBy!==h.id||!h.reason?.trim())return false;}
        if(h.status==='superseded'&&!state.records.some(x=>x.id===h.replacedBy&&x.previousId===h.id))return false;
        const visited=new Set([h.id]);let cursor=h;while(cursor.previousId){if(visited.has(cursor.previousId))return false;visited.add(cursor.previousId);cursor=state.records.find(x=>x.id===cursor.previousId);if(!cursor)return false;}
        let computed;
        if(h.snapshotVersion===1){if(h.frame.shop?.id!==h.shopId)return false;computed=B.calculate({...state,...h.frame,shops:[h.frame.shop],activeShop:h.shopId},h.shopId);}
        else if(h.snapshotVersion===2){if(h.frame.plan?.id!==h.planId||h.frame.plan.shopId!==h.shopId)return false;computed=calculate({...state,...h.frame,plans:[h.frame.plan]},h.planId);}
        else return false;
        if(canonical(computed)!==canonical(h.result))return false;
      }
      return true;
    }catch{return false;}
  }
  const api={...B,version:VERSION,seed,migrate,newPlan,activePlan,calculate,shopSummary,recordMetrics,ledger,makeRecord,correctionState,validState,legacy:{seed:B.seed,calculate:B.calculate,makeRecord:B.makeRecord,validState:B.validState}};
  if(typeof module==='object')module.exports=api;else root.PricingPrototype=api;
})(typeof window==='object'?window:{});
