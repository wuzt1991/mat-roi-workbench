'use strict';
(function(root) {
  const Legacy=typeof module==='object'?require('./legacy-domain.js'):root.LegacyMatModel;
  const V3=typeof module==='object'?require('./domain-v3.js'):root.MatModelV3;
  const Pricing=typeof module==='object'?require('./pricing-rules.js'):root.PricingRules;
  const Promotions=typeof module==='object'?require('./promotion-rules.js'):root.PromotionRules;
  const clone=v=>structuredClone(v),uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),today=()=>new Date().toLocaleDateString('sv-SE');
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
  const positive=v=>number(v)&&v>0,nonnegative=v=>number(v)&&v>=0,draft=v=>v===''||number(v);
  const near=(a,b)=>a===null&&b===null||Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(b));
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const ceilRoi=v=>Number.isFinite(v)?Math.ceil(v*100-1e-9)/100:null;
  const defaults={refund:10,fee:5,tax:2,recovery:0,other:0,returnCost:0,spend:'',actualRoi:''};
  const defaultRefundRates={unshipped:0,shippedOnly:0,returnRefund:10,firstHour:''};
  const metricList=[{id:'roi',label:'整体支付 ROI 保本线'},{id:'netRoi',label:'净 ROI'},{id:'profit',label:'预估盈亏'},{id:'cost',label:'平均每单成本'},{id:'price',label:'平均售价'},{id:'margin',label:'每单可投广告费'},{id:'gmv',label:'整体成交金额'},{id:'investment',label:'总投入'},{id:'rate',label:'每百元结余'}];
  const skuColumnList=[{id:'grossMargin',label:'毛利率',unit:'%'},{id:'sales',label:'销售数量'},{id:'price',label:'售价',unit:'元'},{id:'share',label:'订单占比',unit:'%'},{id:'weight',label:'发货重量',unit:'g'},{id:'material',label:'材料成本'},{id:'shipping',label:'运费'},{id:'cost',label:'每单总成本'},{id:'roi',label:'保本 ROI'}];
  const defaultSkuColumns=['price','share','material','cost','roi'];
  const BUILTIN_MATERIALS=[
    ['硅藻泥',[[2.7,'',.83,9.3,false],[3,'',.9,9.5,true],[5,'',1.3,11.2,false]]],
    ['亚麻',[[3.5,'',.96,15,false],[5,'',1.26,16.2,true]]],
    ['水晶绒',[['','',.65,8,true],['','包边',.7,9,false]]],
    ['丝圈',[['', '',2.8,21,true]]],['皮革',[[3.5,'',1.3,15,true]]],
    ['仿羊绒',[['','',1.45,17,true]]],['冰藤',[[4.15,'',1.2,18,true]]],
    ['冰丝',[[3.36,'',.95,17,true],[3.36,'带绑带',.95,19,false]]],
    ['冰丝水洗底',[[1.9,'',1,18,true],[1.9,'绑带',1,19,false]]],
    ['菠萝圈',[['','',1.25,19.5,true]]],['天鹅绒',[['','',.85,12.5,true]]],
    ['金钻绒',[['','',.8,11.5,true]]],['圈绒',[[8,'',2.6,18.5,true]]]
  ];
  const materialNameKey=name=>String(name??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
  function duplicateMaterialName(materials){const seen=new Set();for(const m of materials){const key=materialNameKey(m.name);if(seen.has(key))return m.name;seen.add(key);}return '';}
  const safeId=v=>String(v??'').split('').map(ch=>/[A-Za-z0-9_.-]/.test(ch)?ch:ch.codePointAt(0).toString(16)).join('')||'base';
  const ruleId=(name,thickness='',variant='')=>`rule-${safeId(name)}-${safeId(thickness||'base')}-${safeId(variant||'base')}`;
  const ruleKey=(thickness='',variant='')=>`${thickness??''}|${variant??''}`;
  function builtinRules(name){const row=BUILTIN_MATERIALS.find(x=>x[0]===name);return (row?.[1]||[]).map(([thickness,variant,coefficient,costPerSqm,isDefault])=>({id:ruleId(name,thickness,variant),thickness,variant,coefficient,costPerSqm,default:!!isDefault}));}
  function normalizeMaterial(material){
    const m=clone(material||{});const parseThickness=v=>{if(v===''||v===undefined||v===null)return '';if(typeof v==='number')return v;const n=Number(String(v).replace(/毫米|mm/ig,'').trim());return Number.isFinite(n)?n:v;};
    m.weightRules=Array.isArray(m.weightRules)&&m.weightRules.length?m.weightRules.map((r,i)=>({...r,id:/^[a-zA-Z0-9_.-]{1,100}$/.test(r.id||'')?r.id:ruleId(m.name,r.thickness,r.variant)||`rule-${m.id}-${i}`,thickness:parseThickness(r.thickness),variant:r.variant??'',coefficient:Number(r.coefficient??r.weightPerSqm),costPerSqm:r.costPerSqm===undefined||r.costPerSqm===''?Number(m.price):Number(r.costPerSqm),default:!!r.default,deleted:!!r.deleted})):builtinRules(m.name);
    const seen=new Set();m.weightRules=m.weightRules.filter(r=>Number.isFinite(Number(r.coefficient))&&Number(r.coefficient)>=0&&!seen.has(ruleKey(r.thickness,r.variant))&&(seen.add(ruleKey(r.thickness,r.variant)),true));
    if(!m.weightRules.some(r=>r.default&&!r.deleted)&&m.weightRules[0])m.weightRules[0].default=true;
    return m;
  }
  const usableMaterialRule=r=>r&&!r.variant&&r.coefficient!==''&&r.costPerSqm!==''&&Number.isFinite(Number(r.coefficient))&&Number(r.coefficient)>=0&&Number.isFinite(Number(r.costPerSqm))&&Number(r.costPerSqm)>=0;
  function materialRule(material,plan){const all=material?.weightRules||[];if(plan?.materialRuleId)return all.find(r=>r.id===plan.materialRuleId)||null;return all.find(r=>!r.deleted&&!r.variant&&r.default)||null;}
  function normalizeParams(input={}) {
    const p={...defaults,...clone(input||{})},hasRates=Object.prototype.hasOwnProperty.call(input||{},'refundRates');
    const source=hasRates&&input.refundRates&&typeof input.refundRates==='object'?input.refundRates:{};
    // An explicitly supplied rates object is user configuration. Keep missing
    // core rates blank so validation can block a silent zero assumption. The
    // optional first-hour rate remains blank when omitted.
    p.refundRates=hasRates&&input.refundRates&&typeof input.refundRates==='object'&&!Array.isArray(input.refundRates)?{unshipped:source.unshipped??'',shippedOnly:source.shippedOnly??'',returnRefund:source.returnRefund??'',firstHour:source.firstHour??''}:hasRates?input.refundRates:{...defaultRefundRates,returnRefund:input?.refund??defaultRefundRates.returnRefund};
    if(!hasRates&&p.refundRates.returnRefund==='')p.refundRates.returnRefund='';
    // A missing scope is an old-plan shape regardless of whether a partial
    // refundRates object is present. New plans write `shipped` explicitly.
    if(!Object.prototype.hasOwnProperty.call(input||{},'otherFeeScope'))p.otherFeeScope='all';
    return p;
  }
  function refundMetrics(params={}) {
    const p=normalizeParams(params),rates=p.refundRates&&typeof p.refundRates==='object'&&!Array.isArray(p.refundRates)?p.refundRates:{};
    const value=k=>Number.isFinite(Number(rates[k]))?Number(rates[k]):NaN;
    const unshipped=value('unshipped'),shippedOnly=value('shippedOnly'),returnRefund=value('returnRefund'),firstHour=rates.firstHour===''?'':value('firstHour');
    const refundTotal=unshipped+shippedOnly+returnRefund;
    return {unshipped,shippedOnly,returnRefund,firstHour,firstHourValue:firstHour===''?0:firstHour,refundTotal,shippedRefund:shippedOnly+returnRefund,paidRatio:1-refundTotal/100,shippedRatio:1-unshipped/100,otherFeeScope:p.otherFeeScope};
  }
  function finalizeState(s){return s;}
  const ZTO_REGIONAL_RATES={
    '天津':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:.9},'北京':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.4},'河北省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:.9},'山东省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.1},'江苏省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.5},'浙江省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.5},'上海':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},'安徽省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.5},'山西省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.5},'河南省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.5},'湖北省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},'湖南省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},'江西省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},'广东省':{zone:'一区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},
    '吉林省':{zone:'二区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},'辽宁省':{zone:'二区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:1.7},'黑龙江省':{zone:'二区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:2.1},'陕西省':{zone:'二区',bands:[1.45,1.53,1.85,3.12,4.17,6.8,7.7],extra:2.1},'福建省':{zone:'二区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.1},'四川省':{zone:'二区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.1},'重庆':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.1},'广西壮族自治区':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4},'甘肃省':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4},'宁夏回族自治区':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4},'云南省':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4},'贵州省':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4},'内蒙古自治区':{zone:'三区',bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4},
    '海南省':{zone:'四区',first:8,extra:5},'青海省':{zone:'四区',first:8,extra:6},'新疆维吾尔自治区':{zone:'四区',first:18,extra:16},'西藏自治区':{zone:'四区',first:20,extra:18}
  };
  const regionalShippingTemplate=()=>({id:'shipping-zto-regional',name:'中通区域运费（不含面单费）',type:'regional',provider:'中通',rates:clone(ZTO_REGIONAL_RATES),active:true,ignoreWaybillFee:true});
  const REGULAR_SHIPPING_RATES={bands:[1.45,1.65,1.95,3.12,4.17,6.8,7.7],extra:2.4,remoteExcluded:true};
  // Shared fixed weight coefficients. A manual item weight remains an explicit override.
  const fixedWeightRules=[['包边水晶绒',.7],['水晶绒',.65],['硅藻泥 2.7',.83],['硅藻泥 5',1.3],['硅藻泥',.9],['亚麻 3.5',.96],['亚麻',1.26],['丝圈',2.8],['皮革',1.3],['仿羊绒',1.45],['冰丝水洗底',1],['冰藤',1.2],['冰丝',.95],['菠萝圈',1.25],['天鹅绒',.85],['金钻绒',.8],['圈绒',2.6]];
  function derivedWeight(size,material,item={},allowAliases=false) {
    if(item.weight!==''&&item.weight!==undefined&&item.weight!==null)return item.weight;
    const area=productionArea(size);if(!Number.isFinite(area))return '';
    const configured=item.materialRule?.coefficient ?? material?.weightRule?.coefficient ?? material?.weightCoefficient;
    if(Number.isFinite(Number(configured))&&Number(configured)>=0)return area*Number(configured)+(item.packagingWeight??0);
    const source=`${material?.name||''} ${material?.description||''} ${size?.name||''}`;
    const compactName=String(material?.name||'').replace(/[\s\u3000]/g,'');
    const compactSource=source.replace(/[\s\u3000]/g,'');
    const thicknessMatch=compactSource.match(/(\d+(?:\.\d+)?)(?:mm|毫米)/i);
    const thickness=thicknessMatch?Number(thicknessMatch[1]):null;
    const matchesMaterial=(key)=>{
      const compactKey=key.replace(/[\s\u3000]/g,'');
      if (compactKey==='包边水晶绒') return compactSource.includes(compactKey) || (compactName==='水晶绒'&&compactSource.includes('包边'));
      if(compactName===compactKey)return true;
      if(compactName.startsWith(compactKey)){
        const suffix=compactName.slice(compactKey.length);
        return /^(?:\d+(?:\.\d+)?(?:mm|毫米)?|包边)$/.test(suffix);
      }
      return false;
    };
    const specific=fixedWeightRules.find(([key])=>{
      if(!/\d/.test(key)||thickness===null)return false;
      const base=key.replace(/\s*\d+(?:\.\d+)?(?:mm|毫米)?/i,'').replace(/[\s\u3000]/g,'');
      const materialMatches=matchesMaterial(key)||compactName===base||(compactName.startsWith(base)&&/^(?:包边|\d)/.test(compactName.slice(base.length)));
      return materialMatches&&Math.abs(Number(key.match(/\d+(?:\.\d+)?/)[0])-thickness)<0.011;
    });
    const rule=specific||fixedWeightRules.find(([key])=>matchesMaterial(key)&&!/\d/.test(key))|| (allowAliases&&compactName.includes('硅藻泥')?fixedWeightRules.find(([key])=>key==='硅藻泥'):null);
    return rule?area*rule[1]+(item.packagingWeight??0):'';
  }
  const skuColumns=s=>[...(s.prefs?.skuColumns??defaultSkuColumns)];
  // Persisted weights and frozen records remain in kg; convert only at input/output boundaries.
  const toGrams=v=>typeof v==='number'&&Number.isFinite(v)?Number((v*1000).toPrecision(15)):v;
  const fromGrams=v=>typeof v==='number'&&Number.isFinite(v)?v/1000:v;
  const sizeLabel=s=>s.name||`${s.salesW||'—'} × ${s.salesH||'—'} cm`;
  function productionArea(s) {
    if(!s||s.needsReview)return NaN;
    const w=s.irregular?s.productionW:s.salesW,h=s.irregular?s.productionH:s.salesH;
    return positive(w)&&positive(h)?w*h/10000:NaN;
  }
  function validSize(s) {
    if(!s||typeof s.id!=='string'||typeof s.name!=='string'||s.name.length>80||typeof s.irregular!=='boolean'||typeof s.active!=='boolean')return false;
    if(s.needsReview)return [s.salesW,s.salesH,s.productionW,s.productionH].every(draft);
    return [s.salesW,s.salesH].every(v=>positive(v)&&v<=10000)&&(!s.irregular||[s.productionW,s.productionH].every(v=>positive(v)&&v<=10000));
  }
  function validTemplate(t) {
    if(!t||typeof t.name!=='string'||!t.name.trim()||t.name.length>80||typeof t.active!=='boolean')return false;
    if(t.type==='regional')return t.provider==='中通'&&t.rates&&typeof t.rates==='object';
    if(t.type==='fixed')return nonnegative(t.fee);
    if(t.type==='tiers')return Array.isArray(t.tiers)&&t.tiers.length>0&&t.tiers.length<=50&&t.tiers.every((r,i)=>positive(r.upTo)&&r.upTo<=1000&&nonnegative(r.fee)&&(i===0||r.upTo>t.tiers[i-1].upTo));
    return t.type==='step'&&positive(t.firstWeight)&&nonnegative(t.firstFee)&&positive(t.stepWeight)&&nonnegative(t.stepFee)&&positive(t.maxWeight)&&t.maxWeight>=t.firstWeight&&t.maxWeight<=1000;
  }
  function shippingCost(t,weight,destination) {
    if(!validTemplate(t))return {value:null,error:'请选择有效的运费模板'};
    if(t.type==='regional'){
      if(!positive(weight)||weight>50)return {value:null,error:'请填写含包装的发货重量'};
      // New calculations omit destination and use the ordinary-province maximum table.
      // Keep legacy destination argument behavior for old API callers and backups.
      const rate=destination===undefined?REGULAR_SHIPPING_RATES:(t.rates?.[destination]||REGULAR_SHIPPING_RATES);
      if(rate.bands){const limits=[.3,.5,1,2,3,4,5];const i=limits.findIndex(limit=>weight<=limit+1e-10);return i>=0?{value:rate.bands[i]}:{value:Number((Math.ceil(weight)*((rate.extra??REGULAR_SHIPPING_RATES.extra))).toFixed(2))};}
      return {value:weight<=1?(rate.first??rate.bands?.[2]??1.95):(rate.first??1.95)+Math.max(0,Math.ceil(weight)-1)*(rate.extra??REGULAR_SHIPPING_RATES.extra)};
    }
    if(t.type==='fixed')return {value:t.fee};
    if(!positive(weight)||weight>1000)return {value:null,error:'请填写含包装的发货重量'};
    if(t.type==='tiers'){const row=t.tiers.find(r=>weight<=r.upTo+1e-10);return row?{value:row.fee}:{value:null,error:'发货重量超出模板范围'};}
    if(weight>t.maxWeight+1e-10)return {value:null,error:'发货重量超出模板范围'};
    return {value:t.firstFee+Math.max(0,Math.ceil((weight-t.firstWeight)/t.stepWeight-1e-9))*t.stepFee};
  }

  function calculate(state,plan,overrides={}) {
    if(state.calculationVersion!==4&&state.version!==4)return V3.calculate(state,plan,overrides);
    const p=normalizeParams({...plan.params,...overrides}),mat=state.materials.find(m=>m.id===plan.materialId),rule=materialRule(mat,plan),template=state.shippingTemplates.find(t=>t.id===plan.shippingId),errors=[];
    if(!mat||!nonnegative(mat.price))errors.push('请选择材料并填写单价');
    if(rule&&!nonnegative(rule.costPerSqm))errors.push('请填写非负且有效的材料规则成本');

    if(plan.packagingWeight!==undefined&&(!nonnegative(plan.packagingWeight)||plan.packagingWeight>1000))errors.push('请填写 0 至 1,000,000 g 的固定包装重量');
    if(plan.needsMaterialReview)errors.push('请核对材料报价，旧规格曾使用厚度估算');
    if(!plan.items.length)errors.push('请添加规格、售价和订单占比');
    for(const k of ['fee','tax','recovery','other','returnCost'])if(!nonnegative(p[k])||(['fee','tax','recovery'].includes(k)&&p[k]>100))errors.push('请检查费用和比例');
    const summary=refundMetrics(p),rateValues=['unshipped','shippedOnly','returnRefund','firstHour'],rateSource=p.refundRates&&typeof p.refundRates==='object'&&!Array.isArray(p.refundRates)?p.refundRates:{};
    if(['unshipped','shippedOnly','returnRefund'].some(k=>!nonnegative(rateSource[k]))||rateSource.firstHour!==''&&!nonnegative(rateSource.firstHour))errors.push('请填写有效退款率');
    if(rateValues.some(k=>rateSource[k]!==''&&rateSource[k]>100))errors.push('请检查退款率');
    if(Number.isFinite(summary.refundTotal)&&summary.refundTotal>100+1e-9)errors.push('三类退款率合计不能超过 100%');
    if(Number.isFinite(summary.firstHour)&&Number.isFinite(summary.refundTotal)&&summary.firstHour>summary.refundTotal+1e-9)errors.push('1 小时内退款率不能超过三类退款率合计');
    if(!['shipped','all'].includes(p.otherFeeScope))errors.push('请设置其他费用发生范围');
    for(const k of ['spend','actualRoi'])if(p[k]!==''&&!nonnegative(p[k]))errors.push('请检查广告消耗和支付 ROI');
    const pricingRows=plan.items.map(item=>{
      const m=state.materials.find(x=>x.id===(item.materialId||plan.materialId)), r=materialRule(m,item.materialId?item:plan), size=state.sizes.find(x=>x.id===item.sizeId), area=productionArea(size), weight=derivedWeight(size,m,{...item,materialRule:r,packagingWeight:plan.packagingWeight??0},template?.type==='regional'),ship=shippingCost(template,weight), cost=area*(r?.costPerSqm??(m?.legacyCostFallback?m.price:NaN))+(ship.value??NaN);
      return {...item,size,area,pricingCost:cost,costError:!m||!r&&!m.legacyCostFallback||!Number.isFinite(cost)||ship.error};
    });
    const strategy=state.calculationVersion===4?null:state.pricingStrategies?.find(x=>x.id===plan.strategyId);
    if(plan.strategyId&&!strategy&&state.calculationVersion!==4)errors.push('定价策略不存在');
    const rows=plan.items.map((original,index)=>{
      const mat=state.materials.find(m=>m.id===(original.materialId||plan.materialId)),rule=materialRule(mat,original.materialId?original:plan),priced=Pricing.effectivePrice(original,strategy,pricingRows[index],pricingRows,p),item={...original,price:priced.price??''};
      if(priced.error)errors.push(priced.error);
      if(!mat||!rule&&!mat.legacyCostFallback)errors.push('请在可复用规则中配置材料厚度与成本');
      if((original.materialRuleId||(!original.materialId&&plan.materialRuleId))&&!rule)errors.push('所选材料厚度规则不存在');
      const size=state.sizes.find(s=>s.id===item.sizeId),area=productionArea(size),unitCost=rule?(nonnegative(rule.costPerSqm)?rule.costPerSqm:NaN):Number(mat?.price),material=area*unitCost,weight=derivedWeight(size,mat,{...item,materialRule:rule,packagingWeight:plan.packagingWeight??0},template?.type==='regional'),ship=shippingCost(template,weight);
      if(!validSize(size)||!Number.isFinite(area))errors.push('请补齐规格的销售尺寸和实际生产尺寸');
      if(!positive(item.price)||!nonnegative(item.share)||item.share>100)errors.push('请补齐售价和订单占比');
      if(ship.error)errors.push(`${size?sizeLabel(size):'规格'}：${ship.error}`);
      const {unshipped,shippedOnly,returnRefund,firstHour,firstHourValue,refundTotal,shippedRefund,paidRatio,shippedRatio}=summary;
      const revenue=item.price*paidRatio,netRevenue=item.price*(1-Math.max(0,refundTotal-firstHourValue)/100),goods=material*(paidRatio+shippedRefund/100*(1-p.recovery/100)),fees=revenue*p.fee/100,tax=revenue*p.tax/100,baseShipping=ship.value===null?NaN:ship.value,shipping=baseShipping*shippedRatio,otherBase=p.other*(p.otherFeeScope==='all'?1:shippedRatio),returnExtra=returnRefund/100*p.returnCost,other=otherBase+returnExtra,cost=goods+fees+tax+shipping+other,margin=revenue-cost,netMargin=netRevenue-cost;
      const marginRate=Pricing.actualMargin(material+baseShipping,item.price,p.fee,p.tax); return {...item,grossMargin:marginRate,marginRate,targetMargin:priced.targetMargin,priceError:priced.error||'',weight,size,area,material,baseShipping,shipping,revenue,netRevenue,goods,fees,tax,other,otherBase,returnExtra,refundTotal,unshipped,shippedOnly,returnRefund,firstHour,cost,margin,netMargin,roi:margin>0?item.price/margin:null,netRoi:netMargin>0?item.price/netMargin:null};
    });
    const total=plan.items.reduce((a,i)=>a+Number(i.share),0);
    if(Math.abs(total-100)>1e-6)errors.push('订单占比需合计 100%');
    const sum=k=>rows.reduce((a,i)=>a+Number(i.share)/100*i[k],0),price=sum('price'),margin=sum('margin'),netMargin=sum('netMargin'),cost=sum('cost');
    const forecast=nonnegative(p.spend)&&nonnegative(p.actualRoi),gmv=forecast?p.spend*p.actualRoi:null,orders=forecast&&price>0?gmv/price:null,investment=orders===null?null:p.spend+orders*cost,profit=orders===null?null:orders*margin-p.spend;
    if(![price,margin,cost].every(Number.isFinite)||forecast&&![gmv,investment,profit].every(Number.isFinite))errors.push('计算暂不可用，请检查输入');
    const valid=errors.length===0;
    return {valid,errors:[...new Set(errors)],rows,total,price,cost,margin,netMargin,refundTotal:summary.refundTotal,shippedRefund:summary.shippedRefund,refundRates:{unshipped:summary.unshipped,shippedOnly:summary.shippedOnly,returnRefund:summary.returnRefund,firstHour:summary.firstHour},otherFeeScope:p.otherFeeScope,roi:valid&&margin>0?price/margin:null,netRoi:valid&&netMargin>0?price/netMargin:null,rate:valid&&price>0?margin/price:null,gmv,profit:valid?profit:null,orders,investment:valid?investment:null,revenue:sum('revenue'),netRevenue:sum('netRevenue'),goods:sum('goods'),shipping:sum('shipping'),fees:sum('fees'),tax:sum('tax'),other:sum('other')};
  }
  function makeFrame(state,plan) {
    if(state.version!==4)return V3.makeFrame(state,plan);
    const {history,...values}=plan,result=calculate(state,plan),items=plan.items.map((item,i)=>({...item,price:result.rows[i].price,materialId:item.materialId||plan.materialId,materialRuleId:item.materialRuleId||plan.materialRuleId||''})),ids=new Set([plan.materialId,...items.map(i=>i.materialId)]);
    const materials=state.materials.filter(m=>ids.has(m.id)).map(m=>{const copy=clone(m),used=new Set(items.filter(i=>i.materialId===m.id).map(i=>i.materialRuleId).filter(Boolean));if(m.id===plan.materialId&&plan.materialRuleId)used.add(plan.materialRuleId);for(const rule of copy.weightRules||[])if(used.has(rule.id)&&Number.isFinite(Number(rule.costPerSqm))){copy.price=Number(rule.costPerSqm);break;}return copy;});
    return clone({calculationVersion:4,plan:{...values,params:normalizeParams(values.params),items},materials,sizes:state.sizes.filter(s=>items.some(i=>i.sizeId===s.id)),shippingTemplates:state.shippingTemplates.filter(t=>t.id===plan.shippingId),pricingStrategies:state.pricingStrategies.filter(x=>x.id===plan.strategyId),promotionSchemes:state.promotionSchemes.filter(x=>x.id===plan.promotionSchemeId)});
  }
  function frameMaterials(frame){const f=frame?.plan||{},items=f.items||[],out=[];for(const item of items){const id=item.materialId||f.materialId,rid=item.materialRuleId||f.materialRuleId||'',m=frame.materials?.find(x=>x.id===id),r=m?.weightRules?.find(x=>x.id===rid)||materialRule(m,f),ruleId=r?.id||'';if(m&&!out.some(x=>x.materialId===id&&x.ruleId===ruleId))out.push({materialId:id,ruleId,name:m.name,thickness:r?.thickness??'',costPerSqm:r?.costPerSqm??m.price});}return out;}
  function frameMaterialPrice(frame){const groups=frameMaterials(frame);if(groups.length===1)return groups[0].costPerSqm;return null;}
  function frameCostLabel(frame){const groups=frameMaterials(frame);return groups.length?groups.map(g=>`${g.name}${g.thickness!==''?` · ${g.thickness} mm`:''} ${Number(g.costPerSqm).toFixed(2)} 元/㎡`).join('；'):'—';}
  function setFrameMaterialPrice(frame,price){const groups=frameMaterials(frame);if(groups.length!==1||typeof price!=='number'||!Number.isFinite(price))return false;const g=groups[0],m=frame.materials.find(x=>x.id===g.materialId),r=m?.weightRules?.find(x=>x.id===g.ruleId);if(r)r.costPerSqm=price;if(m)m.price=price;return true;}
  function summarize(r){return Object.fromEntries(['price','cost','margin','netMargin','roi','netRoi','gmv','profit','investment','orders','revenue','netRevenue','goods','shipping','fees','tax','other'].map(k=>[k,r[k]]));}
  function confirmRecord(state,{frame,date,note='',previousId=null,reason=''}) {
    if(!validDate(date)||date>today())throw Error('请选择今天或过去的有效日期');
    const p=frame.plan; p.items=(p.items||[]).map((item,i)=>({...item,id:item.id||`item-v4-${i}`,productId:item.productId??'',skuId:item.skuId??'',sales:item.sales===undefined?null:item.sales,priceMode:item.priceMode||'plan'})); const live=state.plans.find(x=>x.id===p.id); if(live&&Array.isArray(live.items))live.items=live.items.map((orig,i)=>({...orig,id:orig.id||p.items[i]?.id||`item-v4-${i}`,productId:orig.productId??'',skuId:orig.skuId??'',sales:orig.sales===undefined?null:orig.sales,priceMode:orig.priceMode||'plan'})); const r=calculate(frame,p),previous=state.records.find(h=>h.id===previousId);
    if(!r.valid||r.profit===null||r.gmv===null)throw Error(r.errors[0]||'请补齐当天广告消耗和支付 ROI');
    if(previousId&&(!previous||previous.status!=='confirmed'||previous.planId!==p.id))throw Error('该记录已更正或作废，请刷新后查看');
    if(previousId&&!reason.trim())throw Error('请填写更正原因');
    if(state.records.some(h=>h.kind==='daily'&&h.status==='confirmed'&&h.planId===p.id&&h.date===date&&h.id!==previousId))throw Error('这个计划当天已入账，请打开原记录进行更正');
    const plan=state.plans.find(x=>x.id===p.id),shop=state.shops.find(x=>x.id===p.shopId);
    if(!plan||!shop)throw Error('记录所属的店铺或计划不存在');
    const frozen=clone(frame);
    const h={id:uid('record'),kind:'daily',status:'confirmed',date,note,reason,previousId,planId:p.id,shopId:p.shopId,planName:plan.name,shopName:shop.name,createdAt:new Date().toISOString(),frame:frozen,result:summarize(r)};
    if(previous){previous.status='superseded';previous.replacedBy=h.id;}
    state.records.push(h);return h;
  }
  function ledger(state,{shopId='',planId='',from='',to='',includeOld=false}={}) {
    const rows=state.records.filter(h=>(!shopId||h.shopId===shopId)&&(!planId||h.planId===planId)&&(!from||h.date>=from)&&(!to||h.date<=to)&&(includeOld||h.kind==='daily'&&h.status==='confirmed')).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    const effective=rows.filter(h=>h.kind==='daily'&&h.status==='confirmed');
    return {rows,count:effective.length,profit:effective.reduce((a,h)=>a+h.result.profit,0),spend:effective.reduce((a,h)=>a+(h.frame?.plan.params.spend??h.legacy?.spend??0),0),gmv:effective.reduce((a,h)=>a+h.result.gmv,0)};
  }
  const selectable=x=>!!x&&x.active!==false&&!x.deleted;
  function newPlan(state,shopId,name){
    name=validName(name);if(!state.shops.some(x=>x.id===shopId))throw Error('店铺不存在');
    const material=state.materials.find(m=>selectable(m)&&(m.weightRules||[]).some(r=>selectable(r)&&usableMaterialRule(r))),rule=material?.weightRules.find(r=>selectable(r)&&usableMaterialRule(r)&&r.default)||material?.weightRules.find(r=>selectable(r)&&usableMaterialRule(r)),shipping=state.shippingTemplates.find(selectable);
    if(!material||!rule||!shipping)throw Error('请先在可复用规则中添加或恢复材料厚度和运费');
    return {id:uid('plan'),shopId,name,note:'',materialId:material.id,materialRuleId:rule.id,shippingId:shipping.id,strategyId:'',promotionSchemeId:'',salesSource:null,params:{...defaults,refundRates:{...defaultRefundRates},otherFeeScope:'shipped'},items:[],deleted:false};
  }
  function validName(value,optional=false){if(typeof value!=='string'||value.trim().length>(80)||(!optional&&!value.trim()))throw Error('名称需为 1–80 个字符');return value.trim();}
  function legacyToV3(input){
    if(input.version===1&&input.plans?.some(p=>p.history?.length))throw Error('旧版历史不能无损解释，请保留原件');
    const old=Legacy.migrate(input);if(!Legacy.validateBackup(old))throw Error('旧备份未通过检查，原数据保留');
    const shop={id:'shop-original',name:'我的店铺',deleted:false};
    const s={version:3,shops:[shop],activeShop:shop.id,active:old.active,materials:old.materials.map(m=>({id:m.id,name:m.name,price:Number(m.price),description:m.baseThickness?`${m.baseThickness} mm`:'',active:m.active,history:m.history.map((h,i)=>({id:`quote-${m.id}-${i}`,date:h.date||'',price:Number(h.price),note:h.note||''}))})),sizes:old.sizes.map(x=>({id:x.id,name:x.name||'',salesW:x.w??'',salesH:x.h??'',irregular:x.shape==='irregular',productionW:'',productionH:'',active:x.active,needsReview:x.shape==='irregular',legacySize:clone(x)})),shippingTemplates:[],plans:[],records:[],prefs:{ids:(old.prefs?.ids||['roi','profit']).filter(id=>metricList.some(m=>m.id===id))}};
    if(!s.prefs.ids.length)s.prefs.ids=['roi','profit'];
    old.plans.forEach((p,index)=>{
      const fee=Number(p.params.shipping),existing=s.shippingTemplates.find(t=>t.fee===fee),template=existing||{id:`shipping-legacy-${index}`,name:`固定运费 ${fee} 元`,type:'fixed',fee,active:true};if(!existing)s.shippingTemplates.push(template);
      const params=normalizeParams(p.params);delete params.shipping;
      s.plans.push({id:p.id,shopId:shop.id,name:p.name,note:p.note||'',materialId:p.materialId,shippingId:template.id,params,items:p.items.map(i=>({...i,weight:''})),deleted:!!p.archived,needsMaterialReview:p.items.some(i=>old.sizes.find(x=>x.id===i.sizeId)?.thickness!=null)});
      p.history.forEach(h=>s.records.push({id:h.id,kind:h.kind,status:h.voided?'void':'confirmed',date:h.date,note:h.label||'',createdAt:h.recordedAt||h.date+'T00:00:00Z',planId:p.id,shopId:shop.id,planName:p.name,shopName:shop.name,legacy:clone(h),result:{profit:h.profit,roi:h.roi,price:h.price,gmv:h.gmv??0,cost:h.cost??null}}));
    });return s;
  }
  function migrate(input){
    if(!input||![1,2,3,4].includes(input.version))throw Error('不支持此工作区版本');
    if(input.version===4&&validateBackup(input))return clone(input);
    const source=input.version===3?clone(input):input.version===4?(()=>{const v=clone(input);v.version=3;for(const p of v.plans||[]){p.params=normalizeParams(p.params);delete p.strategyId;delete p.promotionSchemeId;delete p.salesSource;}return v;})():legacyToV3(input);
    if(!V3.validateBackup(source)||!validRecordResults(source))throw Error('旧备份未通过检查，原数据保留');
    const s=clone(source),maps=new Map();s.version=4;s.pricingStrategies=[];s.sizeSchemes=[];s.promotionSchemes=[];
    for(const key of ['materials','sizes','shippingTemplates'])for(const value of s[key])value.deleted=false;
    for(const m of s.materials){
      const rules=m.weightRules||[],ids=new Set();if(rules.some(r=>typeof r.id!=='string'||!r.id||ids.has(r.id)||(ids.add(r.id),false)))throw Error('厚度规则编号为空或重复');
      const map=new Map(),used=new Set(rules.filter(r=>/^[A-Za-z0-9_.-]{1,100}$/.test(r.id)).map(r=>r.id));let seenDefault=false;
      rules.forEach((r,index)=>{let next=r.id;if(!/^[A-Za-z0-9_.-]{1,100}$/.test(next)){next=`rule-v3-${index}`;while(used.has(next))next+='-x';used.add(next);}map.set(r.id,next);r.id=next;r.deleted=false;if(r.default){if(seenDefault)r.default=false;seenDefault=true;}});m.weightRules=rules;if(!rules.length)m.legacyCostFallback=true;maps.set(m.id,map);
    }
    s.plans.forEach((p,index)=>{const old=source.plans[index],oldMat=source.materials.find(m=>m.id===p.materialId),rule=V3.materialRule(oldMat,old);p.params=normalizeParams(p.params);if(rule)p.materialRuleId=maps.get(p.materialId).get(rule.id);else delete p.materialRuleId;p.strategyId='';p.promotionSchemeId='';p.salesSource=null;delete p.sizeSchemeId;p.items=p.items.map((i,n)=>{const next={...i,id:`item-v3-${n}`,productId:'',skuId:'',sales:null,priceMode:'plan'};delete next.materialId;delete next.materialRuleId;return next;});});
    return s;
  }
  function initialState(){return migrate(V3.initialState());}
  function seed(){const s=migrate(V3.seed());return s;}
  function validRecordResults(s){return s.records.every(h=>!h.frame||['price','cost','margin','netMargin','roi','netRoi','gmv','profit','investment','orders','revenue','netRevenue','goods','shipping','fees','tax','other'].every(k=>Object.prototype.hasOwnProperty.call(h.result||{},k)));}
  function validateBackup(s){
    try{
      if(s?.version===3)return V3.validateBackup(s)&&validRecordResults(s);
      const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v),ruleId=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v),text=(v,max=10000)=>typeof v==='string'&&v.length<=max,name=(v,max=10000)=>text(v,max)&&!!v.trim(),unique=a=>Array.isArray(a)&&a.length<=20000&&a.every(x=>x&&id(x.id))&&new Set(a.map(x=>x.id)).size===a.length,field=v=>v===''||nonnegative(v),deleted=v=>typeof v.deleted==='boolean';
      if(!s||s.version!==4||!['shops','plans','materials','sizes','shippingTemplates','records','pricingStrategies','sizeSchemes','promotionSchemes'].every(k=>unique(s[k]))||!s.shops.length||!validRecordResults(s))return false;
      const sameNames=list=>new Set(list.filter(x=>!x.deleted).map(x=>materialNameKey(x.name))).size===list.filter(x=>!x.deleted).length;
      if(s.shops.some(x=>!name(x.name)||!deleted(x))||!sameNames(s.materials))return false;
      for(const m of s.materials){if(!name(m.name)||!nonnegative(m.price)||typeof m.active!=='boolean'||!deleted(m)||!Array.isArray(m.history)||m.history.some(h=>!nonnegative(h.price)||!text(h.date)||!text(h.note))||!Array.isArray(m.weightRules)||m.weightRules.length>100)return false;const ids=new Set(),keys=new Set();for(const r of m.weightRules){const key=`${r.thickness}|${r.variant}`;if(!ruleId(r.id)||ids.has(r.id)||!text(r.variant)||!(r.thickness===''||positive(r.thickness)&&r.thickness<=10000)||!nonnegative(r.coefficient)||!nonnegative(r.costPerSqm)||typeof r.default!=='boolean'||!deleted(r)||!r.deleted&&keys.has(key))return false;ids.add(r.id);if(!r.deleted)keys.add(key);}if(m.weightRules.filter(r=>!r.deleted&&r.default).length>1)return false;}
      if(s.sizes.some(x=>!validSize(x)||!deleted(x))||s.shippingTemplates.some(t=>!validTemplate(t)||!deleted(t)))return false;
      for(const key of ['pricingStrategies','sizeSchemes','promotionSchemes'])if(!sameNames(s[key])||s[key].some(x=>!name(x.name,80)||!deleted(x)||x.active!==undefined&&typeof x.active!=='boolean'))return false;
      if(s.pricingStrategies.some(x=>Pricing.errors(x).length)||s.promotionSchemes.some(x=>Promotions.errors(x).length)||s.sizeSchemes.some(x=>!Array.isArray(x.sizeIds)||x.sizeIds.length>5000||new Set(x.sizeIds).size!==x.sizeIds.length||x.sizeIds.some(id=>!s.sizes.some(v=>v.id===id))))return false;
      const paramsValid=p=>{if(!p||!Object.keys(defaults).every(k=>field(p[k]))||['fee','tax','recovery'].some(k=>p[k]!==''&&p[k]>100)||!['all','shipped'].includes(p.otherFeeScope))return false;const rates=p.refundRates;if(!rates||typeof rates!=='object'||Array.isArray(rates)||!['unshipped','shippedOnly','returnRefund','firstHour'].every(k=>field(rates[k])&&(rates[k]===''||rates[k]<=100)))return false;const total=['unshipped','shippedOnly','returnRefund'].reduce((a,k)=>a+Number(rates[k]),0);return total<=100+1e-9&&(rates.firstHour===''||['unshipped','shippedOnly','returnRefund'].some(k=>rates[k]==='')||rates.firstHour<=total+1e-9);};
      for(const p of s.plans){
        const mat=s.materials.find(x=>x.id===p.materialId);if(!name(p.name)||!deleted(p)||!s.shops.some(x=>x.id===p.shopId)||!mat||p.materialRuleId&&!mat.weightRules.some(r=>r.id===p.materialRuleId)||!s.shippingTemplates.some(x=>x.id===p.shippingId)||p.packagingWeight!==undefined&&(!nonnegative(p.packagingWeight)||p.packagingWeight>1000)||!paramsValid(p.params)||!Array.isArray(p.items)||!unique(p.items)||typeof p.strategyId!=='string'||p.strategyId&&!s.pricingStrategies.some(x=>x.id===p.strategyId)||typeof p.promotionSchemeId!=='string'||p.promotionSchemeId&&!s.promotionSchemes.some(x=>x.id===p.promotionSchemeId))return false;
        const identities=new Set();for(const i of p.items){if(!s.sizes.some(x=>x.id===i.sizeId)||!['price','share','weight'].every(k=>field(i[k]))||i.share!==''&&i.share>100||!['manual','plan'].includes(i.priceMode)||!text(i.productId,200)||i.productId!==i.productId.trim()||!text(i.skuId,200)||i.skuId!==i.skuId.trim()||!(i.sales===null||Number.isSafeInteger(i.sales)&&i.sales>=0&&i.sales<=1e12))return false;if(i.materialId||i.materialRuleId){const m=s.materials.find(x=>x.id===i.materialId);if(!m||!i.materialRuleId||!m.weightRules.some(r=>r.id===i.materialRuleId))return false;}if(i.productId&&i.skuId){const key=JSON.stringify([i.productId,i.skuId]);if(identities.has(key))return false;identities.add(key);}}
        if(p.salesSource!==null){const x=p.salesSource;if(!x||!text(x.filename,255)||!name(x.period,200)||!['orders','units'].includes(x.basis)||!Number.isSafeInteger(x.total)||x.total<0||x.total>1e12||!Number.isSafeInteger(x.excluded)||x.excluded<0||!id(x.importId)||!text(x.appliedAt,100)||!['zero','complete'].includes(x.missingPolicy)||typeof x.editedAfterImport!=='boolean')return false;}
      }
      const dates=new Set();for(const h of s.records){
        if(!validDate(h.date)||!['confirmed','superseded','void'].includes(h.status)||!['daily','snapshot'].includes(h.kind)||!text(h.createdAt)||!text(h.note)||!s.plans.some(p=>p.id===h.planId&&p.shopId===h.shopId)||!s.shops.some(x=>x.id===h.shopId)||!h.result)return false;
        if(h.legacy&&h.legacy.kind!==h.kind||h.kind==='snapshot'&&(!h.legacy||h.frame))return false;
        if(h.kind==='daily'){if(!Number.isFinite(h.result.profit)||!nonnegative(h.result.gmv))return false;
          if(h.frame){const f=h.frame,p=f.plan;if(p.id!==h.planId||p.shopId!==h.shopId||f.calculationVersion!==undefined&&f.calculationVersion!==4)return false;const r=calculate(f,p);if(!r.valid||Object.keys(summarize(r)).some(k=>!near(r[k],h.result[k])))return false;}
          else if(h.legacy){const l=h.legacy,mat={id:'frozen',name:l.materialName,price:l.materialPrice,baseThickness:l.materialBaseThickness,active:true,history:[]},frozen={version:2,materials:[mat],sizes:l.items.map(i=>({...i,id:i.sizeId,active:true})),plans:[{id:'frozen-plan',name:'历史校验',materialId:mat.id,params:l.params,items:l.items,history:[l]}]};if(!Legacy.validateBackup(frozen)||!['profit','gmv','roi','price'].every(k=>near(l[k],h.result[k]))||l.cost!==undefined&&!near(l.cost,h.result.cost))return false;}else return false;
          if(h.status==='confirmed'){const key=h.planId+'/'+h.date;if(dates.has(key))return false;dates.add(key);}}
        if(h.previousId&&!s.records.some(x=>x.id!==h.id&&x.id===h.previousId&&x.planId===h.planId&&x.kind===h.kind&&x.status==='superseded'&&x.replacedBy===h.id)||h.status==='superseded'&&!s.records.some(x=>x.id!==h.id&&x.id===h.replacedBy&&x.previousId===h.id)||h.status!=='superseded'&&h.replacedBy)return false;
      }
      const byId=new Map(s.records.map(h=>[h.id,h])),visited=new Set();for(const h of s.records){const chain=new Set();let node=h;while(node&&!visited.has(node.id)){if(chain.has(node.id))return false;chain.add(node.id);node=byId.get(node.previousId);}for(const id of chain)visited.add(id);}
      if(s.prefs?.skuColumns!==undefined&&(!Array.isArray(s.prefs.skuColumns)||new Set(s.prefs.skuColumns).size!==s.prefs.skuColumns.length||!s.prefs.skuColumns.every(id=>skuColumnList.some(x=>x.id===id))))return false;
      return s.prefs&&Array.isArray(s.prefs.ids)&&s.prefs.ids.length>=1&&s.prefs.ids.length<=4&&new Set(s.prefs.ids).size===s.prefs.ids.length&&s.prefs.ids.every(id=>metricList.some(x=>x.id===id));
    }catch{return false;}
  }
  const api={migrateWorkspace:migrate,validName,selectable,validRecordResults,clone,uid,today,number,draft,positive,nonnegative,validDate,ceilRoi,defaults,defaultRefundRates,metricList,skuColumnList,defaultSkuColumns,skuColumns,toGrams,fromGrams,sizeLabel,productionArea,derivedWeight,validSize,validTemplate,shippingCost,normalizeParams,refundMetrics,calculate,frameMaterialPrice,setFrameMaterialPrice,makeFrame,summarize,confirmRecord,ledger,newPlan,migrate,initialState,seed,validateBackup,regionalShippingTemplate,ZTO_REGIONAL_RATES,REGULAR_SHIPPING_RATES,BUILTIN_MATERIALS,materialNameKey,duplicateMaterialName,normalizeMaterial,materialRule,frameMaterials,frameCostLabel};
  if(typeof module==='object')module.exports=api;else root.MatModel=api;
})(typeof globalThis==='object'?globalThis:{});
