(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ProductRecognition=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';

  const OUTPUT_HEADERS=['序号','平台','店铺','平台商品名称','平台规格名称','品牌','商品标签','尺寸','面积','宽','长','重量','成本','广告费','成交金额','主条码','规格辅助码','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存','规格类型','规格名称','货品编码','货品简称','货品名称','商家编码','规格简称'];
  const FIELD_ALIASES={
    seq:['序号','编号','行号'],platform:['平台','来源平台'],shop:['店铺','店铺名称'],productName:['平台商品名称','商品名称','商品标题','货品名称'],specName:['平台规格名称','SKU名称','规格名称','商品规格','商品规格名称','货品名称','商品SKU标题'],
    productId:['平台商品ID','商品ID','商品id'],specId:['平台规格ID','SKU ID','SKUID','规格ID','主条码','货品编码','商品SKU编号'],price:['平台售价','售价','价格'],status:['售卖状态','状态','销售状态'],inventory:['平台库存','库存'],
    orderCount:['商品成交订单数','支付订单数','成交订单数','订单数'],unitCount:['商品成交件数','销售件数','成交件数','支付件数'],
    productCode:['平台商品编码','商品编码'],merchantCode:['平台商家编码','商家编码'],specType:['规格类型'],goodsCode:['货品编码'],goodsShort:['货品简称'],specShort:['规格简称'],sales:['销量','支付件数','成交件数','销售数量','货品数量','修改数量'],date:['日期','支付日期','下单日期']
  };
  const REQUIRED_PRODUCT_FIELDS={platform:'平台',shop:'店铺',productName:'商品名称',specName:'规格名称',productId:'商品 ID',specId:'SKU ID',price:'售价',status:'售卖状态',inventory:'库存'};
  const text=v=>v==null?'':String(v).trim();
  const compact=v=>text(v).normalize('NFKC').replace(/[\s\u3000]/g,'').toLowerCase();
  const number=v=>{if(v===''||v==null||typeof v==='boolean')return null;const n=Number(String(v).replace(/,/g,'').trim());return Number.isFinite(n)?n:null;};
  const validDimension=v=>number(v)!==null&&number(v)>0&&number(v)<=10000;
  const dimensionPattern=/(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?\s*(?:\*|x)+\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?/ig;
  const normalizeMarks=v=>text(v).normalize('NFKC').replace(/[＊×✕✖乘]/g,'*').replace(/[－–—]/g,'-');

  function parseDimensions(value){
    const source=normalizeMarks(value),matches=[...source.matchAll(dimensionPattern)].filter(hit=>!/[A-Za-z0-9]/.test(source[hit.index-1]||'')&&!/[A-Za-z0-9]/.test(source[hit.index+hit[0].length]||''));
    const factors={mm:.1,'毫米':.1,cm:1,'厘米':1,'公分':1,m:100,'米':100},parsed=[];
    for(const hit of matches){if(/^\s*\*\s*\d/.test(source.slice(hit.index+hit[0].length)))return {status:'pending',reason:'multiple',raw:source,candidates:[hit[0]]};const u1=(hit[2]||hit[4]||'cm').toLowerCase(),u2=(hit[4]||hit[2]||'cm').toLowerCase(),width=Number(hit[1])*factors[u1],length=Number(hit[3])*factors[u2];if(validDimension(width)&&validDimension(length)&&!parsed.some(x=>x.width===width&&x.length===length))parsed.push({hit,width,length});}
    if(parsed.length!==1)return {status:'pending',reason:parsed.length?'multiple':matches.length?'invalid':'missing',raw:source,candidates:matches.map(x=>x[0])};
    const {hit,width,length}=parsed[0];return {status:'value',source:'auto',width,length,label:`${width}*${length}`,area:width*length/10000,raw:source,span:[hit.index,hit.index+hit[0].length]};
  }

  function materialCandidates(productName,rules){
    const source=text(productName),materials=(rules?.materials||[]).filter(x=>!x.deleted&&text(x.name));
    if(source.includes('伪亚麻'))return {forced:true,candidates:[]};
    const candidates=materials.filter(m=>source.includes(m.name)).sort((a,b)=>b.name.length-a.name.length);
    if(!candidates.length)return {forced:false,candidates:[]};
    const winners=candidates.filter(x=>!candidates.some(other=>other!==x&&other.name.length>x.name.length&&other.name.includes(x.name)));
    return {forced:false,candidates:winners};
  }
  function identifyMaterial(productName,rules,relatedText=''){
    if(text(relatedText).includes('伪亚麻'))return {status:'pending',source:'auto',reason:'pseudo-linen',candidateIds:[]};
    const found=materialCandidates(relatedText||productName,rules);
    if(found.forced)return {status:'pending',source:'auto',reason:'pseudo-linen',candidateIds:[]};
    if(found.candidates.length!==1)return {status:'pending',source:'auto',reason:found.candidates.length?'ambiguous':'missing',candidateIds:found.candidates.map(x=>x.id)};
    return {status:'value',source:'auto',materialId:found.candidates[0].id,name:found.candidates[0].name};
  }

  function thicknessEvidence(values){
    const all=values.map(normalizeMarks).join(' '),withoutDimensions=all.replace(dimensionPattern,' '),matches=[...withoutDimensions.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:mm|毫米)(?![\w])/ig)];
    const candidates=[...new Set(matches.map(x=>Number(x[1])).filter(x=>Number.isFinite(x)&&x>0&&x<=10000))];
    return {originalMissingThickness:matches.length===0,candidates,raw:matches.map(x=>x[0].trim())};
  }
  function normalizeThicknessDefaults(value={},rules={}){
    const invalid=()=>Object.assign(Error('材质厚度预设已失效，请重新选择厚度。'),{status:422,code:'INVALID_THICKNESS_DEFAULT'});
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>1000)throw invalid();
    const entries=Object.entries(value).map(([id,ruleId])=>{
      const material=(rules.materials||[]).find(m=>m.id===id&&!m.deleted),rule=material?.weightRules?.find(r=>r.id===ruleId&&!r.deleted);
      if(!rule||(rule.thickness!==''&&(number(rule.thickness)===null||number(rule.thickness)<=0)))throw invalid();return [id,ruleId];
    });return Object.fromEntries(entries);
  }
  function resolveThickness(materialDecision,evidence,rules,thicknessDefaults={},thicknessMode='missing'){
    if(materialDecision.status==='blank')return {status:'not-required',source:'manual',reason:'material-blank'};
    if(materialDecision.status!=='value')return {status:'blocked',source:'auto',reason:'material-pending',candidates:evidence.candidates};
    const material=(rules?.materials||[]).find(x=>x.id===materialDecision.materialId);
    if(!material)return {status:'pending',source:'auto',reason:'missing-material',candidates:evidence.candidates};
    if((thicknessMode==='uniform'||evidence.originalMissingThickness)&&Object.hasOwn(thicknessDefaults,material.id)){
      const preset=(material.weightRules||[]).find(r=>r.id===thicknessDefaults[material.id]&&!r.deleted);
      return preset?{status:'value',source:thicknessMode==='uniform'?'uniform':'preset',materialId:material.id,ruleId:preset.id,thickness:number(preset.thickness)}:{status:'pending',source:'preset',reason:'invalid-rule',candidates:[]};
    }
    if(evidence.candidates.length!==1)return {status:'pending',source:'auto',reason:evidence.candidates.length?'conflict':'missing',candidates:evidence.candidates};
    const thickness=evidence.candidates[0],matches=(material.weightRules||[]).filter(r=>!r.deleted&&number(r.thickness)!==null&&Math.abs(number(r.thickness)-thickness)<.011);
    if(matches.length!==1)return {status:'pending',source:'auto',reason:matches.length?'ambiguous':'unknown',candidates:evidence.candidates,ruleIds:matches.map(x=>x.id)};
    return {status:'value',source:'auto',materialId:material.id,ruleId:matches[0].id,thickness};
  }

  function mapFields(headers){
    const normalized=headers.map(compact),map={};
    for(const [field,aliases] of Object.entries(FIELD_ALIASES)){
      // Platform columns are authoritative in ERP exports that also contain internal goods columns.
      const preferred=aliases[0].startsWith('平台')&&normalized.includes(compact(aliases[0]));
      const names=new Set((preferred?[aliases[0]]:aliases).map(compact));
      const indexes=normalized.flatMap((name,index)=>names.has(name)?[index]:[]);
      if(indexes.length===1)map[field]=indexes[0];else if(indexes.length>1)map[field]={ambiguous:indexes};
    }
    return map;
  }
  function productMappingIssues(headers,mapping={}){
    const keys=Object.keys(REQUIRED_PRODUCT_FIELDS);
    return keys.filter(key=>!Number.isInteger(mapping[key])||mapping[key]<0||mapping[key]>=headers.length||keys.some(other=>other!==key&&mapping[other]===mapping[key]));
  }
  function detectHeader(rows){
    let best=null;for(let i=0;i<Math.min(rows.length,40);i++){const row=rows[i],mapped=mapFields(row),score=Object.keys(mapped).length;if(!best||score>best.score)best={rowIndex:i,score,headers:row,mapping:mapped};}
    return best&&best.score>=3?best:null;
  }
  function field(raw,mapping,name){const index=mapping?.[name];return Number.isInteger(index)?raw[index]:'';}
  function sourceId(raw,mapping,name){const value=field(raw,mapping,name);return value==null?'':String(value);}
  function groupKey(platform,shop,productId,rowId){return platform&&shop&&productId?JSON.stringify([platform,shop,productId]):JSON.stringify(['missing',rowId]);}
  function stateValue(review,key,auto){const value=review?.[key];return value&&['pending','value','blank','blocked','not-required'].includes(value.status)?value:auto;}

  function deriveTransferRow(rawRecord,review={},context={}){
    const raw=rawRecord.values||rawRecord.raw||[],mapping=rawRecord.mapping||context.mapping||{},rules=context.rules||{};
    const rowId=rawRecord.rowId,productName=text(field(raw,mapping,'productName')),specName=text(field(raw,mapping,'specName'));
    const autoMaterial=identifyMaterial(productName,rules,`${productName} ${specName}`);let material=stateValue(review,'material',autoMaterial);
    if(material.status==='value'&&!(rules.materials||[]).some(m=>m.id===material.materialId&&!m.deleted))material={status:'pending',source:'manual',reason:'missing-material'};
    const autoSize=parseDimensions(specName),size=stateValue(review,'size',autoSize);
    const evidence=rawRecord.thicknessEvidence||thicknessEvidence([productName,specName]);
    let thickness=stateValue(review,'thickness',resolveThickness(material,evidence,rules,context.thicknessDefaults||{},context.thicknessMode));
    if(thickness.status==='value'&&(material.status!=='value'||thickness.materialId!==material.materialId||!(rules.materials||[]).find(m=>m.id===material.materialId)?.weightRules?.some(r=>r.id===thickness.ruleId&&!r.deleted)))thickness={status:'pending',source:'manual',reason:'invalid-rule'};
    if(size.status==='blank')thickness={status:'not-required',source:'manual',reason:'size-blank'};
    const platform=sourceId(raw,mapping,'platform'),shop=sourceId(raw,mapping,'shop'),productId=sourceId(raw,mapping,'productId'),skuId=sourceId(raw,mapping,'specId');
    const issues=[];
    if(material.status==='pending'||material.status==='blocked')issues.push({field:'material',code:'MATERIAL_PENDING',message:material.reason==='pseudo-linen'?'“伪亚麻”需人工选择材质':'材质需人工确认'});
    if(size.status==='pending'||size.status==='blocked')issues.push({field:'size',code:'SIZE_PENDING',message:'尺寸需人工确认'});
    if(thickness.status==='pending'||thickness.status==='blocked')issues.push({field:'thickness',code:'THICKNESS_PENDING',message:'厚度需人工确认'});
    for(const [name,label] of [['platform','平台'],['shop','店铺'],['productName','商品名称'],['specName','规格名称'],['productId','商品 ID'],['specId','SKU ID'],['price','售价'],['status','售卖状态'],['inventory','库存']])if(text(field(raw,mapping,name))==='')issues.push({field:name,code:'MISSING_FIELD',message:`缺少${label}`});
    const materialEntity=material.status==='value'?(rules.materials||[]).find(x=>x.id===material.materialId):null;
    const rule=thickness.status==='value'?materialEntity?.weightRules?.find(x=>x.id===thickness.ruleId):null;
    const area=size.status==='value'?size.area:null,weight=area!=null&&rule&&number(rule.coefficient)!==null?area*number(rule.coefficient):null,cost=area!=null&&rule&&number(rule.costPerSqm)!==null?area*number(rule.costPerSqm):null;
    if(rule&&(number(rule.coefficient)===null||number(rule.costPerSqm)===null))issues.push({field:'thickness',code:'INVALID_RULE',message:'厚度规则缺少重量或成本'});
    const values=Array(29).fill(null),put=(i,v)=>{values[i]=v===''||v==null?null:v;};
    put(0,number(field(raw,mapping,'seq'))??rowId);put(1,platform);put(2,shop);put(3,productName);put(4,specName);put(5,materialEntity?.name||null);put(6,materialEntity?.name||null);put(7,size.status==='value'?size.label:null);put(8,area);put(9,size.status==='value'?size.width:null);put(10,size.status==='value'?size.length:null);put(11,weight);put(12,cost);put(17,productId);put(18,skuId);put(19,number(field(raw,mapping,'price'))??text(field(raw,mapping,'price')));put(20,text(field(raw,mapping,'status')));put(21,number(field(raw,mapping,'inventory'))??text(field(raw,mapping,'inventory')));put(22,text(field(raw,mapping,'specType')));put(23,specName);put(24,sourceId(raw,mapping,'goodsCode'));put(25,text(field(raw,mapping,'goodsShort')));put(26,specName);put(27,skuId);put(28,text(field(raw,mapping,'specShort')));
    return {rowId,sourceRow:rawRecord.sourceRow,groupId:groupKey(platform,shop,productId,rowId),platform,shop,productId,skuId,productName,specName,material,size,thickness,originalMissingThickness:evidence.originalMissingThickness,area,weight,cost,values,issues,status:issues.length?'pending':'confirmed'};
  }

  function attentionField(row){if(row?.issues?.some(i=>i.code==='MISSING_FIELD'||i.code==='INVALID_RULE'))return null;return ['material','size','thickness'].find(key=>['pending','blocked'].includes(row?.[key]?.status))||null;}

  function normalizePatchPart(value,key,rules){
    if(!value||value==='keep')return {status:'keep'};
    if(value.status)return value;
    if(value.mode){
      const result={...value,status:value.mode,source:'manual'};delete result.mode;
      if(key==='material'&&result.id){result.materialId=result.id;delete result.id;}
      if(key==='size'&&result.status==='value'){
        const size=result.id?(rules?.sizes||[]).find(x=>x.id===result.id):null,width=number(result.width??(size?.irregular?size.productionW:size?.salesW)??size?.w),length=number(result.length??(size?.irregular?size.productionH:size?.salesH)??size?.h);
        if(result.id&&(!size||size.deleted||size.active===false||size.needsReview))throw Object.assign(Error('尺寸方案不可用'),{code:'INVALID_SIZE'});
        if(!validDimension(width)||!validDimension(length))throw Object.assign(Error('尺寸长宽无效'),{code:'INVALID_SIZE'});
        result.sizeId=size?.id||'';result.width=width;result.length=length;result.label=`${width}*${length}`;result.area=width*length/10000;delete result.id;
      }
      return result;
    }
    return {status:'value',...value};
  }
  function previewTransferRowPatch(raw,review,patch={},action={type:'row-edit'},rules={},thicknessDefaults={},thicknessMode='missing'){
    const next=JSON.parse(JSON.stringify(review||{}));const protectedFields=[];let materialChanged=false;
    for(const key of ['material','size']){const part=normalizePatchPart(patch[key],key,rules);if(part.status==='keep')continue;const current=deriveTransferRow(raw,next,{rules,thicknessDefaults,thicknessMode})[key];if(action.type==='selected-batch'&&!action.overwrite&&!['pending','blocked'].includes(current.status)){protectedFields.push(key);continue;}next[key]=part;if(key==='material')materialChanged=true;}
    if(materialChanged)delete next.thickness;
    const thicknessPart=normalizePatchPart(patch.thickness,'thickness',rules);if(thicknessPart.status!=='keep'){
      const interim=deriveTransferRow(raw,next,{rules,thicknessDefaults,thicknessMode});
      if(interim.size.status==='blank'||interim.material.status!=='value')protectedFields.push('thickness');
      else if(thicknessPart.materialId!==interim.material.materialId||(rules.materials||[]).find(x=>x.id===thicknessPart.materialId)?.weightRules?.some(x=>x.id===thicknessPart.ruleId&&(!x.deleted||interim.thickness.ruleId===x.id))!==true)throw Object.assign(Error('厚度规则与材质不匹配'),{code:'INVALID_RULE'});
      else if(action.type==='selected-batch'&&!action.overwrite&&!['pending','blocked'].includes(interim.thickness.status))protectedFields.push('thickness');
      else next.thickness=thicknessPart;
    }
    return {review:next,derived:deriveTransferRow(raw,next,{rules,thicknessDefaults,thicknessMode}),protectedFields};
  }

  return {DERIVATION_VERSION:3,normalizeThicknessDefaults,attentionField,OUTPUT_HEADERS,FIELD_ALIASES,REQUIRED_PRODUCT_FIELDS,productMappingIssues,text,compact,number,validDimension,parseDimensions,identifyMaterial,thicknessEvidence,resolveThickness,mapFields,detectHeader,deriveTransferRow,previewTransferRowPatch,groupKey};
});
