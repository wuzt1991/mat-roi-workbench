/* Isolated review model. Production records and persistence are never written. */
(function(root){
  'use strict';
  const M=typeof module==='object'?require('./domain.js'):root.MatModel;
  const B=typeof module==='object'?require('./pricing-prototype-model.js'):root.PricingPrototype;
  const P=typeof module==='object'?require('./review-20260918-promotions.js'):root.ReviewPromotions;
  const clone=v=>structuredClone(v),id=M.uid,positive=M.positive,nonnegative=M.nonnegative;
  const VERSION='mat-review-20260918-1',KEY='mat-workbench-review-20260918';
  const columns={price:'到手价 / 元',margin:'毛利率 / %',share:'订单占比 / %',sales:'销售数量',material:'材料成本',shipping:'单次运费',weight:'发货重量 / g',roi:'保本 ROI'};
  const modes={area:'面积递增毛利',rank:'成本排名阶梯毛利',fixed:'统一毛利'};
  function strategyErrors(s){return B.strategyErrors({...s,round:'cent'});}
  function target(s,area,rank){
    if(!s||strategyErrors(s).length||!positive(area))return null;
    if(s.mode==='area')return Math.min(s.cap,s.baseMargin+Math.max(0,Math.floor((area-s.baseArea)/s.stepArea+1e-9))*s.stepPoints);
    if(s.mode==='rank')return rank>0?(s.tiers[rank-1]??s.fallback):null;
    return s.margin;
  }
  function seed(){
    const source=M.initialState(),materials=source.materials.filter(m=>m.builtinKey!==undefined);
    const sizes=[[40,60],[50,80],[50,100],[60,100],[70,100],[80,120],[100,150]].map(([w,h],i)=>({id:'size-'+i,name:'',salesW:w,salesH:h,irregular:false,productionW:'',productionH:'',active:true,deleted:false}));
    materials.forEach(m=>m.deleted=false);
    const material=materials.find(m=>m.name==='硅藻泥'),rule=material.weightRules.find(r=>r.default);
    const params={...clone(M.defaults),refundRates:{unshipped:3,shippedOnly:1,returnRefund:6,firstHour:2},otherFeeScope:'shipped',spend:1000,actualRoi:4,fee:5,tax:2};
    const shop={id:'shop-a',name:'地垫旗舰店',materialId:material.id,ruleId:rule.id,shippingId:'regular',strategyId:'area-b',params,rows:sizes.map((s,i)=>({id:'row-'+i,sizeId:s.id,materialId:material.id,ruleId:rule.id,productId:'product-001',skuId:'SKU-'+String(i+1).padStart(3,'0'),priceMode:'auto',manualPrice:'',weightGrams:'',share:[25,20,15,12,10,10,8][i],sales:null})),salesSource:null};
    return migrate({version:VERSION,revision:0,activeShop:shop.id,shops:[shop,{...clone(shop),id:'shop-b',name:'地垫生活店',rows:[],params:{...clone(params),spend:'',actualRoi:''}}],materials,sizes,sizeSchemes:[
      {id:'size-scheme-standard',name:'常用地垫尺寸',sizeIds:sizes.slice(0,5).map(s=>s.id),deleted:false}
    ],shippingTemplates:[{...M.regionalShippingTemplate(),id:'regular',name:'中通 · 普通省份常规价',deleted:false},{id:'fixed-2',name:'固定运费 · 2 元',type:'fixed',fee:2,active:true,deleted:false}],strategies:[
      {id:'area-a',name:'面积递增 A · 每 0.1㎡ +1',mode:'area',baseArea:.5,baseMargin:10,stepArea:.1,stepPoints:1,cap:40,round:'cent',active:true,deleted:false},
      {id:'area-b',name:'面积递增 B · 每 0.1㎡ +2',mode:'area',baseArea:.5,baseMargin:10,stepArea:.1,stepPoints:2,cap:40,round:'cent',active:true,deleted:false},
      {id:'rank',name:'阶梯毛利 · 引流款',mode:'rank',tiers:[10,15,20],fallback:25,round:'cent',active:true,deleted:false},
      {id:'fixed',name:'统一毛利 · 30%',mode:'fixed',margin:30,round:'cent',active:true,deleted:false}],prefs:{columns:['price','margin','share','material','shipping','roi'],metrics:['roi','profit','gmv','investment']},records:[],product:null});
  }
  const planFields=['materialId','ruleId','shippingId','strategyId','params','rows','salesSource','promotionSchemeId'];
  function planData(shop){return Object.fromEntries(planFields.map(k=>[k,clone(shop[k])]));}
  function syncPlan(shop){const plan=shop.plans?.find(p=>p.id===shop.activePlanId&&!p.deleted);if(plan)Object.assign(plan,planData(shop));}
  function migrate(input,depth=0){
    const state=clone(input);if(!state||state.version!==VERSION||depth>1)return state;
    for(const key of ['strategies','materials','sizes','shippingTemplates'])if(Array.isArray(state[key]))state[key].forEach(x=>{if(x.deleted===undefined)x.deleted=false;});
    if(state.promotionSchemes===undefined)state.promotionSchemes=[
      {id:'promo-discount-first',name:'9 折后直减 5 元',steps:[{type:'discount',discount:9},{type:'reduction',amount:5}],deleted:false},
      {id:'promo-reduction-first',name:'直减 5 元后 9 折',steps:[{type:'reduction',amount:5},{type:'discount',discount:9}],deleted:false}
    ];
    if(Array.isArray(state.promotionSchemes))state.promotionSchemes.forEach(x=>{if(x.deleted===undefined)x.deleted=false;});
    if(Array.isArray(state.shops))for(const shop of state.shops){if(shop.promotionSchemeId===undefined)shop.promotionSchemeId='';if(Array.isArray(shop.plans))for(const plan of shop.plans)if(plan.promotionSchemeId===undefined)plan.promotionSchemeId='';}
    if(state.sizeSchemes===undefined)state.sizeSchemes=[];
    if(Array.isArray(state.sizeSchemes))state.sizeSchemes.forEach(x=>{if(x.deleted===undefined)x.deleted=false;});
    if(Array.isArray(state.shops))for(const shop of state.shops){if(shop.plans===undefined){const plan={id:'plan-'+shop.id,name:'当前测算',deleted:false,...planData(shop)};shop.plans=[plan];shop.activePlanId=plan.id;}}
    if(depth===0&&Array.isArray(state.records))for(const record of state.records)if(record.snapshot)record.snapshot=migrate(record.snapshot,depth+1);
    return state;
  }
  function switchPlan(state,shop,planId){
    const plan=shop.plans.find(p=>p.id===planId&&!p.deleted);if(!plan)throw Error('计划不存在或已删除');
    syncPlan(shop);Object.assign(shop,clone(Object.fromEntries(planFields.map(k=>[k,plan[k]]))),{activePlanId:plan.id});return plan;
  }
  function createPlan(state,shop,name,copy=false){
    name=String(name||'').trim();if(!name)throw Error('请填写计划名称');if(shop.plans.some(p=>!p.deleted&&p.name===name))throw Error('已有同名计划');
    syncPlan(shop);const data=planData(shop);if(!copy){data.rows=[];data.salesSource=null;data.params.spend=data.params.actualRoi='';}
    const plan={...data,id:id('plan'),name,deleted:false};shop.plans.push(plan);switchPlan(state,shop,plan.id);return plan;
  }
  function deletePlan(state,shop,planId){
    const plan=shop.plans.find(p=>p.id===planId&&!p.deleted);if(!plan)throw Error('计划不存在或已删除');syncPlan(shop);plan.deleted=true;
    if(shop.activePlanId===planId){const next=shop.plans.find(p=>!p.deleted);if(next)switchPlan(state,shop,next.id);else{shop.activePlanId='';shop.rows=[];shop.salesSource=null;shop.params={...clone(shop.params),spend:'',actualRoi:''};}}
  }
  function restorePlan(state,shop,planId){const plan=shop.plans.find(p=>p.id===planId&&p.deleted);if(!plan)throw Error('已删除计划不存在');plan.deleted=false;if(!shop.activePlanId)switchPlan(state,shop,plan.id);return plan;}
  function calculate(state,shopId=state.activeShop){
    const shop=state.shops.find(s=>s.id===shopId);if(!shop)throw Error('店铺不存在');
    const strategy=state.strategies.find(s=>s.id===shop.strategyId),p=shop.params;
    const rows=shop.rows.map(row=>{
      const size=state.sizes.find(s=>s.id===row.sizeId),mat=state.materials.find(m=>m.id===row.materialId),rule=mat?.weightRules.find(r=>r.id===row.ruleId),area=M.productionArea(size),errors=[];
      if(!M.validSize(size)||!positive(area))errors.push('请完善尺寸');
      if(!rule||!nonnegative(rule.costPerSqm)||!nonnegative(rule.coefficient))errors.push('材料规则不完整');
      const weight=row.weightGrams===''?area*rule?.coefficient:row.weightGrams/1000;
      const shipping=M.shippingCost(state.shippingTemplates.find(t=>t.id===shop.shippingId),weight);
      if(shipping.error)errors.push(shipping.error);
      const material=area*rule?.costPerSqm,baseCost=material+(shipping.value??NaN);
      if(!nonnegative(baseCost))errors.push('成本不可用');
      return {...row,size,mat,rule,area,weight,material,shipping:shipping.value,baseCost,errors};
    });
    const ranks=rows.some(r=>r.errors.length)?null:[...new Set(rows.map(r=>Math.round(r.baseCost*100)))].sort((a,b)=>a-b);
    for(const r of rows){
      r.rank=ranks?ranks.indexOf(Math.round(r.baseCost*100))+1:null;r.target=target(strategy,r.area,r.rank);
      if(r.priceMode==='manual'||!shop.strategyId){r.price=positive(r.manualPrice)?r.manualPrice:null;if(r.price===null)r.errors.push('请填写有效售价');}
      else{
        if(!strategy)r.errors.push('请选择定价方案');
        else r.errors.push(...strategyErrors(strategy));
        if(strategy?.mode==='rank'&&!ranks)r.errors.push('有成本异常，排名定价暂停');
        const out=B.priceFor(r.baseCost,r.target,p.fee,p.tax,'cent');if(out.error)r.errors.push(out.error);r.price=r.errors.length?null:out.price;
      }
      r.margin=positive(r.price)&&nonnegative(r.baseCost)?(1-r.baseCost/r.price-(p.fee+p.tax)/100)*100:null;
      r.priceErrors=[...r.errors];
      if(!nonnegative(r.share)||r.share>100)r.errors.push('订单占比需为 0–100%');
      if(!r.errors.length){
        const mat={...clone(r.mat),price:r.rule.costPerSqm,weightRules:[{...r.rule,variant:'',default:true}]};
        const res=M.calculate({materials:[mat],sizes:[r.size],shippingTemplates:state.shippingTemplates},{id:r.id,materialId:mat.id,materialRuleId:r.ruleId,shippingId:shop.shippingId,params:p,packagingWeight:0,items:[{sizeId:r.sizeId,price:r.price,share:100,weight:r.weight}]});
        r.roiRow=res.rows[0];r.roi=res.roi;r.errors.push(...res.errors);
      }else r.roi=null;
    }
    const total=rows.reduce((a,r)=>a+(nonnegative(r.share)?r.share:0),0),errors=rows.flatMap(r=>r.errors.map(e=>`${r.size?M.sizeLabel(r.size):r.skuId}：${e}`));
    if(!rows.length)errors.push('请添加商品规格');
    if(Math.abs(total-100)>1e-6)errors.push('订单占比需合计 100%');
    const sum=key=>rows.reduce((a,r)=>a+(r.roiRow?.[key]??0)*r.share/100,0),price=sum('price'),margin=sum('margin'),cost=sum('cost'),valid=!errors.length;
    const gmv=nonnegative(p.spend)&&nonnegative(p.actualRoi)?p.spend*p.actualRoi:null,orders=positive(price)&&gmv!==null?gmv/price:null;
    return {rows,total,errors:[...new Set(errors)],valid,price:valid?price:null,cost:valid?cost:null,roi:valid&&margin>0?price/margin:null,profit:valid&&orders!==null?orders*margin-p.spend:null,gmv,investment:valid&&orders!==null?p.spend+orders*cost:null};
  }
  function switchStrategy(state,shop,strategyId){
    if(strategyId&&!state.strategies.some(s=>s.id===strategyId&&(!s.deleted||s.id===shop.strategyId)))throw Error('方案不存在');
    if(!strategyId){const result=calculate(state,shop.id);for(const row of shop.rows){const price=result.rows.find(r=>r.id===row.id).price;if(positive(price))row.manualPrice=price;row.priceMode='manual';}}
    shop.strategyId=strategyId;
  }
  function saveStrategy(state,draft,asNew=false){
    const errors=strategyErrors(draft);if(errors.length)throw Error(errors.join('；'));
    const same=state.strategies.find(s=>!s.deleted&&s.name.trim()===draft.name.trim()&&(asNew||s.id!==draft.id));if(same)throw Error('已有同名方案，请换一个名称');
    const existing=asNew?null:state.strategies.find(s=>s.id===draft.id);
    const next={...clone(draft),id:existing?.id||id('strategy'),name:draft.name.trim(),round:'cent',active:existing?.active??true,deleted:existing?.deleted??false};
    if(existing)Object.assign(existing,next);else state.strategies.push(next);return next;
  }
  function saveSizeScheme(state,draft,asNew=false){
    const name=String(draft?.name||'').trim(),sizeIds=[...new Set(draft?.sizeIds||[])];
    if(!name)throw Error('请填写尺寸方案名称');
    if(!sizeIds.length)throw Error('请至少选择一个尺寸');
    if(sizeIds.some(sizeId=>!state.sizes.some(s=>s.id===sizeId)))throw Error('尺寸方案包含不存在的尺寸');
    const existing=asNew?null:state.sizeSchemes.find(s=>s.id===draft.id);
    if(!asNew&&draft.id&&!existing)throw Error('尺寸方案不存在');
    if(state.sizeSchemes.some(s=>s.id!==existing?.id&&!s.deleted&&s.name===name))throw Error('已有同名尺寸方案，请换一个名称');
    const next={id:existing?.id||id('size-scheme'),name,sizeIds,deleted:existing?.deleted??false};
    if(existing)Object.assign(existing,next);else state.sizeSchemes.push(next);return next;
  }
  function applySizeScheme(state,shop,schemeId){
    const scheme=state.sizeSchemes.find(s=>s.id===schemeId&&!s.deleted);if(!scheme)throw Error('尺寸方案不存在或已删除');
    const existing=new Set(shop.rows.map(r=>r.sizeId));let added=0;
    for(const sizeId of scheme.sizeIds){
      const size=state.sizes.find(s=>s.id===sizeId&&!s.deleted);if(!size||existing.has(sizeId))continue;
      shop.rows.push({id:id('row'),sizeId,materialId:shop.materialId,ruleId:shop.ruleId,productId:'',skuId:'',priceMode:shop.strategyId?'auto':'manual',manualPrice:'',weightGrams:'',share:0,sales:null});
      existing.add(sizeId);added++;
    }
    return added;
  }
  function savePromotionScheme(state,draft,asNew=false){
    const errors=P.errors(draft);if(errors.length)throw Error(errors.join('；'));
    const existing=asNew?null:state.promotionSchemes.find(x=>x.id===draft.id);
    if(draft.id&&!asNew&&!existing)throw Error('活动方案不存在');
    const name=draft.name.trim();if(state.promotionSchemes.some(x=>!x.deleted&&x.id!==existing?.id&&x.name===name))throw Error('已有同名活动方案');
    const next={id:existing?.id||id('promotion'),name,steps:clone(draft.steps),deleted:existing?.deleted??false};if(existing)Object.assign(existing,next);else state.promotionSchemes.push(next);return next;
  }
  function selectPromotionScheme(state,shop,schemeId){if(schemeId&&!state.promotionSchemes.some(x=>x.id===schemeId&&(!x.deleted||x.id===shop.promotionSchemeId)))throw Error('活动方案不存在或已删除');shop.promotionSchemeId=schemeId;}
  function reusableList(state,kind){
    if(!['strategies','sizeSchemes','promotionSchemes','materials','sizes','shippingTemplates'].includes(kind))throw Error('不支持的可复用规则');
    return state[kind];
  }
  function deleteReusable(state,kind,itemId){const item=reusableList(state,kind).find(x=>x.id===itemId);if(!item)throw Error('规则不存在');item.deleted=true;return item;}
  function restoreReusable(state,kind,itemId){const item=reusableList(state,kind).find(x=>x.id===itemId);if(!item)throw Error('规则不存在');item.deleted=false;return item;}
  function normalizeShares(shop){B.normalizeShares(shop);}
  function makeRecord(state,date,note=''){
    if(!M.validDate(date)||date>M.today())throw Error('请选择今天或过去的日期');
    if(state.records.some(r=>r.shopId===state.activeShop&&r.date===date&&!r.voided))throw Error('当前店铺这一天已入账');
    const result=calculate(state);if(!result.valid||result.profit===null)throw Error('请先补齐测算和投放数据');
    state.shops.forEach(syncPlan);const snapshot=clone({...state,records:[],product:null});const shop=state.shops.find(s=>s.id===state.activeShop);
    const record={id:id('record'),date,note,shopId:shop.id,shopName:shop.name,planId:shop.activePlanId,planName:shop.plans.find(p=>p.id===shop.activePlanId)?.name,result:clone(result),snapshot,voided:false};state.records.push(record);return record;
  }
  function validState(s,depth=0){
    try{
      const unique=list=>Array.isArray(list)&&list.every(x=>typeof x.id==='string'&&x.id)&&new Set(list.map(x=>x.id)).size===list.length;
      const draft=v=>v===''||M.number(v),statuses=['pending','value','blank'];
      if(depth>1||s.version!==VERSION||!unique(s.shops)||!s.shops.length||!s.shops.some(x=>x.id===s.activeShop))return false;
      if(!unique(s.materials)||!s.materials.every(m=>typeof m.name==='string'&&m.name.trim()&&unique(m.weightRules)&&m.weightRules.length&&m.weightRules.every(r=>nonnegative(r.costPerSqm)&&nonnegative(r.coefficient))))return false;
      const reusable=list=>list.every(x=>typeof x.deleted==='boolean');
      if(!unique(s.sizes)||!s.sizes.every(M.validSize)||!reusable(s.sizes)||!unique(s.sizeSchemes)||!reusable(s.sizeSchemes)||!s.sizeSchemes.every(x=>typeof x.name==='string'&&x.name.trim()&&Array.isArray(x.sizeIds)&&x.sizeIds.length&&new Set(x.sizeIds).size===x.sizeIds.length&&x.sizeIds.every(id=>s.sizes.some(size=>size.id===id)))||!unique(s.shippingTemplates)||!s.shippingTemplates.every(M.validTemplate)||!reusable(s.shippingTemplates))return false;
      if(!unique(s.materials)||!reusable(s.materials))return false;
      if(!unique(s.promotionSchemes)||!reusable(s.promotionSchemes)||!s.promotionSchemes.every(x=>!P.errors(x).length))return false;
      const validPromotion=id=>id===''||typeof id==='string'&&s.promotionSchemes.some(x=>x.id===id);
      if(!s.shops.every(x=>validPromotion(x.promotionSchemeId)&&x.plans?.every(p=>validPromotion(p.promotionSchemeId))))return false;
      if(!unique(s.strategies)||!s.strategies.every(x=>!strategyErrors(x).length&&typeof x.active==='boolean')||!reusable(s.strategies))return false;
      if(!s.prefs||!Array.isArray(s.prefs.columns)||!s.prefs.columns.length||!s.prefs.columns.every(x=>columns[x])||!Array.isArray(s.prefs.metrics)||s.prefs.metrics.length<1||s.prefs.metrics.length>4||!s.prefs.metrics.every(x=>['roi','profit','gmv','investment','price','cost'].includes(x)))return false;
      if(!s.shops.every(shop=>typeof shop.name==='string'&&shop.name.trim()&&unique(shop.rows)&&(!shop.strategyId||s.strategies.some(x=>x.id===shop.strategyId))&&s.shippingTemplates.some(t=>t.id===shop.shippingId)&&s.materials.some(m=>m.id===shop.materialId&&m.weightRules.some(r=>r.id===shop.ruleId))&&shop.params&&Object.keys(M.defaults).every(k=>draft(shop.params[k]))&&shop.params.refundRates&&['unshipped','shippedOnly','returnRefund','firstHour'].every(k=>draft(shop.params.refundRates[k]))&&shop.rows.every(r=>['auto','manual'].includes(r.priceMode)&&['share','manualPrice','weightGrams'].every(k=>draft(r[k]))&&s.sizes.some(x=>x.id===r.sizeId)&&s.materials.some(m=>m.id===r.materialId&&m.weightRules.some(q=>q.id===r.ruleId)))))return false;
      for(const shop of s.shops){
        if(!unique(shop.plans)||!shop.plans.every(p=>typeof p.name==='string'&&p.name.trim()&&typeof p.deleted==='boolean')||!((shop.activePlanId===''&&!shop.plans.some(p=>!p.deleted)&&shop.rows.length===0)||shop.plans.some(p=>p.id===shop.activePlanId&&!p.deleted)))return false;
        for(const p of shop.plans){if(!unique(p.rows)||!p.params||!s.materials.some(m=>m.id===p.materialId&&m.weightRules.some(r=>r.id===p.ruleId))||!s.shippingTemplates.some(t=>t.id===p.shippingId)||p.strategyId&&!s.strategies.some(t=>t.id===p.strategyId)||!Object.keys(M.defaults).every(k=>draft(p.params[k]))||!p.params.refundRates||!['unshipped','shippedOnly','returnRefund','firstHour'].every(k=>draft(p.params.refundRates[k]))||!p.rows.every(r=>['auto','manual'].includes(r.priceMode)&&['share','manualPrice','weightGrams'].every(k=>draft(r[k]))&&s.sizes.some(x=>x.id===r.sizeId)&&s.materials.some(m=>m.id===r.materialId&&m.weightRules.some(q=>q.id===r.ruleId))))return false;}
      }
      if(s.product!==null){if(!s.product||!unique(s.product.rows)||!s.product.rows.length||s.product.thicknessPolicy&&!['auto','default','manual'].includes(s.product.thicknessPolicy.mode)||!s.product.rows.every(r=>Array.isArray(r.values)&&r.values.length===29&&typeof r.originalName==='string'&&typeof r.originalSpec==='string'&&Array.isArray(r.candidates)&&Array.isArray(r.dimensionCandidates)&&(r.thicknessCandidates===undefined||Array.isArray(r.thicknessCandidates))&&statuses.includes(r.materialStatus)&&statuses.includes(r.dimensionStatus)&&(r.materialStatus!=='value'||s.materials.some(m=>m.name===r.material))&&(r.dimensionStatus!=='value'||r.dimensions&&positive(r.dimensions.width)&&positive(r.dimensions.length))))return false;}
      if(!unique(s.records))return false;
      for(const record of s.records){
        if(depth||!M.validDate(record.date)||typeof record.voided!=='boolean'||!record.snapshot||record.snapshot.records?.length||!validState(record.snapshot,depth+1)||!s.shops.some(x=>x.id===record.shopId))return false;
        const actual=calculate(record.snapshot,record.shopId);if(!actual.valid||actual.profit===null)return false;
        if(!['gmv','profit','investment','price','cost','roi'].every(k=>actual[k]===record.result?.[k]||Number.isFinite(actual[k])&&Number.isFinite(record.result?.[k])&&Math.abs(actual[k]-record.result[k])<1e-7))return false;
      }
      return true;
    }catch{return false;}
  }
  const api={savePromotionScheme,selectPromotionScheme,migrate,syncPlan,switchPlan,createPlan,deletePlan,restorePlan,VERSION,KEY,columns,modes,seed,calculate,target,strategyErrors,saveStrategy,saveSizeScheme,applySizeScheme,deleteReusable,restoreReusable,switchStrategy,normalizeShares,makeRecord,validState,clone,id};
  if(typeof module==='object')module.exports=api;else root.ReviewModel=api;
})(typeof window==='object'?window:{});
