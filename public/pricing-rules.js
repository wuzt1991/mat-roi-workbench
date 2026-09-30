(function(root){
'use strict';
const MAX=1e12, finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=MAX;
function fraction(n){if(!finite(n))throw Error('无效数值');let s=String(n),sign=1n;if(s[0]==='-'){sign=-1n;s=s.slice(1);}const [raw,exp='0']=s.toLowerCase().split('e'),[whole,dec='']=raw.split('.'),power=Number(exp)-dec.length;return power>=0?{n:sign*BigInt(whole+dec)*10n**BigInt(power),d:1n}:{n:sign*BigInt(whole+dec),d:10n**BigInt(-power)};}
function decimal(n,places){try{const f=fraction(n);return (f.n*10n**BigInt(places))%f.d===0n;}catch{return false;}}
function areaFraction(size){const w=fraction(size.irregular?size.productionW:size.salesW),h=fraction(size.irregular?size.productionH:size.salesH);return {n:w.n*h.n,d:w.d*h.d*10000n};}
function baseCost(size,unitCost,shipping,template,weight){
  try{
    const a=areaFraction(size),u=fraction(unitCost);let ship=fraction(shipping);
    if(template?.type==='step'){
      const first=fraction(template.firstFee),step=fraction(template.stepFee),count=BigInt(Math.max(0,Math.ceil((weight-template.firstWeight)/template.stepWeight-1e-9)));
      ship={n:first.n*step.d+count*step.n*first.d,d:first.d*step.d};
    }
    return Number(a.n*u.n*ship.d+ship.n*a.d*u.d)/Number(a.d*u.d*ship.d);
  }catch{return NaN;}
}
function errors(s){const out=[],pct=n=>finite(n)&&n>=0&&decimal(n,4),area=n=>finite(n)&&n>0&&n<=10000&&decimal(n,6);if(!s||!['uniform','rank','area'].includes(s.type))return ['请选择有效定价策略类型'];if(s.type==='uniform'&&!pct(s.margin))out.push('毛利率需为非负数，最多四位小数，可超过 100%');if(s.type==='rank'&&(!Array.isArray(s.tiers)||!s.tiers.length||s.tiers.length>100||!s.tiers.every(pct)||!pct(s.fallback)))out.push('阶梯毛利需配置 1–100 档及有效后续毛利率');if(s.type==='area'&&(!area(s.baseArea)||!area(s.stepArea)||!pct(s.baseMargin)||!pct(s.cap)||s.cap<s.baseMargin||!finite(s.stepPoints)||s.stepPoints<0||!decimal(s.stepPoints,4)))out.push('请检查面积、递增百分点和毛利上限');return out;}
function target(s,row,rows){if(errors(s).length)throw Error(errors(s)[0]);if(s.type==='uniform')return s.margin;if(s.type==='rank'){if(rows.some(r=>!finite(r.pricingCost)||r.pricingCost<0||r.costError))throw Error('存在成本未确认的 SKU，阶梯策略暂停');const cents=rows.map(r=>{const f=fraction(r.pricingCost);return Number((f.n*100n+f.d/2n)/f.d);}),rankCents=[...new Set(cents)].sort((a,b)=>a-b),rowCents=Number((fraction(row.pricingCost).n*100n+fraction(row.pricingCost).d/2n)/fraction(row.pricingCost).d),i=rankCents.indexOf(rowCents);return s.tiers[i]??s.fallback;}const a=row.size?areaFraction(row.size):fraction(row.area),b=fraction(s.baseArea),step=fraction(s.stepArea),n=a.n*b.d-b.n*a.d;const count=n<=0n?0n:(n*step.d)/(a.d*b.d*step.n),base=fraction(s.baseMargin),inc=fraction(s.stepPoints),cap=fraction(s.cap),valueN=base.n*inc.d+count*inc.n*base.d,valueD=base.d*inc.d;if(valueN*cap.d>=cap.n*valueD)return s.cap;return Number(valueN)/Number(valueD);}
// Cost-based target: P = B * (1 + m) / (1 - (fee + tax) * (1 + m)).
// Percent inputs are divided by 100. Exact fractions ensure the smallest cent
// satisfying the target, including boundaries and targets above 100%.
function quote(cost,margin,fee=0,tax=0){
  if(![cost,margin,fee,tax].every(finite)||cost<=0||margin<0||fee<0||tax<0||fee>100||tax>100)return {price:null,error:cost===0?'零成本无法反推正售价，请手动输入':'成本、目标毛利或费率无效'};
  const c=fraction(cost),m=fraction(margin),f=fraction(fee),t=fraction(tax),growth=100n*m.d+m.n;
  const denominator=10000n*m.d*f.d*t.d-growth*(f.n*t.d+t.n*f.d);
  if(denominator<=0n)return {price:null,error:'目标毛利与平台费、税率组合无法定价，请降低目标或费率'};
  const numerator=c.n*growth*10000n*f.d*t.d,divisor=c.d*denominator;
  const cents=(numerator+divisor-1n)/divisor;
  if(cents>BigInt(MAX)*100n)return {price:null,error:'策略售价超出范围'};
  const price=Number(cents)/100;
  return {price,margin:actualMargin(cost,price,fee,tax),targetMargin:margin};
}
// Used only to validate the visible cells of backups exported before format 8.
function legacySalesQuote(cost,margin,fee=0,tax=0){const denominator=1-(margin+fee+tax)/100;if(![cost,margin,fee,tax].every(finite)||cost<=0||margin<0||margin>=100||fee<0||tax<0||denominator<=0)return {price:null,error:cost===0?'零成本无法反推正售价，请手动输入':'成本或毛利与费率组合不可定价'};const raw=cost/denominator;if(!finite(raw)||raw<=0)return {price:null,error:'策略售价超出范围'};let cents=Math.ceil(raw*100),price=cents/100;const meets=x=>x*denominator>=cost-Math.max(1,cost)*1e-12;if(cents>1&&meets((cents-1)/100))cents--;price=cents/100;if(!meets(price)){cents++;price=cents/100;}if(!finite(price)||price<=0||!meets(price))return {price:null,error:'策略售价核验失败'};return {price,margin:legacySalesMargin(cost,price,fee,tax),targetMargin:margin};}
function legacySalesMargin(cost,price,fee=0,tax=0){
  if(![cost,price,fee,tax].every(finite)||price<=0)return null;
  // Calculate the decimal ratio before converting back to Number. In particular,
  // 1000 - 5.05 - 7% must display 92.50%, not 92.49% from subtraction noise.
  const c=fraction(cost),p=fraction(price),f=fraction(fee),t=fraction(tax);
  const d=c.d*p.n*f.d*t.d;
  const n=100n*d-100n*c.n*p.d*f.d*t.d-f.n*c.d*p.n*t.d-t.n*c.d*p.n*f.d;
  return Number(n)/Number(d);
}
function costMarginDetails(cost,price,fee=0,tax=0){
  if(![cost,price,fee,tax].every(finite)||cost<0||price<=0||fee<0||tax<0)return {cost:null,profit:null,rate:null};
  const c=fraction(cost),p=fraction(price),f=fraction(fee),t=fraction(tax);
  const d=c.d*p.d*f.d*t.d*100n;
  const total=c.n*p.d*f.d*t.d*100n+p.n*c.d*(f.n*t.d+t.n*f.d);
  const profit=p.n*c.d*f.d*t.d*100n-total;
  return {cost:Number(total)/Number(d),profit:Number(profit)/Number(d),rate:total>0n?Number(profit*100n)/Number(total):null};
}
function actualMargin(cost,price,fee=0,tax=0){return costMarginDetails(cost,price,fee,tax).rate;}
function effectivePrice(item,strategy,row,rows,params={},legacyPricing=false,legacyCostValidation=false){if(item.priceMode==='manual'||!strategy)return {price:item.price,targetMargin:null};if(!legacyPricing&&!legacyCostValidation&&row.costError)return {price:null,error:'规格尺寸、材料或运费成本未确认，策略定价暂停'};try{return (legacyPricing?legacySalesQuote:quote)(row.pricingCost,target(strategy,row,rows),params.fee,params.tax);}catch(e){return {price:null,error:e.message};}}
const api={fraction,decimal,areaFraction,baseCost,errors,valid:s=>errors(s).length===0,target,quote,actualMargin,costMarginDetails,effectivePrice};if(typeof module==='object')module.exports=api;else root.PricingRules=api;
})(typeof globalThis==='object'?globalThis:{});
