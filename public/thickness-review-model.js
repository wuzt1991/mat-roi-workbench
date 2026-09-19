(function(root){
  'use strict';
  const clone=v=>structuredClone(v);
  function seed(){const state={version:2,materials:[
    {id:'silica',name:'硅藻泥',rules:[{id:'silica-27',thickness:2.7,coefficient:.9,costPerSqm:9.8},{id:'silica-3',thickness:3,coefficient:1,costPerSqm:9.5},{id:'silica-5',thickness:5,coefficient:1.4,costPerSqm:13}]},
    {id:'linen',name:'亚麻',rules:[{id:'linen-3',thickness:3,coefficient:.9,costPerSqm:8.5},{id:'linen-5',thickness:5,coefficient:1.3,costPerSqm:12}]}
  ],schemes:[
    {id:'auto',name:'标准复核 · 异常人工确认',mode:'auto',defaults:{},deleted:false},
    {id:'defaults',name:'未写厚度 · 按材质默认',mode:'defaults',defaults:{silica:'silica-3',linen:'linen-3'},deleted:false},
    {id:'manual',name:'全部人工确认',mode:'manual',defaults:{},deleted:false}
  ],schemeId:'auto',rows:[
    {id:'r1',name:'硅藻泥吸水地垫',spec:'浅灰 / 40 × 60 cm / 3 mm',sku:'SKU-001',materialId:'silica',dimension:{width:40,length:60},detectedThickness:[3],manualRuleId:null,materialConfirmed:true},
    {id:'r2',name:'硅藻泥浴室地垫',spec:'奶油白 / 50 × 80 cm',sku:'SKU-002',materialId:'silica',dimension:{width:50,length:80},detectedThickness:[],manualRuleId:null,materialConfirmed:true},
    {id:'r3',name:'硅藻泥加厚地垫',spec:'深灰 / 60 × 90 cm / 8 mm',sku:'SKU-003',materialId:'silica',dimension:{width:60,length:90},detectedThickness:[8],manualRuleId:null,materialConfirmed:true},
    {id:'r4',name:'亚麻入户地垫',spec:'原木色 / 50 × 80 cm',sku:'SKU-004',materialId:'linen',dimension:{width:50,length:80},detectedThickness:[],manualRuleId:null,materialConfirmed:true},
    {id:'r5',name:'硅藻泥厨房地垫',spec:'格纹 / 50×120、60×120 cm / 3 mm、5 mm',sku:'SKU-005',materialId:'silica',dimension:{width:50,length:120},detectedThickness:[3,5],manualRuleId:null,materialConfirmed:true},
    {id:'r6',name:'伪亚麻耐磨地垫',spec:'条纹 / 40 × 60 cm / 3 mm',sku:'SKU-006',materialId:'',dimension:{width:40,length:60},detectedThickness:[3],manualRuleId:null,materialConfirmed:false}
  ]};
    state.schemes.forEach(s=>{s.materialMode='auto';s.dimensionMode='auto';});
    state.rows.forEach((r,i)=>Object.assign(r,{platform:'抖音',shopId:'shop-main',shopName:'地垫旗舰店',productId:i<3?'P10001':i===3?'P10002':'P10003',materialSource:'auto',dimensionSource:'auto',dimensionConfirmed:i!==4}));
    state.rows[4].dimensionCandidates=[{width:50,length:120},{width:60,length:120}];
    return state;
  }
  function selectedScheme(state){const s=state.schemes.find(x=>x.id===state.schemeId);if(!s)throw Error('厚度方案不存在');return s;}
  function derive(state){const scheme=selectedScheme(state);return state.rows.map(raw=>{
    const materialStatus=raw.materialConfirmed&&!(scheme.materialMode==='manual'&&raw.materialSource!=='manual')?(raw.materialId===''?'blank':'value'):'pending';
    const dimensionStatus=raw.dimensionConfirmed!==false&&!(scheme.dimensionMode==='manual'&&raw.dimensionSource!=='manual')?(raw.dimension?'value':'blank'):'pending';
    const r={...clone(raw),materialStatus,dimensionStatus,thicknessStatus:'pending',rule:null,ruleId:'',source:'none',status:'pending',reason:'请选择厚度',area:dimensionStatus==='value'?raw.dimension.width*raw.dimension.length/10000:null,weight:null,cost:null};
    const material=state.materials.find(m=>m.id===raw.materialId);
    if(materialStatus==='pending'){r.reason='请先确认材质';return r;}
    if(materialStatus==='blank'||dimensionStatus==='blank'){r.thicknessStatus='blank';r.status=dimensionStatus==='pending'?'pending':'blank';r.reason=dimensionStatus==='pending'?'请确认尺寸':'已留空，无需计算厚度';return r;}
    if(!material){r.reason='材料规则不存在';return r;}
    if(raw.manualRuleId){r.rule=material.rules.find(x=>x.id===raw.manualRuleId)||null;r.source='manual';if(!r.rule){r.reason='已选厚度规则不存在';return r;}}
    else if(scheme.mode==='manual'||raw.forceThicknessReview){r.reason='请人工选择厚度';return r;}
    else{
      const values=[...new Set(raw.detectedThickness)];
      if(values.length>1){r.reason='原文有多个厚度，请确认';return r;}
      if(values.length===1){const candidates=material.rules.filter(x=>x.thickness===values[0]);if(candidates.length!==1){r.reason=candidates.length?'存在多个厚度规则':'未配置 '+values[0]+' mm 规则';return r;}r.rule=candidates[0];r.source='auto';}
      else if(scheme.mode==='defaults'){
        const defaultRule=material.rules.find(x=>x.id===scheme.defaults?.[material.id]);
        if(defaultRule){r.rule=defaultRule;r.source='default';}
        else{r.reason='原文未写厚度，未设默认值';return r;}
      }else{r.reason='原文未写厚度，请选择';return r;}
    }
    r.ruleId=r.rule.id;r.thicknessStatus='value';r.status=dimensionStatus==='pending'?'pending':'ready';r.reason=dimensionStatus==='pending'?'请确认尺寸':r.source==='manual'?'已人工确认':r.source==='default'?'已按默认方案填写':'已自动识别';
    if(dimensionStatus==='value'){r.weight=r.area*r.rule.coefficient;r.cost=r.area*r.rule.costPerSqm;}return r;
  });}
  function getRow(state,id){const row=state.rows.find(r=>r.id===id);if(!row)throw Error('规格不存在');return row;}
  function selectRule(state,rowId,ruleId){const r=getRow(state,rowId),m=state.materials.find(x=>x.id===r.materialId),derived=derive(state).find(x=>x.id===rowId);if(derived.materialStatus!=='value'||!m)throw Error('请先确认材质');if(!m.rules.some(x=>x.id===ruleId))throw Error('请选择该材质已有的厚度规则');r.manualRuleId=ruleId;r.forceThicknessReview=false;}
  function setMaterial(state,rowId,materialId){const r=getRow(state,rowId);if(materialId!==''&&!state.materials.some(x=>x.id===materialId))throw Error('材料不存在');if(r.materialId!==materialId||!r.materialConfirmed){r.manualRuleId=null;r.forceThicknessReview=materialId!=='';}r.materialId=materialId;r.materialConfirmed=true;r.materialSource='manual';}
  function setDimension(state,rowId,dimension){const r=getRow(state,rowId);if(dimension!==null&&(!dimension||!Number.isFinite(dimension.width)||!Number.isFinite(dimension.length)||dimension.width<=0||dimension.length<=0||dimension.width>10000||dimension.length>10000))throw Error('请输入有效尺寸');r.dimension=clone(dimension);r.dimensionConfirmed=true;r.dimensionSource='manual';}
  function groupKey(row){return row.platform&&row.shopId&&row.productId?JSON.stringify([row.platform,row.shopId,row.productId]):'row:'+row.id;}
  function productGroups(state){const map=new Map();for(const r of derive(state)){const key=groupKey(r);if(!map.has(key))map.set(key,{key,productId:r.productId||'',platform:r.platform,shopName:r.shopName,rows:[]});map.get(key).rows.push(r);}return [...map.values()];}
  function previewReview(state,rowIds,patch,overwrite=false){
    const draft=clone(state),ids=new Set(rowIds),counts={material:0,thickness:0,dimension:0},changed=new Set(),protectedRows=new Set(),incompatible=new Set();
    const before=new Map(derive(state).map(r=>[r.id,r]));
    for(const raw of draft.rows){if(!ids.has(raw.id))continue;const old=before.get(raw.id);
      if(patch.material!==undefined){if(overwrite||old.materialStatus==='pending'){setMaterial(draft,raw.id,patch.material);counts.material++;changed.add(raw.id);}else protectedRows.add(raw.id);}
      if(patch.dimension!==undefined){if(overwrite||old.dimensionStatus==='pending'){setDimension(draft,raw.id,patch.dimension);counts.dimension++;changed.add(raw.id);}else protectedRows.add(raw.id);}
      if(patch.thickness!==undefined){const current=derive(draft).find(r=>r.id===raw.id);if(current.materialStatus!=='value'||current.materialId!==patch.thickness.materialId){incompatible.add(raw.id);continue;}if(current.dimensionStatus==='blank'){incompatible.add(raw.id);continue;}if(overwrite||current.thicknessStatus==='pending'){selectRule(draft,raw.id,patch.thickness.ruleId);counts.thickness++;changed.add(raw.id);}else protectedRows.add(raw.id);}
    }
    return {state:draft,counts,changed:changed.size,protected:protectedRows.size,incompatible:incompatible.size};
  }
  function applyReview(state,rowIds,patch,overwrite=false){if(!Object.keys(patch).length)throw Error('请至少选择一项需要修改的内容');const out=previewReview(state,rowIds,patch,overwrite);if(!out.changed)throw Error('没有需要更新的字段，可检查范围或勾选覆盖已确认值');state.rows=out.state.rows;return {...out,state:undefined};}
  function applyBatch(state,rowIds,materialId,ruleId,overwrite=false){const material=state.materials.find(m=>m.id===materialId);if(!material?.rules.some(r=>r.id===ruleId))throw Error('请选择有效的材质和厚度');const ids=new Set(rowIds),targets=derive(state).filter(r=>ids.has(r.id)&&r.materialId===materialId&&r.materialConfirmed&&r.dimension&&(overwrite||r.status==='pending'));if(!targets.length)throw Error('所选范围中没有符合条件的规格');for(const r of targets)selectRule(state,r.id,ruleId);return targets.length;}
  function selectScheme(state,id){if(!state.schemes.some(s=>s.id===id&&!s.deleted))throw Error('方案不存在或已删除');state.schemeId=id;}
  function validateScheme(state,scheme,excludeId){if(!scheme||typeof scheme.id!=='string'||!scheme.id||typeof scheme.name!=='string'||!scheme.name.trim()||scheme.name.trim().length>80)throw Error('请填写 1–80 字的方案名称');if(['materialMode','dimensionMode'].some(k=>scheme[k]!==undefined&&!['auto','manual'].includes(scheme[k])))throw Error('材质或尺寸处理模式无效');if(!['auto','defaults','manual'].includes(scheme.mode))throw Error('处理模式无效');const key=v=>v.normalize('NFKC').replace(/\s/g,'').toLowerCase();if(!scheme.deleted&&state.schemes.some(s=>!s.deleted&&s.id!==(excludeId||scheme.id)&&key(s.name)===key(scheme.name)))throw Error('已有同名方案，请换个名称');if(!scheme.defaults||typeof scheme.defaults!=='object'||Array.isArray(scheme.defaults))throw Error('默认厚度配置无效');for(const [materialId,ruleId] of Object.entries(scheme.defaults)){const material=state.materials.find(m=>m.id===materialId);if(!material||ruleId&&!material.rules.some(r=>r.id===ruleId))throw Error('默认厚度必须来自对应材质的现有规则');}return true;}
  function saveScheme(state,scheme){validateScheme(state,scheme,scheme.id);const saved={materialMode:'auto',dimensionMode:'auto',...clone(scheme),name:scheme.name.trim()},index=state.schemes.findIndex(s=>s.id===saved.id);if(index>=0)state.schemes[index]=saved;else state.schemes.push(saved);return saved;}
  function removeScheme(state,id){const s=state.schemes.find(x=>x.id===id);if(!s)throw Error('方案不存在');s.deleted=true;}
  const api={seed,derive,selectRule,setMaterial,setDimension,applyBatch,groupKey,productGroups,previewReview,applyReview,selectScheme,validateScheme,saveScheme,removeScheme};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ThicknessReview=api;
})(globalThis);
