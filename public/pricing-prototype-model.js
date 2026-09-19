'use strict';
(function(root) {
  const M=typeof module==='object'?require('./domain.js'):root.MatModel;
  const P=typeof module==='object'?require('./product-transfer.js'):root.MatProductTransfer;
  const clone=v=>structuredClone(v), id=p=>M.uid(p), finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
  const nonnegative=v=>finite(v)&&v>=0, positive=v=>finite(v)&&v>0, pct=v=>nonnegative(v)&&v<100;
  const modes={fixed:'固定毛利率',rank:'成本排名',area:'面积递增'};
  const rounds={cent:'向上到分',yuan:'向上到整数元',nine:'向上到 .9 元'};
  const today=M.today;
  function seed() {
    const legacy=M.initialState(),materials=legacy.materials.filter(m=>m.builtinKey!==undefined);
    const sizes=[[50,100],[65,100],[80,100],[100,100],[100,200],[150,200],[40,60],[50,80]].map(([w,h],i)=>({id:'size-'+i,name:'',salesW:w,salesH:h,irregular:false,productionW:'',productionH:'',active:true}));
    const strategies=[
      {id:'area',name:'面积递增 · 常规定价',mode:'area',baseArea:.5,baseMargin:10,stepArea:.1,stepPoints:1,cap:30,round:'cent',active:true},
      {id:'rank',name:'阶梯毛利 · 引流定价',mode:'rank',tiers:[10,20,30],fallback:40,round:'nine',active:true},
      {id:'fixed',name:'统一毛利 · 标准定价',mode:'fixed',margin:35,round:'cent',active:true}
    ];
    const ruleFor=name=>{const m=materials.find(x=>x.name===name);return {materialId:m.id,ruleId:m.weightRules.find(r=>r.default)?.id||m.weightRules[0].id};};
    const groups=[{id:'group-a',name:'常规地垫尺寸组',strategyId:'area'},{id:'group-b',name:'亚麻补充尺寸组',strategyId:'fixed'}];
    const rows=sizes.map((s,i)=>({id:'sku-'+i,sizeId:s.id,...ruleFor(i<6?'硅藻泥':'亚麻'),groupId:i<6?'group-a':'group-b',strategyId:'',priceMode:'auto',manualPrice:'',weightGrams:'',share:[20,15,15,15,10,5,10,10][i]}));
    const settings={...clone(M.defaults),refundRates:{...M.defaultRefundRates},otherFeeScope:'shipped',fee:5,tax:3,spend:100,actualRoi:4,packagingGrams:0,shippingId:'regular'};
    return {version:'pricing-prototype-1',revision:0,activeShop:'shop-a',shops:[{id:'shop-a',name:'地垫旗舰店',settings:clone(settings),groups,rows},{id:'shop-b',name:'地垫生活店',settings:clone(settings),groups:[],rows:[]}],materials,sizes,shippingTemplates:[{...M.regionalShippingTemplate(),id:'regular',name:'中通 · 普通省份常规价'},{id:'fixed-shipping',name:'固定运费 · 2 元',type:'fixed',fee:2,active:true}],strategies,records:[],archives:[],prefs:{margin:true}};
  }
  function strategyErrors(s) {
    const errors=[];
    if(!s||typeof s.name!=='string'||!s.name.trim()||s.name.length>80)return ['请填写 1–80 字的策略名称'];
    if(!modes[s.mode])errors.push('请选择定价模式');
    if(!rounds[s.round])errors.push('请选择取整规则');
    if(s.mode==='fixed'&&!pct(s.margin))errors.push('目标毛利率需为 0% 至不足 100%');
    if(s.mode==='area'){
      if(!positive(s.baseArea)||s.baseArea>10000)errors.push('基准面积需大于 0、不超过 10000㎡');
      if(!positive(s.stepArea)||s.stepArea>10000)errors.push('递增面积需大于 0、不超过 10000㎡');
      if(!pct(s.baseMargin)||!pct(s.cap)||s.cap<s.baseMargin)errors.push('上限不能低于基准毛利率，且均需低于 100%');
      if(!nonnegative(s.stepPoints)||s.stepPoints>100)errors.push('递增百分点需为 0–100');
    }
    if(s.mode==='rank'){
      if(!Array.isArray(s.tiers)||!s.tiers.length||s.tiers.length>20||!s.tiers.every(pct))errors.push('请设置 1–20 个有效毛利率档位');
      if(!pct(s.fallback))errors.push('其余档位毛利率需为 0% 至不足 100%');
    }
    return errors;
  }
  function target(s,area,rank=1) {
    if(strategyErrors(s).length||!positive(area))return null;
    if(s.mode==='fixed')return s.margin;
    if(s.mode==='area')return Math.min(s.cap,s.baseMargin+Math.max(0,area-s.baseArea)/s.stepArea*s.stepPoints);
    return Number.isInteger(rank)&&rank>0?(s.tiers[rank-1]??s.fallback):null;
  }
  function roundPrice(value,mode) {
    if(!positive(value)||!rounds[mode])return null;
    const nearCeil=v=>Math.ceil(v-Number.EPSILON*Math.max(1,Math.abs(v))*8);
    const result=mode==='cent'?nearCeil(value*100)/100:mode==='yuan'?nearCeil(value):nearCeil(value-.9)+.9;
    return positive(result)?Number(result.toFixed(2)):null;
  }
  function priceFor(cost,margin,fee,tax,round='cent') {
    if(!nonnegative(cost)||!pct(margin)||!pct(fee)||!pct(tax))return {price:null,error:'请填写有效成本、毛利率、扣点和税点'};
    if(margin+fee+tax>=100)return {price:null,error:'目标毛利率＋平台扣点＋税点必须小于 100%'};
    const raw=cost/(1-(margin+fee+tax)/100),price=roundPrice(raw,round);
    if(!positive(price))return {price:null,error:cost===0?'零成本无法反推正售价，请手动定价':'售价超出可计算范围'};
    return {price,raw,error:''};
  }
  function baseRow(state,shop,row) {
    const size=state.sizes.find(x=>x.id===row.sizeId),material=state.materials.find(x=>x.id===row.materialId),rule=material?.weightRules.find(x=>x.id===row.ruleId),group=shop.groups.find(x=>x.id===row.groupId),strategy=state.strategies.find(x=>x.id===(row.strategyId||group?.strategyId));
    const area=M.productionArea(size),errors=[];
    if(!M.validSize(size)||!positive(area))errors.push('请补全有效生产尺寸');
    if(!rule||!nonnegative(rule.costPerSqm)||!nonnegative(rule.coefficient))errors.push('缺少有效材料或厚度规则');
    if(!group)errors.push('规格组合不存在');
    if(!nonnegative(shop.settings.packagingGrams)||shop.settings.packagingGrams>1000000)errors.push('包装重量需为 0–1000000 g');
    if(row.weightGrams!==''&&(!positive(row.weightGrams)||row.weightGrams>1000000))errors.push('手动总重量需大于 0、不超过 1000000 g');
    const weight=row.weightGrams!==''?row.weightGrams/1000:area*(rule?.coefficient??NaN)+shop.settings.packagingGrams/1000;
    const ship=M.shippingCost(state.shippingTemplates.find(x=>x.id===shop.settings.shippingId),weight);
    if(ship.error)errors.push(ship.error);
    const materialCost=area*(rule?.costPerSqm??NaN),baseCost=materialCost+(ship.value??NaN);
    if(!nonnegative(baseCost))errors.push('成本无效或超出范围');
    if(!pct(shop.settings.fee)||!pct(shop.settings.tax)||shop.settings.fee+shop.settings.tax>=100)errors.push('平台扣点和税点需有效，合计小于 100%');
    return {...row,size,material,rule,group,strategy,area,weight,materialCost,shipping:ship.value,baseCost,errors};
  }
  const costKey=v=>Math.round(v*1e6);
  function calculate(state,shopId=state.activeShop) {
    const shop=state.shops.find(x=>x.id===shopId);if(!shop)throw Error('店铺不存在');
    const rows=shop.rows.map(r=>baseRow(state,shop,r));
    const ranks=new Map();
    shop.groups.forEach(g=>{const members=rows.filter(r=>r.groupId===g.id);ranks.set(g.id,members.some(r=>r.errors.length)?null:[...new Set(members.map(r=>costKey(r.baseCost)))].sort((a,b)=>a-b));});
    rows.forEach(row=>{
      const rankList=ranks.get(row.groupId);row.rank=rankList?rankList.indexOf(costKey(row.baseCost))+1:null;
      row.target=target(row.strategy,row.area,row.rank);
      row.tag=row.strategy?.mode==='area'?(row.target===row.strategy.cap?'已达上限':row.area<row.strategy.baseArea?'基准毛利':`面积 ${Number(row.area.toFixed(4))}㎡`):row.strategy?.mode==='rank'?`成本第 ${row.rank??'—'} 档`:'固定毛利';
      row.warnings=[];
      if(row.priceMode==='manual'){
        row.price=positive(row.manualPrice)?row.manualPrice:null;
        if(row.price===null)row.errors.push('请填写大于 0 的手动售价');
        if(!row.strategy||strategyErrors(row.strategy).length||row.target===null)row.warnings.push('策略暂不可用，手动售价保留');
      }else{
        if(!row.strategy)row.errors.push('请选择定价策略');
        else row.errors.push(...strategyErrors(row.strategy));
        if(row.strategy?.mode==='rank'&&!rankList)row.errors.push('组内有成本异常，排名定价暂停');
        const result=priceFor(row.baseCost,row.target,shop.settings.fee,shop.settings.tax,row.strategy?.round);
        row.price=row.errors.length?null:result.price;
        if(result.error)row.errors.push(result.error);
      }
      row.actualMargin=positive(row.price)&&nonnegative(row.baseCost)&&pct(shop.settings.fee)&&pct(shop.settings.tax)?(1-row.baseCost/row.price-(shop.settings.fee+shop.settings.tax)/100)*100:null;
      if(finite(row.actualMargin)&&finite(row.target)&&row.actualMargin<row.target-1e-8)row.warnings.push('低于目标毛利率');
      if(row.strategy&&!row.strategy.active)row.warnings.push('沿用已停用策略');
      if(row.material&&!row.material.active)row.warnings.push('沿用已停用材料');
      row.priceErrors=[...row.errors];
      if(!nonnegative(row.share)||row.share>100)row.errors.push('订单占比需为 0–100%');
      if(row.errors.length){row.roi=null;row.roiRow=null;return;}
      // Reuse the established refund model per row, including variant-specific material rules.
      const mat={...clone(row.material),price:row.rule.costPerSqm,weightRules:[{...clone(row.rule),variant:'',default:true}]};
      const plan={id:row.id,materialId:mat.id,materialRuleId:row.ruleId,shippingId:shop.settings.shippingId,params:clone(shop.settings),items:[{sizeId:row.sizeId,price:row.price,share:100,weight:row.weight}],packagingWeight:0};
      const computed=M.calculate({materials:[mat],sizes:[row.size],shippingTemplates:state.shippingTemplates},plan);
      row.roiRow=computed.rows[0];row.roi=computed.roi;
      row.errors.push(...computed.errors);
    });
    for(const group of shop.groups){
      const priced=rows.filter(r=>r.groupId===group.id&&!r.errors.length).sort((a,b)=>a.baseCost-b.baseCost);
      let highest=null;for(const r of priced){if(highest&&costKey(r.baseCost)>costKey(highest.baseCost)&&r.price<highest.price-1e-8)r.warnings.push('售价低于组内较低成本 SKU');if(!highest||r.price>highest.price)highest=r;}
    }
    const errors=rows.flatMap(r=>r.errors.map(e=>`${r.size?M.sizeLabel(r.size):'规格'}：${e}`));
    const total=rows.reduce((sum,r)=>sum+(finite(r.share)?r.share:0),0);
    if(!rows.length)errors.push('请添加规格');
    if(Math.abs(total-100)>1e-6)errors.push('全店订单占比需合计 100%');
    const sum=key=>rows.reduce((a,r)=>a+(r.roiRow?.[key]??0)*r.share/100,0),margin=sum('margin'),netMargin=sum('netMargin'),price=sum('price'),cost=sum('cost');
    const spend=shop.settings.spend,actualRoi=shop.settings.actualRoi,forecast=nonnegative(spend)&&nonnegative(actualRoi),valid=!errors.length,gmv=forecast?spend*actualRoi:null,orders=positive(price)&&gmv!==null?gmv/price:null;
    return {rows,total,errors:[...new Set(errors)],valid,price:valid?price:null,cost:valid?cost:null,roi:valid&&margin>0?price/margin:null,netRoi:valid&&netMargin>0?price/netMargin:null,profit:valid&&orders!==null?orders*margin-spend:null,investment:valid&&orders!==null?spend+orders*cost:null,spend,gmv:valid?gmv:null,warningCount:rows.filter(r=>r.warnings.length).length};
  }
  function normalizeShares(shop) {
    if(!shop.rows.length)return;
    const sum=shop.rows.reduce((a,r)=>a+(nonnegative(r.share)?r.share:0),0);let remaining=10000;
    shop.rows.forEach((r,i)=>{const points=i===shop.rows.length-1?remaining:Math.min(remaining,Math.round((sum?(nonnegative(r.share)?r.share:0)/sum:1/shop.rows.length)*10000));r.share=points/100;remaining-=points;});
  }
  function makeRecord(state,shopId,date,note='',previousId=null,reason='') {
    if(!M.validDate(date)||date>today())throw Error('请选择今天或过去的有效日期');
    const shop=state.shops.find(s=>s.id===shopId),previous=state.records.find(h=>h.id===previousId);
    if(previousId&&(!previous||previous.status!=='confirmed'||previous.shopId!==shopId||!reason.trim()))throw Error('请检查原记录状态并填写更正原因');
    if(state.records.some(h=>h.shopId===shopId&&h.date===date&&h.status==='confirmed'&&h.id!==previousId))throw Error('本店当天已有有效日账，请更正原记录');
    if(state.archives.some(a=>a.records?.some(h=>h.shopId===shopId&&h.date===date&&h.status==='confirmed')))throw Error('该日已有旧计划账目，请先在正式工作台处理，避免重复统计');
    const result=calculate(state,shopId);if(!result.valid||result.profit===null)throw Error(result.errors[0]||'请填写广告消耗和支付 ROI');
    const record={id:id('record'),shopId,shopName:shop.name,date,note,reason,previousId,status:'confirmed',result:clone(result),frame:{shop:clone(shop),materials:clone(state.materials),sizes:clone(state.sizes),strategies:clone(state.strategies),shippingTemplates:clone(state.shippingTemplates)},createdAt:new Date().toISOString()};
    if(previous){previous.status='superseded';previous.replacedBy=record.id;}
    state.records.push(record);return record;
  }
  function validState(s) {
    try {
      const unique=a=>Array.isArray(a)&&a.length<=10000&&a.every(x=>x&&typeof x.id==='string'&&/^[\w.-]{1,120}$/.test(x.id))&&new Set(a.map(x=>x.id)).size===a.length;
      if(s.version!=='pricing-prototype-1'||!['shops','materials','sizes','shippingTemplates','strategies','records'].every(k=>unique(s[k]))||!s.shops.length||!s.shops.some(x=>x.id===s.activeShop)||!Number.isInteger(s.revision)||s.revision<0)return false;
      if(!s.strategies.every(x=>!strategyErrors(x).length&&typeof x.active==='boolean')||!s.sizes.every(M.validSize)||!s.shippingTemplates.every(M.validTemplate)||!Array.isArray(s.archives)||s.archives.length>100||!s.prefs||typeof s.prefs.margin!=='boolean')return false;
      if(!s.materials.every(m=>typeof m.name==='string'&&m.name.trim()&&typeof m.active==='boolean'&&unique(m.weightRules)&&m.weightRules.every(r=>nonnegative(r.costPerSqm)&&nonnegative(r.coefficient))))return false;
      if(M.duplicateMaterialName(s.materials))return false;
      const draft=v=>v===''||finite(v);
      for(const shop of s.shops){
        if(typeof shop.name!=='string'||!shop.name.trim()||shop.name.length>80||!unique(shop.groups)||!unique(shop.rows)||!shop.settings)return false;
        if(!['fee','tax','spend','actualRoi','other','returnCost','recovery','packagingGrams'].every(k=>draft(shop.settings[k]))||!shop.settings.refundRates||!['unshipped','shippedOnly','returnRefund','firstHour'].every(k=>draft(shop.settings.refundRates[k]))||!['all','shipped'].includes(shop.settings.otherFeeScope))return false;
        if(!s.shippingTemplates.some(t=>t.id===shop.settings.shippingId))return false;
        if(!shop.groups.every(g=>typeof g.name==='string'&&g.name.trim()&&g.name.length<=80&&s.strategies.some(p=>p.id===g.strategyId)))return false;
        for(const r of shop.rows)if(!shop.groups.some(g=>g.id===r.groupId)||!s.sizes.some(x=>x.id===r.sizeId)||!s.materials.some(m=>m.id===r.materialId&&m.weightRules.some(q=>q.id===r.ruleId))||r.strategyId!==''&&!s.strategies.some(p=>p.id===r.strategyId)||!['auto','manual'].includes(r.priceMode)||!['manualPrice','share','weightGrams'].every(k=>draft(r[k])))return false;
      }
      for(const h of s.records){
        if(!s.shops.some(x=>x.id===h.shopId)||!['confirmed','superseded','void'].includes(h.status)||!M.validDate(h.date)||!h.frame?.shop||!Array.isArray(h.result?.rows)||!h.result.valid||!finite(h.result.profit)||!finite(h.result.gmv)||typeof h.note!=='string')return false;
        if(h.previousId){const p=s.records.find(x=>x.id===h.previousId);if(!p||p.replacedBy!==h.id||p.status!=='superseded'||p.shopId!==h.shopId)return false;}
        if(h.status==='superseded'&&!s.records.some(x=>x.id===h.replacedBy&&x.previousId===h.id))return false;
        // Validate against the frozen dependencies, never today's prices or rules.
        const frame=h.frame;
        if(frame.shop.id!==h.shopId||!['materials','sizes','strategies','shippingTemplates'].every(k=>Array.isArray(frame[k])))return false;
        const recalculated=calculate({...s,...frame,shops:[frame.shop],activeShop:h.shopId},h.shopId);
        const canonical=value=>JSON.stringify(value,(key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
        if(canonical(recalculated)!==canonical(h.result))return false;
      }
      const confirmed=s.records.filter(h=>h.status==='confirmed').map(h=>h.shopId+'|'+h.date);if(new Set(confirmed).size!==confirmed.length)return false;
      if(!s.archives.every(a=>a&&typeof a.id==='string'&&M.validateBackup(a.state)&&Array.isArray(a.records)&&JSON.stringify(a.records)===JSON.stringify(a.state.records)))return false;
      return true;
    } catch {return false;}
  }
  function transferRules(state) {
    const materials={},weightRules=[];
    for(const m of state.materials){if(!m.active)continue;const r=m.weightRules.find(x=>x.default)||m.weightRules[0];materials[m.name]={costPerSqm:r?.costPerSqm,weightPerSqm:r?.coefficient};m.weightRules.forEach(r=>weightRules.push({...r,material:m.name}));}
    return {materials,weightRules,keywords:Object.keys(materials)};
  }
  function materialCandidates(text,names) {
    // Longest matches consume their span: 冰丝水洗底 must not also match 冰丝.
    const normalized=String(text).normalize('NFKC').replace(/\s/g,'').toLowerCase();
    const aliases={仿亚麻:'亚麻',包边水晶绒:'水晶绒'};
    const tokens=[...names.map(name=>[name,name]),...Object.entries(aliases).filter(([,name])=>names.includes(name))].sort((a,b)=>b[0].length-a[0].length);
    let remaining=normalized;const found=new Set();
    for(const [token,name] of tokens){const key=token.normalize('NFKC').toLowerCase().replace(/\s/g,'');if(key&&remaining.includes(key)){found.add(name);remaining=remaining.split(key).join(' '.repeat(key.length));}}
    return [...found];
  }
  function dimensionCandidates(input) {
    const raw=String(input??''),normalized=raw.normalize('NFKC').replace(/[＊×✕✖乘]/g,'*');
    const re=/(\d+(?:\.\d+)?)\s*(毫米|厘米|公分|mm|cm|米|m)?\s*[*xX]\s*(\d+(?:\.\d+)?)\s*(毫米|厘米|公分|mm|cm|米|m)?/gi;
    const factors={mm:.1,'毫米':.1,cm:1,'厘米':1,'公分':1,m:100,'米':100},candidates=[];
    for(const match of normalized.matchAll(re)){
      const start=match.index,end=start+match[0].trimEnd().length,before=normalized[start-1]||'',after=normalized[end]||'';
      // Reject dimensions embedded in model codes, and 3D/compound expressions.
      if(/[A-Za-z0-9_.-]/.test(before)||/[A-Za-z0-9_.]/.test(after)||/[*xX]\s*$/.test(normalized.slice(0,start))||/^\s*[*xX]/.test(normalized.slice(end)))continue;
      const u1=(match[2]||match[4]||'cm').toLowerCase(),u2=(match[4]||match[2]||'cm').toLowerCase();
      const width=Number((Number(match[1])*factors[u1]).toPrecision(12)),length=Number((Number(match[3])*factors[u2]).toPrecision(12));
      if(!positive(width)||!positive(length)||width>10000||length>10000)continue;
      const existing=candidates.find(c=>c.width===width&&c.length===length);
      if(existing){existing.matches.push(match[0]);continue;}
      candidates.push({width,length,area:width*length/10000,label:`${width}×${length} cm`,match:match[0],matches:[match[0]],start,end,assumedUnit:!match[2]&&!match[4]});
    }
    return {raw,normalized,candidates,ok:candidates.length===1};
  }
  function transform(source,state) {
    let result=P.transformRows(source,{rules:transferRules(state)});
    const patches={};
    result.rows.forEach(r=>{
      const specIndex=result.map.specName, rawSpec=String(source[r.rowNumber-1]?.[specIndex]??'');
      r.values[4]=r.values[23]=r.values[26]=rawSpec;
      const combined=(r.values[3]+' '+rawSpec).normalize('NFKC').replace(/\s/g,'');
      r.pseudoLinen=combined.includes('伪亚麻');
      const found=r.pseudoLinen?['硅藻泥','亚麻']:materialCandidates(combined,Object.keys(result.rules.materials));
      const parsed=dimensionCandidates(rawSpec);r.dimensionCandidates=parsed.candidates;r.dimensionNormalized=parsed.normalized;r.resolvedDimensions=parsed.ok?{width:parsed.candidates[0].width,length:parsed.candidates[0].length}:null;r.manualDimensions=false;
      const d=r.resolvedDimensions;r.values[9]=d?.width??'';r.values[10]=d?.length??'';r.values[7]=d?`${d.width}*${d.length}`:'';r.values[8]=d?d.width*d.length/10000:'';
      r.candidates=found;r.originalSpec=rawSpec;r.resolvedMaterial=found.length===1?found[0]:'';r.manualMaterial=false;
      r.values[5]=r.values[6]='';r.values[11]=r.values[12]='';
      if(r.resolvedMaterial)patches[r.rowNumber]={material:r.resolvedMaterial};
    });
    result=P.applyReviews(result,patches);return decorateTransfer(result);
  }
  function decorateTransfer(result) {
    result.rows.forEach(r=>{
      r.issues=r.issues.filter(i=>!['MATERIAL','RULE','MATERIAL_REVIEW','DIMENSION','DIMENSION_REVIEW'].includes(i.code));
      const d=r.resolvedDimensions,dimensionsValid=d&&[d.width,d.length].every(v=>positive(v)&&v<=10000);
      r.values[9]=dimensionsValid?d.width:'';r.values[10]=dimensionsValid?d.length:'';r.values[7]=dimensionsValid?`${d.width}*${d.length}`:'';r.values[8]=r.area=dimensionsValid?d.width*d.length/10000:'';
      r.dimensions={ok:!!dimensionsValid,width:r.values[9],length:r.values[10],area:r.area,raw:r.originalSpec};
      if(!dimensionsValid)r.issues.push({code:'DIMENSION_REVIEW',message:r.dimensionCandidates?.length>1?'存在多个尺寸，请选择候选或手动填写':'未识别可靠尺寸，请手动填写长宽'});
      if(!r.resolvedMaterial){
        r.values[5]=r.values[6]='';r.values[11]=r.values[12]='';r.material='';r.weight=r.cost='';
        r.issues.unshift({code:'MATERIAL_REVIEW',message:r.pseudoLinen?'伪亚麻可能为硅藻泥或亚麻，请确认实际材质':r.candidates.length>1?'出现多个材质，请手动选择':'未识别材质，请手动选择'});
      }else{
        // Material ambiguity uses both names equally; thickness is SKU-specific.
        // The explicit specification must precede the product's list of available thicknesses.
        const rule=P.resolveWeightRule(r.resolvedMaterial,`${r.originalSpec||r.values[4]} ${r.values[3]}`,result.rules);
        const cost=rule?.costPerSqm??result.rules.materials[r.resolvedMaterial]?.costPerSqm;
        if(!rule||!nonnegative(rule.coefficient)||!nonnegative(cost))r.issues.unshift({code:'RULE',message:'材质缺少有效的重量或成本规则'});
        r.values[11]=r.weight=dimensionsValid&&nonnegative(rule?.coefficient)?r.area*rule.coefficient:'';
        r.values[12]=r.cost=dimensionsValid&&nonnegative(cost)?r.area*cost:'';
      }
    });
    result.exceptions=result.rows.filter(r=>r.issues.length).map(r=>({rowNumber:r.rowNumber,issues:r.issues,output:r.values}));
    result.summary.exceptionRows=result.exceptions.length;result.summary.ready=result.rows.length>0&&result.exceptions.length===0;return result;
  }
  function reviewTransfer(result,rowNumbers,material,patch={}) {
    if(material&&!Object.hasOwn(result.rules.materials,material))throw Error('请选择材料库中的材质');
    if(material&&!['硅藻泥','亚麻'].includes(material)&&result.rows.some(r=>rowNumbers.includes(r.rowNumber)&&r.pseudoLinen))throw Error('伪亚麻请选择硅藻泥或亚麻；其他所选行未修改');
    const next=clone(result),reviews={};
    for(const r of next.rows){if(!rowNumbers.includes(r.rowNumber))continue;reviews[r.rowNumber]={...patch};if(material){reviews[r.rowNumber].material=material;r.resolvedMaterial=material;r.manualMaterial=true;r.materialSource='manual';}if(patch.width!==undefined||patch.length!==undefined){r.resolvedDimensions={width:patch.width??r.resolvedDimensions?.width??'',length:patch.length??r.resolvedDimensions?.length??''};r.manualDimensions=true;r.dimensionSource='manual';}}
    return decorateTransfer(P.applyReviews(next,reviews));
  }
  async function exportProducts(templateBytes,result) {
    if(!result?.summary.ready||result.exceptions.length||!result.rows.length||result.rows.some(r=>!r.resolvedMaterial))throw Error('请先处理全部异常');
    const checked=reviewTransfer(result,[],'');if(!checked.summary.ready)throw Error('商品数据校验失败');
    const Excel=typeof module==='object'?require('./assets/exceljs.min.js'):root.ExcelJS;
    const template=new Excel.Workbook();await template.xlsx.load(templateBytes);
    const source=template.worksheets[0],book=new Excel.Workbook(),sheet=book.addWorksheet(source.name);
    // A fresh sheet preserves visual styles without retaining template shared-formula references.
    for(let c=1;c<=29;c++){sheet.getColumn(c).width=source.getColumn(c).width||16;const cell=sheet.getCell(1,c);cell.value=P.HEADERS[c-1];cell.style=clone(source.getCell(1,c).style);}
    sheet.getRow(1).height=source.getRow(1).height;
    checked.rows.forEach((r,i)=>{const row=sheet.getRow(i+2),styleRow=source.getRow(2+i%Math.max(1,source.rowCount-1));row.height=styleRow.height;for(let c=1;c<=29;c++){const cell=row.getCell(c);cell.style=clone(styleRow.getCell(c).style);const value=r.values[c-1]??'';cell.value=[18,19,28].includes(c)?String(value):value;}});
    sheet.autoFilter={from:'A1',to:{row:checked.rows.length+1,column:29}};sheet.views=[{state:'frozen',ySplit:1}];
    return book.xlsx.writeBuffer();
  }
  const api={seed,clone,id,finite,positive,nonnegative,pct,modes,rounds,today,strategyErrors,target,roundPrice,priceFor,calculate,normalizeShares,makeRecord,validState,transferRules,materialCandidates,transform,reviewTransfer,exportProducts,dimensionCandidates};
  if(typeof module==='object')module.exports=api;else root.PricingPrototype=api;
})(typeof window==='object'?window:{});
