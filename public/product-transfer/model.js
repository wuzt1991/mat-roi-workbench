(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductTransferModel=api;})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const Recognition=typeof module==='object'&&module.exports?require('../product-recognition.js'):root.ProductRecognition;
  const PAGE_SIZE=100;
  const BLANK='__blank__';
  const CUSTOM='__custom__';
  const KEEP='__keep__';
  const CHOOSE='__choose__';
  const DERIVED='__derived__';
  const INLINE_OPTION_LIMIT=40;
  const REQUIRED_PRODUCT_FIELDS=Recognition.REQUIRED_PRODUCT_FIELDS;
  const TERMINAL_PHASES=new Set(['ready','review','reviewing','completed','complete','done']);
  const WAITING_SHEET_PHASES=new Set(['awaiting-selection','awaiting-sheet','sheet-selection','choose-sheet','mapping']);
  const FAILED_PHASES=new Set(['failed','error','interrupted','cancelled','canceled']);
  const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text=value=>value===undefined||value===null?'':String(value);
  const number=Recognition.number;
  const array=value=>Array.isArray(value)?value:[];
  const active=list=>array(list).filter(item=>item&&!item.deleted&&item.active!==false);
  const mutationId=()=>root.crypto?.randomUUID?.()||`mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const icon=name=>`<i data-lucide="${name}" class="icon" aria-hidden="true"></i>`;
  const truncateId=value=>{const id=text(value);return id.length>10?`${id.slice(0,6)}…${id.slice(-4)}`:id||'未提供商品 ID';};
  const safeMessage=(error,fallback='操作失败，请稍后重试。')=>{
    const message=text(error?.message||error?.error||error);
    return message&&message.length<300?message:fallback;
  };
  const fieldObject=(row,key)=>row?.review?.[key]&&typeof row.review[key]==='object'?row.review[key]:row?.derived?.[key]&&typeof row.derived[key]==='object'?row.derived[key]:{};
  const fieldStatus=(row,key)=>text(fieldObject(row,key).status||row?.review?.[`${key}Status`]||row?.derived?.[`${key}Status`]);
  const fieldId=(row,key)=>text(fieldObject(row,key).id||fieldObject(row,key).value||fieldObject(row,key)[`${key}Id`]||row?.review?.[`${key}Id`]||row?.derived?.[`${key}Id`]);
  const outputIndexes={price:19,salePrice:19,inventory:21,stock:21};
  const rawValue=(row,...keys)=>{for(const key of keys){const raw=!Array.isArray(row?.raw)?row?.raw?.[key]:undefined,value=raw??row?.[key]??row?.derived?.[key]??(outputIndexes[key]!==undefined?row?.derived?.values?.[outputIndexes[key]]:undefined);if(value!==undefined&&value!==null&&value!=='')return value;}return '';};
  const isBlank=(row,key)=>fieldStatus(row,key)==='blank';
  const materialId=row=>fieldId(row,'material');
  const sizeId=row=>fieldId(row,'size');
  const thicknessId=row=>text(fieldObject(row,'thickness').ruleId||row?.review?.materialRuleId||row?.review?.thicknessRuleId||row?.derived?.materialRuleId||row?.derived?.thicknessRuleId);
  const money=value=>number(value)===null?'—':`¥${Number(value).toFixed(2)}`;
  const countValue=(page,key)=>{
    const counts=page?.counts||{};
    if(key==='all'&&Number.isFinite(Number(counts.total)))return Number(counts.total);
    if(Number.isFinite(Number(counts[key])))return Number(counts[key]);
    if(counts.status&&Number.isFinite(Number(counts.status[key])))return Number(counts.status[key]);
    return key==='all'?Number(page?.total||0):0;
  };
  const sizeWidth=size=>size?.irregular?size.productionW:(size?.salesW??size?.width);
  const sizeHeight=size=>size?.irregular?size.productionH:(size?.salesH??size?.length);
  const sizeLabel=size=>text(size?.name)||`${text(sizeWidth(size))} × ${text(sizeHeight(size))} cm`;
  const canonicalRules=state=>({
    materials:array(state?.materials).map(material=>({
      id:material.id,name:material.name,deleted:!!material.deleted,
      weightRules:array(material.weightRules).map(rule=>({
        id:rule.id,thickness:rule.thickness,variant:rule.variant,
        coefficient:rule.coefficient,costPerSqm:rule.costPerSqm,
        default:!!rule.default,deleted:!!rule.deleted
      }))
    })),
    sizes:array(state?.sizes).map(size=>({
      id:size.id,name:size.name,salesW:size.needsReview?'':(size.irregular?size.productionW:size.salesW),salesH:size.needsReview?'':(size.irregular?size.productionH:size.salesH),irregular:false,deleted:!!size.deleted
    }))
  });
  const thicknessLabel=rule=>{
    const parts=[];
    if(rule?.thickness!==''&&rule?.thickness!==undefined&&rule?.thickness!==null)parts.push(`${rule.thickness} mm`);
    if(text(rule?.variant))parts.push(text(rule.variant));
    return parts.join(' · ')||'标准厚度';
  };
  const normalizeGroupMap=page=>new Map(array(page?.groups).map(group=>[text(group.groupId),group]));
  const currentMaterial=(group,rows)=>{const state=group?.materialState,groupValue=typeof state==='string'&&!['mixed','pending','blank','blocked'].includes(state)?state:group?.materialId||state?.id||state?.value;return text(groupValue||(rows.length&&new Set(rows.map(materialId)).size===1?materialId(rows[0]):''));};

  function rowPatch(row,{material,rule,width,length}){
    const size=fieldObject(row,'size'),patch={};width=number(width);length=number(length);
    if(!material||!rule)throw Error('请选择材质和厚度。');
    if(material!==materialId(row))patch.material={mode:'value',id:material};
    if(material!==materialId(row)||rule!==thicknessId(row))patch.thickness={mode:'value',materialId:material,ruleId:rule};
    if(width!==number(size.width)||length!==number(size.length)||size.status==='pending'){
      if(!(width>0&&length>0&&width<=10000&&length<=10000))throw Error('请输入有效尺寸，宽和长需在 0–10000 cm 之间。');
      patch.size={mode:'value',width,length};
    }
    return patch;
  }
  function groupPatch(group,{material,thickness}){
    const patch={},effective=material===KEEP?group.materialState:material;
    if(material!==KEEP){if(!material||!thickness||thickness===KEEP)throw Error('统一材质时，请同时选择对应厚度。');patch.material={mode:'value',id:material};}
    if(thickness&&thickness!==KEEP)patch.thickness={mode:'value',materialId:effective,ruleId:thickness};
    if(!Object.keys(patch).length)throw Error('请选择需要统一的材质或厚度。');
    return patch;
  }
  return {rowPatch,groupPatch,Recognition,PAGE_SIZE,BLANK,CUSTOM,KEEP,CHOOSE,DERIVED,INLINE_OPTION_LIMIT,REQUIRED_PRODUCT_FIELDS,TERMINAL_PHASES,WAITING_SHEET_PHASES,FAILED_PHASES,htmlEscape,text,number,array,active,mutationId,icon,truncateId,safeMessage,fieldObject,fieldStatus,fieldId,outputIndexes,rawValue,isBlank,materialId,sizeId,thicknessId,money,countValue,sizeWidth,sizeHeight,sizeLabel,canonicalRules,thicknessLabel,normalizeGroupMap,currentMaterial};
});
