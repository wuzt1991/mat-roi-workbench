/* Ordered discounts and direct reductions; amounts use integer cents. */
(function(root){
  'use strict';
  const MAX_CENTS=100000000000;
  const scaled=(value,factor)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value*factor-Math.round(value*factor))<1e-5;
  const validPrice=(value,allowZero=false)=>scaled(value,100)&&value>=(allowZero?0:.01)&&value<=MAX_CENTS/100;
  function errors(scheme){
    const out=[];
    if(!scheme||typeof scheme.name!=='string'||!scheme.name.trim())out.push('请填写活动方案名称');
    if(!Array.isArray(scheme?.steps)||!scheme.steps.length)return [...out,'请至少添加一项活动'];
    if(scheme.steps.length>10)out.push('最多叠加 10 项活动');
    for(const step of scheme.steps){
      if(step?.type==='discount'){
        if(!scaled(step.discount,100)||step.discount<.01||step.discount>10)out.push('折扣需为 0.01–10 折，最多两位小数');
      }else if(step?.type==='reduction'){
        if(!scaled(step.amount,100)||step.amount<.01||step.amount>1000000)out.push('直减金额需为 0.01–1,000,000 元，最多两位小数');
      }else out.push('仅支持折扣和直减');
    }
    return [...new Set(out)];
  }
  function apply(cents,scheme){
    const steps=[];
    for(const step of scheme.steps){const before=cents;cents=step.type==='discount'?Math.floor((cents*Math.round(step.discount*100)+500)/1000):Math.max(0,cents-Math.round(step.amount*100));steps.push({type:step.type,before:before/100,after:cents/100,applied:true});}
    return {finalPrice:cents/100,steps};
  }
  function forward(listingPrice,scheme){
    if(!validPrice(listingPrice,true))return {error:'上架价需为有效金额，最多两位小数'};
    const invalid=errors(scheme);if(invalid.length)return {error:invalid.join('；')};
    const cents=Math.round(listingPrice*100);return {listingPrice:cents/100,...apply(cents,scheme)};
  }
  function reverse(targetPrice,scheme){
    if(!validPrice(targetPrice))return {error:'到手价需大于 0，最多两位小数'};
    const invalid=errors(scheme);if(invalid.length)return {error:invalid.join('；')};
    const targetCents=Math.round(targetPrice*100);let cents=targetCents;
    // Invert each rounded, monotone step to its smallest qualifying cent value.
    for(let i=scheme.steps.length-1;i>=0;i--){const step=scheme.steps[i];cents=step.type==='discount'?Math.ceil((cents*1000-500)/Math.round(step.discount*100)):cents+Math.round(step.amount*100);if(!Number.isSafeInteger(cents)||cents>MAX_CENTS)return {error:'活动叠加后的上架价过大，请调整活动方案'};}
    const result=apply(cents,scheme),actual=Math.round(result.finalPrice*100);
    if(actual<targetCents||cents>0&&Math.round(apply(cents-1,scheme).finalPrice*100)>=targetCents)return {error:'上架价核验失败，请调整活动方案'};
    return {listingPrice:cents/100,...result,exact:actual===targetCents,difference:(actual-targetCents)/100};
  }
  const api={errors,forward,reverse};
  if(typeof module==='object')module.exports=api;else root.ReviewPromotions=api;
})(typeof window==='object'?window:{});
