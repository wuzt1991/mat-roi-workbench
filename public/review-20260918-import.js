(function(root){
  'use strict';
  const P=typeof module==='object'?require('./product-transfer.js'):root.MatProductTransfer;
  const B=typeof module==='object'?require('./pricing-prototype-model.js'):root.PricingPrototype;
  const X=typeof module==='object'?require('./assets/exceljs.min.js'):root.ExcelJS;
  const norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
  const num=v=>String(v??'').trim()===''?null:Number(String(v).replace(/,/g,''));
  function getRules(state,retained=[]){return B.transferRules({...state,materials:state.materials.filter(m=>!m.deleted||retained.includes(m.name))});}
  function dimensionCandidates(...texts){const candidates=[];for(const text of texts){for(const c of B.dimensionCandidates(text).candidates){if(!candidates.some(x=>x.width===c.width&&x.length===c.length))candidates.push(c);}}return candidates;}
  function thicknessCandidates(...texts){
    const found=[];
    for(const source of texts){
      let remaining=String(source??'').normalize('NFKC').replace(/[＊×✕✖乘]/g,'*');
      for(const c of B.dimensionCandidates(remaining).candidates)for(const match of c.matches)remaining=remaining.replace(match,' ');
      for(const match of remaining.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm|毫米)/gi)){
        const value=Number(match[1]);if(Number.isFinite(value)&&!found.includes(value))found.push(value);
      }
    }
    return found;
  }
  function analyzeProducts(source,state){
    const headers=P.detectHeaderRow(source,Object.values(P.FIELD_ALIASES).flat()),map=P.mapFields(headers.headers),rules=getRules(state);
    const skuIndex=headers.headers.findIndex(x=>['sku名称','sku描述','sku','规格描述'].includes(norm(x)));
    const rows=[];
    source.slice(headers.rowIndex+1).forEach((raw,i)=>{
      if(raw.every(x=>String(x??'').trim()===''))return;
      const get=k=>map[k]===undefined?'':String(raw[map[k]]??'').trim(),productName=get('productName'),spec=get('specName'),skuText=skuIndex>=0?String(raw[skuIndex]??''):'';
      const pseudo=norm(productName+' '+spec+' '+skuText).includes('伪亚麻');
      const candidates=pseudo?['硅藻泥','亚麻']:B.materialCandidates(productName,Object.keys(rules.materials));
      const dims=dimensionCandidates(spec,skuText),material=!pseudo&&candidates.length===1?candidates[0]:'';
      const values=Array(29).fill('');
      const fields={0:i+1,1:get('platform'),2:get('shop'),3:productName,4:spec,15:get('productCode'),16:get('merchantCode'),17:get('productId'),18:get('specId'),19:num(get('price'))??get('price'),20:get('status'),21:num(get('inventory'))??get('inventory'),22:get('specType'),23:spec,24:get('goodsCode'),25:get('goodsShort'),26:spec,27:get('specId'),28:get('specShort')};
      Object.assign(values,fields);
      rows.push({id:'transfer-'+i,rowNumber:headers.rowIndex+i+2,originalName:productName,originalSpec:spec,skuText,pseudo,candidates,dimensionCandidates:dims,thicknessCandidates:thicknessCandidates(spec,skuText,productName),material,materialStatus:material?'value':'pending',dimensions:dims.length===1?{width:dims[0].width,length:dims[0].length}:null,dimensionStatus:dims.length===1?'value':'pending',thicknessRuleId:'',manualThickness:false,values});
    });
    if(!rows.length)throw Error('表格没有商品数据');if(rows.length>5000)throw Error('一次最多导入 5000 条，请拆分文件');
    return recalculateProducts({rows,filename:'',rules},state);
  }
  function recalculateProducts(result,state){
    result.rules=getRules(state,result.rows.filter(r=>r.materialStatus==='value').map(r=>r.material));delete result.thicknessPolicy;let blanks=0,pending=0,thicknessPending=0;
    for(const r of result.rows){
      r.issues=[];const v=r.values;[5,6,7,8,9,10,11,12].forEach(i=>v[i]='');
      v[4]=v[23]=v[26]=r.originalSpec;
      if(r.materialStatus==='pending')r.issues.push(r.pseudo?'伪亚麻需人工确认':'材质待确认');
      if(r.dimensionStatus==='pending')r.issues.push('尺寸待确认');
      if(r.materialStatus==='blank'||r.dimensionStatus==='blank')blanks++;
      if(r.materialStatus==='value'&&r.material){v[5]=v[6]=r.material;const suffix='【'+r.material+'】';v[4]=v[23]=v[26]=r.originalSpec.endsWith(suffix)?r.originalSpec:r.originalSpec+suffix;}
      if(r.dimensionStatus==='value'){
        const d=r.dimensions;if(!validDimensions(d))r.issues.push('尺寸需为有效正数');
        else{v[7]=d.width+'*'+d.length;v[9]=d.width;v[10]=d.length;v[8]=d.width*d.length/10000;}
      }
      const blank=r.materialStatus==='blank'||r.dimensionStatus==='blank';
      r.thicknessStatus=blank?'blank':r.materialStatus==='value'?'pending':'blocked';r.thicknessSource='';r.resolvedThicknessRuleId='';r.thicknessReason=blank?'已留空，无需计算厚度':'请先确认材质';
      if(!Array.isArray(r.thicknessCandidates))r.thicknessCandidates=thicknessCandidates(r.originalSpec,r.skuText,r.originalName);
      if(!blank&&r.materialStatus==='value'){
        const rules=(result.rules.weightRules||[]).filter(x=>x.material===r.material&&!x.variant),written=[...new Set(r.thicknessCandidates)];
        let namedRule=null,reason='';
        if(r.manualThickness){
          const matches=rules.filter(x=>x.id===r.thicknessRuleId);namedRule=matches.length===1?matches[0]:null;
          if(namedRule)r.thicknessSource='人工确认';else reason='已选厚度规则不存在，请人工确认';
        }else if(r.forceThicknessReview)reason='材质已变更，请人工确认厚度';
        else if(written.length===1){
          const matches=rules.filter(x=>x.thickness!==''&&Number(x.thickness)===written[0]);namedRule=matches.length===1?matches[0]:null;
          if(namedRule)r.thicknessSource='识别 '+written[0]+' mm';
          else reason=matches.length?'存在多个厚度规则，请人工确认':'识别到的厚度没有对应规则，请人工确认';
        }else reason=written.length>1?'存在多个厚度，请人工确认':'未写厚度，请人工确认';
        if(!namedRule||!validRule(namedRule)){
          r.thicknessReason=reason||'厚度规则的重量或成本无效，请检查材料规则';r.issues.push(r.thicknessReason);thicknessPending++;
        }else{
          r.thicknessStatus='value';r.resolvedThicknessRuleId=namedRule.id;r.thicknessReason=r.thicknessSource;
          if(v[8]!==''){v[11]=v[8]*namedRule.coefficient;v[12]=v[8]*namedRule.costPerSqm;}
        }
      }
      if(!v[17]||!v[18])r.issues.push('缺少商品 ID 或 SKU ID');
      if(!v[3]||!v[4])r.issues.push('缺少原商品名称或规格名称');
      for(const i of [19,21])if(typeof v[i]!=='number'||!Number.isFinite(v[i])||v[i]<0)r.issues.push(i===19?'售价无效':'库存无效');
      if(r.issues.length)pending++;
    }
    result.summary={total:result.rows.length,pending,blanks,thicknessPending,ready:pending===0};return result;
  }
  function validDimensions(d){return !!d&&[d.width,d.length].every(x=>Number.isFinite(x)&&x>0&&x<=10000);}
  function validRule(rule){return !!rule&&[rule.coefficient,rule.costPerSqm].every(x=>Number.isFinite(x)&&x>=0);}
  function productGroups(result){
    const groups=new Map();
    for(const row of result.rows){
      const [platform,shop,productId]=[row.values[1],row.values[2],row.values[17]].map(v=>String(v??''));
      const key=[platform,shop,productId].every(v=>v.trim())?JSON.stringify([platform,shop,productId]):'row:'+row.id;
      if(!groups.has(key))groups.set(key,{key,platform,shop,shopName:shop,productId,rows:[]});groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }
  function validateReviewPatch(patch,state){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('复核内容无效');
    const allowed=['material','dimensions','thicknessRuleId'];if(Object.keys(patch).some(k=>!allowed.includes(k)))throw Error('复核字段无效');
    const rules=getRules(state);
    if(patch.material!==undefined&&(typeof patch.material!=='string'||patch.material!==''&&!Object.hasOwn(rules.materials,patch.material)))throw Error('请选择有效材质');
    if(patch.dimensions!==undefined&&patch.dimensions!==null&&!validDimensions(patch.dimensions))throw Error('长宽需为有效正数');
    if(patch.thicknessRuleId!==undefined){
      const matches=rules.weightRules.filter(r=>r.id===patch.thicknessRuleId&&!r.variant);
      if(matches.length!==1||!validRule(matches[0]))throw Error('请选择有效厚度规则');
      if(patch.material!==undefined&&patch.material!==matches[0].material)throw Error('厚度规则与材质不兼容');
      return matches[0];
    }
    return null;
  }
  function previewProductReview(result,rowIds,patch,state,overwrite=false){
    const thicknessRule=validateReviewPatch(patch,state);
    const existingIds=new Set(result.rows.map(r=>r.id));
    if(!Array.isArray(rowIds)||rowIds.some(id=>!existingIds.has(id)))throw Error('所选规格已不存在');
    const draft=recalculateProducts(structuredClone(result),state),ids=new Set(rowIds),counts={material:0,thickness:0,dimension:0},changed=new Set(),protectedRows=new Set(),incompatible=new Set();
    const mark=(field,row)=>{counts[field]++;changed.add(row.id);};
    for(const row of draft.rows){
      if(!ids.has(row.id))continue;
      if(patch.material!==undefined){
        if(overwrite||row.materialStatus==='pending'){
          if(row.material!==patch.material||row.materialStatus!==(patch.material?'value':'blank')){
            row.thicknessRuleId='';row.manualThickness=false;row.forceThicknessReview=patch.material!=='';
          }
          if(row.material!==patch.material||row.materialStatus!==(patch.material?'value':'blank')||row.materialSource!=='manual')mark('material',row);
          row.material=patch.material;row.materialStatus=patch.material?'value':'blank';row.materialSource='manual';
        }else protectedRows.add(row.id);
      }
      if(patch.dimensions!==undefined){
        if(overwrite||row.dimensionStatus==='pending'){
          if(JSON.stringify(row.dimensions)!==JSON.stringify(patch.dimensions)||row.dimensionStatus!==(patch.dimensions?'value':'blank')||row.dimensionSource!=='manual')mark('dimension',row);
          row.dimensions=structuredClone(patch.dimensions);row.dimensionStatus=patch.dimensions?'value':'blank';row.dimensionSource='manual';
        }else protectedRows.add(row.id);
      }
      if(thicknessRule){
        if(row.materialStatus!=='value'||row.material!==thicknessRule.material||row.dimensionStatus==='blank'){incompatible.add(row.id);continue;}
        const thicknessPending=row.forceThicknessReview||row.thicknessStatus!=='value';
        if(overwrite||thicknessPending){
          if(row.thicknessRuleId!==thicknessRule.id||!row.manualThickness)mark('thickness',row);
          row.thicknessRuleId=thicknessRule.id;row.manualThickness=true;row.forceThicknessReview=false;
        }else protectedRows.add(row.id);
      }
    }
    recalculateProducts(draft,state);
    return {result:draft,counts,changed:changed.size,protected:protectedRows.size,incompatible:incompatible.size};
  }
  function applyProductReview(result,rowIds,patch,state,overwrite=false){
    if(!Object.values(patch||{}).some(value=>value!==undefined))throw Error('请至少选择一项需要修改的内容');
    const out=previewProductReview(result,rowIds,patch,state,overwrite);
    if(!out.changed)throw Error('没有需要更新的字段，可检查范围或勾选覆盖已确认值');
    Object.assign(result,out.result);delete result.thicknessPolicy;
    const {result:unused,...summary}=out;return summary;
  }
  function reviewProduct(result,rowIds,patch,state){
    const out=previewProductReview(result,rowIds,patch,state,true);
    if(out.incompatible)throw Error('厚度规则与所选规格的材质或尺寸状态不兼容');
    Object.assign(result,out.result);delete result.thicknessPolicy;return result;
  }
  async function exportProducts(result,state,templateBytes){
    const fresh=recalculateProducts(structuredClone(result),state);if(!fresh.summary.ready)throw Error('请处理待复核项，或明确选择保留为空');
    const book=new X.Workbook(),sheet=book.addWorksheet('商品转表');let tpl=null;
    if(templateBytes){const original=new X.Workbook();await original.xlsx.load(templateBytes);tpl=original.worksheets[0];}
    sheet.addRow(P.HEADERS);for(const r of fresh.rows)sheet.addRow(r.values.map(v=>v===''?null:v));
    for(let c=1;c<=29;c++){sheet.getColumn(c).width=tpl?.getColumn(c).width||18;for(let i=1;i<=sheet.rowCount;i++){
      const cell=sheet.getCell(i,c);if(tpl)cell.style=structuredClone(tpl.getCell(i===1?1:2,c).style||{});if(i>1&&[18,19,28].includes(c)&&cell.value!==null)cell.value=String(cell.value);
    }}
    sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:AC'+sheet.rowCount;return book.xlsx.writeBuffer();
  }
  const salesAliases={shop:['店铺','店铺名称'],productId:['商品id','平台商品id'],skuId:['skuid','sku id','sku编码','平台规格id','规格id'],spec:['sku名称','平台规格名称','规格名称','商品规格','规格','sku'],count:['支付订单数','付款订单数','订单数','销售数量','销量','支付件数','销售件数'],period:['统计周期','日期','统计日期']};
  function mapSales(headers){const map={};for(const [key,aliases] of Object.entries(salesAliases)){map[key]=headers.findIndex(h=>aliases.some(a=>norm(a)===norm(h)));}return map;}
  function analyzeSales(source,shop,state){
    let index=-1,map;
    for(let i=0;i<Math.min(source.length,40);i++){const m=mapSales(source[i]);if(m.count>=0&&(m.skuId>=0||m.spec>=0)){index=i;map=m;break;}}
    if(index<0)throw Error('未找到 SKU 与数量表头，请使用示例表头：SKU ID、支付订单数');
    const headers=source[index].map(String),items=[],periods=new Set();
    source.slice(index+1).forEach((row,i)=>{
      if(row.every(v=>String(v??'').trim()===''))return;
      const get=k=>map[k]>=0?String(row[map[k]]??'').trim():'',sku=get('skuId'),spec=get('spec');
      if(/^(合计|总计|汇总)$/.test(sku||spec))return;
      const shopName=get('shop'),productId=get('productId'),count=num(get('count')),period=get('period');if(period)periods.add(period);
      let options=shop.rows.filter(r=>sku&&r.skuId===sku&&(!productId||r.productId===productId));
      if(!sku&&spec){const dims=dimensionCandidates(spec);if(dims.length===1)options=shop.rows.filter(r=>{const s=state.sizes.find(x=>x.id===r.sizeId);return s.salesW===dims[0].width&&s.salesH===dims[0].length&&(!productId||r.productId===productId);});}
      const error=!Number.isFinite(count)||count<0?'数量需为非负数字':shopName&&shopName!==shop.name?'店铺不一致':'';
      items.push({id:'sale-'+i,sku,spec,shopName,productId,count,match:!error&&options.length===1?options[0].id:'',error,excluded:false});
    });
    if(!items.length)throw Error('没有可导入的销售记录');
    return {items,headers,map,filename:'',period:[...periods].join('、'),basis:/订单/.test(headers[map.count])?'订单数':'件数',allowUnits:false,missing:'keep'};
  }
  function applySales(draft,shop){
    if(!draft.period.trim())throw Error('请填写销售数据统计周期');
    if(draft.basis==='件数'&&!draft.allowUnits)throw Error('请确认按件数估算订单占比');
    const included=draft.items.filter(x=>!x.excluded);if(!included.length)throw Error('没有选择销售记录');
    if(included.some(x=>x.error||!x.match||!shop.rows.some(r=>r.id===x.match)))throw Error('请匹配或明确排除异常记录');
    const counts=new Map();for(const x of included)counts.set(x.match,(counts.get(x.match)||0)+x.count);
    const sum=[...counts.values()].reduce((a,b)=>a+b,0);if(!(sum>0))throw Error('总销量为 0，不能计算占比');
    const missing=shop.rows.filter(r=>!counts.has(r.id));if(missing.length&&draft.missing!=='zero')throw Error('报表未覆盖全部 SKU，请明确选择未出现的 SKU 按 0 处理');
    for(const r of shop.rows){r.sales=counts.get(r.id)||0;r.share=r.sales/sum*100;}
    // Keep stored proportions at two decimals, with the remainder on the last positive row.
    let remaining=100;const positiveRows=shop.rows.filter(r=>r.sales>0);
    positiveRows.forEach((r,i)=>{r.share=i===positiveRows.length-1?Number(remaining.toFixed(2)):Number(r.share.toFixed(2));remaining-=r.share;});
    shop.salesSource={filename:draft.filename,period:draft.period,basis:draft.basis,count:sum,excluded:draft.items.length-included.length};
  }
  async function readRows(bytes){
    P.checkFileSize(bytes);const book=new X.Workbook();await book.xlsx.load(bytes);let best=null,score=-1;
    for(const sheet of book.worksheets){if(sheet.rowCount>5040||sheet.columnCount>200)throw Error('表格超过 5000 行或 200 列，请拆分导入');const rows=[];sheet.eachRow({includeEmpty:true},row=>rows.push(row.values.slice(1).map(v=>v&&typeof v==='object'?(v.result??v.text??v.richText?.map(x=>x.text).join('')??''):v??'')));const s=rows.slice(0,40).reduce((m,r)=>Math.max(m,r.filter(x=>/商品|规格|SKU|订单|销量|名称/i.test(String(x))).length),0);if(s>score){best=rows;score=s;}}
    if(!best)throw Error('工作簿中没有可读取的表');return best;
  }
  function productExample(){return [['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],['抖音','地垫旗舰店','硅藻泥吸水地垫','MZJ90-3;40*60cm','P-01','S-01',19.9,'在售',100],['抖音','地垫旗舰店','伪亚麻家用地垫','50*100cm','P-02','S-02',25.9,'在售',100],['抖音','地垫旗舰店','亚麻玄关地垫','40*60cm / 50*80cm','P-03','S-03',29.9,'在售',100],['抖音','地垫旗舰店','柔软家用地垫','编号123 3mm 红色','P-04','S-04',15.9,'在售',100],['抖音','地垫旗舰店','冰丝水洗底地垫','400mm×60cm','P-05','S-05',19.9,'在售',100]];}
  function integratedProductExample(){return [['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    ['抖音','地垫旗舰店','硅藻泥吸水地垫','浅灰 / 40×60cm / 3mm','P10001','SKU-001',19.9,'在售',100],
    ['抖音','地垫旗舰店','硅藻泥浴室地垫','奶油白 / 50×80cm','P10001','SKU-002',29.9,'在售',100],
    ['抖音','地垫旗舰店','硅藻泥加厚地垫','深灰 / 60×90cm / 8mm','P10001','SKU-003',39.9,'在售',100],
    ['抖音','地垫旗舰店','亚麻入户地垫','原木色 / 50×80cm','P10002','SKU-004',29.9,'在售',100],
    ['抖音','地垫旗舰店','硅藻泥厨房地垫','格纹 / 50×120cm、60×120cm / 3mm、5mm','P10003','SKU-005',49.9,'在售',100],
    ['抖音','地垫旗舰店','伪亚麻耐磨地垫','条纹 / 40×60cm / 3mm','P10003','SKU-006',19.9,'在售',100]];}
  function salesExample(shop){return [['店铺','商品ID','SKU ID','规格名称','支付订单数','统计周期'],...shop.rows.map((r,i)=>[shop.name,r.productId,r.skuId,'',[42,28,20,15,12,8,5][i%7],'2026-09-01 至 2026-09-18'])];}
  async function simpleWorkbook(rows,name){const book=new X.Workbook(),sheet=book.addWorksheet(name);rows.forEach(row=>sheet.addRow(row));sheet.columns.forEach(c=>c.width=24);sheet.views=[{state:'frozen',ySplit:1}];return book.xlsx.writeBuffer();}
  const api={dimensionCandidates,thicknessCandidates,analyzeProducts,recalculateProducts,productGroups,previewProductReview,applyProductReview,reviewProduct,exportProducts,analyzeSales,applySales,readRows,productExample,integratedProductExample,salesExample,simpleWorkbook};
  if(typeof module==='object')module.exports=api;else root.ReviewImport=api;
})(typeof window==='object'?window:{});
