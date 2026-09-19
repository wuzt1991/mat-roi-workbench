(function(root){
  'use strict';

  const Excel = typeof module === 'object' ? require('./assets/exceljs.min.js') : root.ExcelJS;
  const Recognition = typeof module === 'object' ? require('./product-recognition.js') : root.ProductRecognition;

  const HEADERS = ['序号','平台','店铺','平台商品名称','平台规格名称','品牌','商品标签','尺寸','平米数','宽','长','重量','成本价','商家编码旧','主条码','平台商品编码','平台商家编码','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存','规格类型','货品名称','货品编码','货品简称','规格名称','商家编码（新）','规格简称'];
  const FIELD_ALIASES = {
    seq:['序号','编号','行号'], platform:['平台'], shop:['店铺','店铺名称'], productName:['平台商品名称','商品名称'], specName:['平台规格名称','规格名称','商品规格名称'],
    productCode:['平台商品编码','商品编码'], merchantCode:['平台商家编码','商家编码'], productId:['平台商品ID','商品ID'], specId:['平台规格ID','规格ID'], price:['平台售价','售价','价格'], status:['售卖状态','销售状态'], inventory:['平台库存','库存'],
    specType:['规格类型'], goodsName:['货品名称'], goodsCode:['货品编码'], goodsShort:['货品简称'], goodsSpec:['规格名称'], merchantNew:['商家编码（新）','商家编码'], specShort:['规格简称']
  };
  const WEIGHT_RULES = [
    {material:'硅藻泥', thickness:2.7, coefficient:0.83, default:false}, {material:'硅藻泥', thickness:3, coefficient:0.9, default:true}, {material:'硅藻泥', thickness:5, coefficient:1.3, default:false},
    {material:'亚麻', thickness:3.5, coefficient:0.96, default:false}, {material:'亚麻', thickness:5, coefficient:1.26, default:true},
    {material:'水晶绒', coefficient:0.65, default:true}, {material:'水晶绒', variant:'包边', coefficient:0.7, default:false},
    {material:'丝圈', coefficient:2.8, default:true}, {material:'皮革', thickness:3.5, coefficient:1.3, default:true}, {material:'仿羊绒', coefficient:1.45, default:true},
    {material:'冰藤', thickness:4.15, coefficient:1.2, default:true}, {material:'冰丝', thickness:3.36, coefficient:0.95, default:true}, {material:'冰丝水洗底', thickness:1.9, coefficient:1, default:true},
    {material:'菠萝圈', coefficient:1.25, default:true}, {material:'天鹅绒', coefficient:0.85, default:true}, {material:'金钻绒', coefficient:0.8, default:true}, {material:'圈绒', thickness:8, coefficient:2.6, default:true}
  ];
  const MATERIAL_ALIASES = {'包边水晶绒':'水晶绒','冰丝水洗底':'冰丝水洗底','水晶绒':'水晶绒','硅藻泥':'硅藻泥','仿亚麻':'亚麻','亚麻':'亚麻','菠萝圈':'菠萝圈','丝圈':'丝圈','皮革':'皮革','仿羊绒':'仿羊绒','冰藤':'冰藤','冰丝':'冰丝','天鹅绒':'天鹅绒','金钻绒':'金钻绒','圈绒':'圈绒'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const DEFAULT_RULES = {
    version: 1,
    materials: {
      '硅藻泥': {weightPerSqm: 0.9, costPerSqm: 9.8},
      '亚麻': {weightPerSqm: 1.26, costPerSqm: 16.2}, '水晶绒': {weightPerSqm: 0.65, costPerSqm: 8}, '丝圈': {weightPerSqm: 2.8, costPerSqm: 21}, '皮革': {weightPerSqm: 1.3, costPerSqm: 15}, '仿羊绒': {weightPerSqm: 1.45, costPerSqm: 17}, '冰藤': {weightPerSqm: 1.2, costPerSqm: 18}, '冰丝': {weightPerSqm: 0.95, costPerSqm: 17}, '冰丝水洗底': {weightPerSqm: 1, costPerSqm: 18}, '菠萝圈': {weightPerSqm: 1.25, costPerSqm: 19.5}, '天鹅绒': {weightPerSqm: 0.85, costPerSqm: 12.5}, '金钻绒': {weightPerSqm: 0.8, costPerSqm: 11.5}, '圈绒': {weightPerSqm: 2.6, costPerSqm: 18.5}
    },
    fallback: {weightPerSqm: 0.9, costPerSqm: 9.8},
    keywords: ['包边水晶绒','冰丝水洗底','硅藻泥','菠萝圈','水晶绒','天鹅绒','丝圈','仿羊绒','仿亚麻','亚麻','皮革','金钻绒','冰藤','冰丝','圈绒'],
    weightRules: clone(WEIGHT_RULES)
  };
  const text = value => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      if ('result' in value) return text(value.result);
      if (Array.isArray(value.richText)) return value.richText.map(x => x.text || '').join('');
      if ('text' in value) return text(value.text);
    }
    return String(value).trim();
  };
  const normalized = value => text(value).replace(/[\s\u3000]/g,'').replace(/[（）()]/g,'').toLowerCase();
  const number = value => {
    if(text(value)===''||typeof value==='boolean')return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const n = Number(String(value ?? '').replace(/,/g,'').trim());
    return Number.isFinite(n) ? n : null;
  };
  const MAX_VALUE=1e12;
  const MAX_FILE_BYTES=15*1024*1024,MAX_ROWS=5000,MAX_COLUMNS=200;
  function checkFileSize(bytes){if((bytes?.byteLength??bytes?.length??0)>MAX_FILE_BYTES)throw Object.assign(Error('ERP 文件超过 15 MB，请拆分后导入'),{code:'IMPORT_LIMIT'});}
  const validValue=v=>number(v)!==null&&number(v)>=0&&number(v)<=MAX_VALUE;
  const validDimension=v=>number(v)!==null&&number(v)>0&&number(v)<=10000;
  function numericIssues(values){return [['price',19],['inventory',21]].flatMap(([field,index])=>validValue(values[index])?[]:[{code:'INVALID_NUMBER',field,message:`${FIELD_ALIASES[field][0]}需为 0 至 ${MAX_VALUE} 的有限数字`}]);}
  function withMaterialSuffix(value,material){
    const source=text(value);if(!source||!material)return source;
    const escaped=text(material).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const trailing=new RegExp(`[【（(]${escaped}[】）)]$`);
    return trailing.test(source) ? source.replace(trailing,`【${material}】`) : `${source}【${material}】`;
  }
  function replaceMaterialSuffix(value,previousMaterial,material){
    let source=text(value),previous=text(previousMaterial);
    if(previous&&previous!==material){
      const escaped=previous.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      source=source.replace(new RegExp(`[【（(]${escaped}[】）)]$`),'');
    }
    return withMaterialSuffix(source,material);
  }

  function defaultRules(){ return clone(DEFAULT_RULES); }
  function normalizeRules(input){
    const rules = {...defaultRules(), ...(input || {})};
    rules.materials = {...DEFAULT_RULES.materials, ...(input?.materials || {})};
    rules.fallback = {...DEFAULT_RULES.fallback, ...(input?.fallback || {})};
    rules.keywords = [...new Set([...(input?.keywords || []), ...DEFAULT_RULES.keywords])];
    const source = Array.isArray(input?.weightRules) ? input.weightRules : DEFAULT_RULES.weightRules;
    const seen = new Set();
    rules.weightRules = source.map(clone).filter(rule=>{
      const material=text(rule.material), variant=text(rule.variant), thickness=rule.thickness===''||rule.thickness===undefined?'':number(rule.thickness);
      const coefficient=number(rule.coefficient);
      if(!material || coefficient===null || coefficient<0)return false;
      const key=`${normalized(material)}|${normalized(variant)}|${thickness}`;
      if(seen.has(key))return false;
      seen.add(key);rule.material=material;rule.variant=variant;rule.thickness=thickness;rule.coefficient=coefficient;return true;
    });
    return rules;
  }
  function detectHeaderRow(rows, expected=HEADERS){
    let best={rowIndex:-1,score:0,headers:[]};
    rows.slice(0,40).forEach((row,rowIndex)=>{
      const values=row.map(text), expectedSet=new Set(expected.map(normalized));
      const score=values.reduce((sum,v)=>sum+(expectedSet.has(normalized(v))?1:0),0);
      if(score>best.score)best={rowIndex,score,headers:values};
    });
    if(best.rowIndex<0 || best.score<3) throw Error('未识别到有效表头，请确认 Excel 包含商品字段');
    return best;
  }
  function mapFields(headers){
    const used={};
    const normalizedHeaders=headers.map(normalized);
    for(const [field,aliases] of Object.entries(FIELD_ALIASES)){
      const matches=[];
      for(const alias of aliases){const i=normalizedHeaders.indexOf(normalized(alias));if(i>=0&&!matches.includes(i))matches.push(i);}
      if(matches.length) used[field]=matches[0];
    }
    return used;
  }
  const dimensionPattern=/(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?\s*(?:\*|x|-)+\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?/i;
  const dimensionText=input=>text(input).normalize('NFKC').replace(/[＊×✕✖乘至到]/g,'*').replace(/[－–—]/g,'-');
  function parseDimensions(input){
    const raw=dimensionText(input),pair=raw.match(dimensionPattern);
    const factors={mm:.1,'毫米':.1,cm:1,'厘米':1,'公分':1,m:100,'米':100};
    let values;
    if(pair){const u1=(pair[2]||pair[4]||'cm').toLowerCase(),u2=(pair[4]||pair[2]||'cm').toLowerCase();values=[Number(pair[1])*factors[u1],Number(pair[3])*factors[u2]];}
    else {const tokens=[...raw.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|公分|米)?/ig)].slice(0,2),unit=tokens.findLast(x=>x[2])?.[2]||'cm';values=tokens.map(x=>Number(x[1])*factors[(x[2]||unit).toLowerCase()]);}
    if(values.length<2||!values.every(validDimension))return {ok:false,raw,reason:'长宽需为大于 0、不超过 10000 cm 的数字'};
    const [width,length]=values;
    return {ok:true,width,length,label:`${width}*${length}`,area:width*length/10000,raw};
  }
  function resolveWeightRule(material,source,rules=DEFAULT_RULES){
    const candidates=(rules.weightRules||WEIGHT_RULES).filter(x=>x.material===material);
    const thicknessMatch=dimensionText(source).replace(dimensionPattern,' ').match(/(\d+(?:\.\d+)?)\s*毫米|(?:^|[^\d])(\d+(?:\.\d+)?)\s*mm/i);
    const thickness=thicknessMatch?number(thicknessMatch[1]||thicknessMatch[2]):null;
    const variants=candidates.filter(x=>x.variant&&normalized(source).includes(normalized(x.variant))).sort((a,b)=>b.variant.length-a.variant.length);
    const variant=variants.find(x=>thickness!==null&&number(x.thickness)===thickness)||variants.find(x=>x.thickness===''||x.thickness===undefined)||variants.find(x=>x.default)||variants[0];
    if(variant)return {...variant,source:'包边变体'};
    if(thickness!==null){const exact=candidates.find(x=>!x.variant&&number(x.thickness)!==null&&Math.abs(number(x.thickness)-thickness)<0.011);if(exact)return {...exact,source:`厚度 ${thickness}mm`};}
    const fallback=candidates.find(x=>!x.variant&&x.default) || candidates.find(x=>!x.variant);
    return fallback ? {...fallback,source:'默认规则'} : null;
  }
  function identifyMaterial(productName,specName,rules=DEFAULT_RULES){
    const source=`${text(productName)} ${text(specName)}`;
    const keywords=[...(rules.keywords || DEFAULT_RULES.keywords)].sort((a,b)=>text(b).length-text(a).length);
    // “仿亚麻” is a descriptive alias for 亚麻, but a title that also
    // contains 硅藻泥 must be classified as 硅藻泥 for the output suffix.
    const keyword=source.includes('硅藻泥') ? '硅藻泥' : keywords.find(k=>source.includes(k));
    if(!keyword)return {ok:false,name:'',reason:'未识别材质，请选择规则'};
    const name=MATERIAL_ALIASES[keyword]||keyword, known=rules.materials && rules.materials[name], weightRule=resolveWeightRule(name,source,rules);
    if(!weightRule || number(weightRule.coefficient)===null || number(weightRule.coefficient)<0)return {ok:false,name,reason:`材质“${name}”没有有效重量规则`};
    return {ok:true,name,rule:known||{weightPerSqm:weightRule.coefficient,costPerSqm:null},weightRule,reason:`命中关键词：${keyword}（${weightRule.source}）`};
  }
  function sourceRowsFromSheet(sheet){
    if(sheet.rowCount>MAX_ROWS+40||sheet.columnCount>MAX_COLUMNS)throw Object.assign(Error('ERP 数据超过 5000 行或 200 列，请拆分后导入'),{code:'IMPORT_LIMIT'});
    const rows=[];sheet.eachRow({includeEmpty:true},row=>rows.push(row.values.slice(1).map(text)));return rows;
  }
  function readWorkbook(bytes){
    checkFileSize(bytes);
    if(!Excel) throw Error('Excel 组件未加载');
    const book=new Excel.Workbook();
    return book.xlsx.load(bytes).then(()=>book);
  }
  async function readWorkbookRows(bytes,role){
    const book=await readWorkbook(bytes);
    let chosen=null,detected=null;
    for(const sheet of book.worksheets){
      const rows=sourceRowsFromSheet(sheet);
      try{const d=detectHeaderRow(rows,role==='template'?HEADERS:Object.values(FIELD_ALIASES).flat());if(!detected||d.score>detected.score){chosen=sheet;detected=d;}}
      catch{}
    }
    if(!chosen)throw Error(role==='template'?'模板中未找到 29 列表头':'ERP 文件中未找到商品表头');
    return {book,sheet:chosen,rows:sourceRowsFromSheet(chosen),header:detected};
  }
  function transformRows(sourceRows, options={}){
    if(sourceRows.length>MAX_ROWS+40)throw Object.assign(Error('ERP 数据超过 5000 行，请拆分后导入'),{code:'IMPORT_LIMIT'});
    const rules=normalizeRules(options.rules), header=options.header || detectHeaderRow(sourceRows,Object.values(FIELD_ALIASES).flat()), map=options.map || mapFields(header.headers);
    const exceptions=[], rows=[];
    const required=['shop','productName','specName','productId','specId','price','status','inventory'];
    sourceRows.slice(header.rowIndex+1).forEach((raw,offset)=>{
      if(raw.every(v=>text(v)===''))return;
      if(rows.length>=MAX_ROWS)throw Object.assign(Error('ERP 数据超过 5000 行，请拆分后导入'),{code:'IMPORT_LIMIT'});
      const rowNumber=header.rowIndex+offset+2, get=field=>map[field]===undefined?'':raw[map[field]];
      const productName=text(get('productName')), sourceSpecName=text(get('specName'));
      const material=identifyMaterial(productName,sourceSpecName,rules), dimensions=parseDimensions(sourceSpecName);
      const specName=withMaterialSuffix(sourceSpecName,material.name);
      const rowExceptions=[];
      required.forEach(field=>{if(text(get(field))==='')rowExceptions.push({code:'MISSING_FIELD',field,message:`缺少${FIELD_ALIASES[field]?.[0]||field}`});});
      if(!material.ok)rowExceptions.push({code:'MATERIAL',message:material.reason});
      if(!dimensions.ok)rowExceptions.push({code:'DIMENSION',message:dimensions.reason});
      // A matched child rule is authoritative for both weight and cost.
      const rule=material.weightRule ? {...(material.rule||{}),weightPerSqm:material.weightRule.coefficient,costPerSqm:material.weightRule.costPerSqm ?? material.rule?.costPerSqm} : (material.rule || rules.fallback), weightCoefficient=material.weightRule?.coefficient ?? rule?.weightPerSqm;
      if(number(weightCoefficient)===null || number(weightCoefficient)<0)rowExceptions.push({code:'RULE',message:'缺少有效重量规则'});
      const area=dimensions.ok?dimensions.area:null;
      const weight=area!==null&&number(weightCoefficient)!==null?area*number(weightCoefficient):'';
      const cost=area!==null&&rule&&number(rule.costPerSqm)!==null?area*number(rule.costPerSqm):'';
      if(!validValue(rule?.costPerSqm))rowExceptions.push({code:'RULE',message:'请在材料库填写有效的非负规则成本'});
      const out=Array(29).fill('');
      const put=(i,v)=>{out[i]=v===undefined||v===null?'':v;};
      put(0,number(get('seq')) ?? (rows.length+1));put(1,text(get('platform')));put(2,text(get('shop')));put(3,productName);put(4,specName);put(5,material.name);put(6,material.name);put(7,dimensions.ok?dimensions.label:'');put(8,area??'');put(9,dimensions.ok?dimensions.width:'');put(10,dimensions.ok?dimensions.length:'');put(11,weight);put(12,cost);
      put(13,'');put(14,'');put(15,text(get('productCode')));put(16,text(get('merchantCode')));put(17,text(get('productId')));put(18,text(get('specId')));put(19,number(get('price'))??text(get('price')));put(20,text(get('status')));put(21,number(get('inventory'))??text(get('inventory')));put(22,text(get('specType')));put(23,specName);put(24,text(get('goodsCode')));put(25,text(get('goodsShort')));put(26,specName);put(27,text(get('specId')));put(28,text(get('specShort')));
      const ids=[17,18,27];ids.forEach(i=>{if(out[i]!==''&&out[i]!==null)out[i]=String(out[i]);});
      rowExceptions.push(...numericIssues(out));
      if(rowExceptions.length)exceptions.push({rowNumber,source:raw.slice(),output:out.slice(),issues:rowExceptions,reviewed:false});
      rows.push({rowNumber,values:out,material:material.name,dimensions,area,weight,cost,issues:rowExceptions});
    });
    return {headers:HEADERS.slice(),rows,exceptions,sourceHeader:header.headers.slice(),map,rules,summary:{sourceRows:rows.length,exceptionRows:exceptions.length,ready:exceptions.length===0}};
  }
  function applyReviews(result,reviews={}){
    const next=clone(result);
    next.exceptions=[];
    next.rows.forEach(row=>{
      const patch=reviews[row.rowNumber];
      if (patch) {
        if (patch.material) {
          const previousMaterial=row.values[5];
          row.values[5] = row.values[6] = patch.material;
          // Keep every name field in the fixed template consistent with the
          // reviewed material, including the required 【材质】 suffix.
          row.values[4] = replaceMaterialSuffix(row.values[4],previousMaterial,patch.material);
          row.values[23] = row.values[26] = row.values[4];
        }
        for(const [field,index] of [['width',9],['length',10],['price',19],['inventory',21]])if(patch[field]!==undefined)row.values[index]=number(patch[field])??text(patch[field]);
        if(patch.productId!==undefined)row.values[17]=text(patch.productId);
        if(patch.specId!==undefined)row.values[18]=text(patch.specId);
        row.values[27]=row.values[18];
        if (row.values[9] && row.values[10]) {
          row.values[7] = `${row.values[9]}*${row.values[10]}`;
          row.values[8] = row.values[9] * row.values[10] / 10000;
          const rule = next.rules?.materials?.[row.values[5]];
          const weightRule = resolveWeightRule(row.values[5], `${row.values[3]} ${row.values[4]}`, next.rules);
          if (weightRule) row.values[11] = row.values[8] * number(weightRule.coefficient);
          const unitCost=weightRule?.costPerSqm??rule?.costPerSqm;
          row.values[12]=validValue(unitCost)?row.values[8]*number(unitCost):'';
        }
        row.reviewed = true;
      }
      const unresolved=[];
      const reviewRule=resolveWeightRule(row.values[5],`${row.values[3]} ${row.values[4]}`,next.rules);
      if(!row.values[5] || !reviewRule || number(reviewRule.coefficient)===null || number(reviewRule.coefficient)<0)unresolved.push({code:'MATERIAL',message:'材质没有可用重量规则'});
      if(![row.values[9],row.values[10]].every(validDimension))unresolved.push({code:'DIMENSION',message:'长宽需为大于 0、不超过 10000 cm 的数字'});
      if(!validValue(reviewRule?.costPerSqm??next.rules?.materials?.[row.values[5]]?.costPerSqm))unresolved.push({code:'RULE',message:'请在材料库填写有效的非负规则成本'});
      unresolved.push(...numericIssues(row.values));
      if(!row.values[17] || !row.values[18])unresolved.push({code:'ID',message:'商品 ID 或规格 ID 不能为空'});
      for(const [field,index] of [['shop',2],['productName',3],['specName',4],['status',20]])if(!text(row.values[index]))unresolved.push({code:'MISSING_FIELD',field,message:`缺少${FIELD_ALIASES[field][0]}`});
      row.material=row.values[5];row.area=row.values[8];row.weight=row.values[11];row.cost=row.values[12];row.issues=unresolved;
      row.dimensions={ok:[row.values[9],row.values[10]].every(validDimension),width:row.values[9],length:row.values[10],label:row.values[7],area:row.values[8],raw:row.dimensions?.raw};
      if(unresolved.length)next.exceptions.push({rowNumber:row.rowNumber,source:row.source,output:row.values.slice(),issues:unresolved,reviewed:!!row.reviewed});
    });
    next.summary.exceptionRows=next.exceptions.length;next.summary.ready=next.exceptions.length===0;return next;
  }
  function applyBatchReviews(result,reviews={}){
    const groups=new Map(), conflicts=new Set();
    result.rows.forEach(row=>{
      const productId=text(row.values?.[17]);
      if(!productId)return;
      if(!groups.has(productId))groups.set(productId,[]);
      groups.get(productId).push(row);
    });
    const merged={};
    for(const [productId,rows] of groups){
      const materials=[...new Set(rows.map(row=>text(reviews[row.rowNumber]?.material)||text(row.values?.[5])).filter(Boolean))];
      if(materials.length>1){rows.forEach(row=>conflicts.add(row.rowNumber));continue;}
      if(materials.length===1){
        rows.filter(row=>row.issues?.length||reviews[row.rowNumber]).forEach(row=>{merged[row.rowNumber]={...(reviews[row.rowNumber]||{}),material:materials[0]};});
      }
    }
    const next=applyReviews(result,merged);
    if(conflicts.size){
      next.exceptions=next.exceptions.filter(x=>!conflicts.has(x.rowNumber));
      result.rows.filter(row=>conflicts.has(row.rowNumber)).forEach(row=>next.exceptions.push({rowNumber:row.rowNumber,source:row.source,output:row.values.slice(),issues:[{code:'REVIEW_CONFLICT',message:'同商品组内材质不一致，请只保留一个材质'}],reviewed:false}));
      next.exceptions.sort((a,b)=>a.rowNumber-b.rowNumber);
      next.summary.exceptionRows=next.exceptions.length;next.summary.ready=next.exceptions.length===0;
    }
    return next;
  }
  // Build the product-level review rows shown by the UI. Material review is
  // shared by every SKU under the same platform product ID, while dimension,
  // ID and price issues still need the individual SKU row below it.
  function exceptionGroups(result){
    const rowByNumber=new Map((result?.rows||[]).map(row=>[row.rowNumber,row]));
    const materialCodes=new Set(['MATERIAL','RULE','REVIEW_CONFLICT']);
    const allByProduct=new Map();
    for(const row of result?.rows||[]){
      const productId=text(row.values?.[17]);
      if(!productId)continue;
      if(!allByProduct.has(productId))allByProduct.set(productId,[]);
      allByProduct.get(productId).push(row);
    }
    const grouped=new Map(), ungrouped=[];
    for(const exception of result?.exceptions||[]){
      const row=rowByNumber.get(exception.rowNumber), output=row?.values||exception.output||[];
      const productId=text(output[17]),issues=exception.issues||[],materialIssues=issues.filter(issue=>materialCodes.has(issue.code)),rowIssues=issues.filter(issue=>!materialCodes.has(issue.code));
      if(productId&&materialIssues.length){
        if(!grouped.has(productId))grouped.set(productId,{kind:'product',productId,rows:allByProduct.get(productId)||[],exceptions:[],rowNumbers:[],material:'',productName:'',specNames:[]});
        const group=grouped.get(productId),materialException={...exception,issues:materialIssues};group.exceptions.push(materialException);group.rowNumbers.push(exception.rowNumber);
        group.productName=group.productName||text(output[3]);if(text(output[4])&&!group.specNames.includes(text(output[4])))group.specNames.push(text(output[4]));
        const material=text(output[5]);if(material&&!group.material)group.material=material;
      }
      if(!productId||rowIssues.length||!materialIssues.length){
        const visibleException=productId&&materialIssues.length?{...exception,issues:rowIssues}:exception;
        ungrouped.push({kind:'row',rowNumber:exception.rowNumber,exception:visibleException,row,materialEditable:!productId&&materialIssues.length>0});
      }
    }
    const products=[...grouped.values()].map(group=>{for(const row of group.rows){const value=text(row.values?.[4]);if(value&&!group.specNames.includes(value))group.specNames.push(value);if(!group.productName)group.productName=text(row.values?.[3]);if(!group.material){const material=text(row.values?.[5]);if(material)group.material=material;}}return {...group,skuCount:group.rows.length,issueText:[...new Set(group.exceptions.flatMap(x=>(x.issues||[]).map(issue=>issue.message)))].join('；')};});
    return {products,rows:ungrouped};
  }
  function applyProductReview(result,productId,patch={}){
    const target=text(productId),reviews={};
    (result?.rows||[]).forEach(row=>{if(text(row.values?.[17])===target)reviews[row.rowNumber]={...patch};});
    return applyReviews(result,reviews);
  }
  function staticize(value){return value && typeof value==='object' && 'result' in value ? staticize(value.result) : value;}
  function copyStyle(target,source){target.style=clone(source.style||{});if(source.numFmt)target.numFmt=source.numFmt;target.alignment=clone(source.alignment||{});}
  async function exportWorkbook(templateBytes,result,options={}){
    if(!result || !result.summary?.ready || result.exceptions?.length)throw Error('仍有未解决异常，禁止导出');
    if(!applyReviews(result).summary.ready)throw Error('仍有未解决异常，禁止导出');
    const template=await readWorkbook(templateBytes), sheet=template.worksheets[0];
    const total=result.rows.length+1, originalRows=Math.max(1,sheet.rowCount-1);
    // The bundled ExcelJS leaves a multi-row deletion at EOF untouched.
    // Remove each final row so no shared-formula children survive the export.
    for(let r=sheet.rowCount;r>total;r--)sheet.spliceRows(r,1);
    for(let r=2;r<=total;r++){
      const source=sheet.getRow(2+((r-2)%originalRows)), target=sheet.getRow(r);target.height=source.height;
      for(let c=1;c<=HEADERS.length;c++)copyStyle(target.getCell(c),source.getCell(c));
      const vals=result.rows[r-2].values.map(staticize);
      for(let c=1;c<=HEADERS.length;c++)target.getCell(c).value=vals[c-1] ?? '';
      [18,19,28].forEach(c=>{if(target.getCell(c).value!=='')target.getCell(c).value=String(target.getCell(c).value);});
    }
    const header=sheet.getRow(1);for(let c=1;c<=HEADERS.length;c++)header.getCell(c).value=HEADERS[c-1];
    sheet.autoFilter={from:'A1',to:{row:total,column:HEADERS.length}};sheet.views=[{state:'frozen',ySplit:1}];
    return template.xlsx.writeBuffer();
  }
  async function analyze(templateBytes,sourceBytes,options={}){
    const template=await readWorkbookRows(templateBytes,'template'), source=await readWorkbookRows(sourceBytes,'source');
    const result=transformRows(source.rows,{...options,header:source.header});result.templateHeader=template.header.headers;result.templateRows=template.rows.length-template.header.rowIndex-1;result.rules=normalizeRules(options.rules);return result;
  }
  function saveScheme(storage,name,rules){
    if(!storage || !name)throw Error('规则方案名称不能为空');const all=JSON.parse(storage.getItem('mat-product-rule-schemes')||'{}');all[name]={name,updatedAt:new Date().toISOString(),rules:normalizeRules(rules)};storage.setItem('mat-product-rule-schemes',JSON.stringify(all));return all[name];
  }
  function loadSchemes(storage){return storage?JSON.parse(storage.getItem('mat-product-rule-schemes')||'{}'):{};}
  const api={MAX_VALUE,MAX_FILE_BYTES,MAX_ROWS,MAX_COLUMNS,checkFileSize,HEADERS,FIELD_ALIASES,WEIGHT_RULES:clone(WEIGHT_RULES),defaultRules:defaultRules,normalizeRules,detectHeaderRow,mapFields,parseDimensions,identifyMaterial,resolveWeightRule,transformRows,applyReviews,applyBatchReviews,exceptionGroups,applyProductReview,readWorkbookRows,analyze,exportWorkbook,exportProductWorkbook:exportWorkbook,convert:analyze,saveScheme,loadSchemes,deriveTransferRow:Recognition?.deriveTransferRow,previewTransferRowPatch:Recognition?.previewTransferRowPatch,recognition:Recognition};
  if(typeof module==='object')module.exports=api;else root.MatProductTransfer=api;
})(typeof window==='object'?window:{ });
