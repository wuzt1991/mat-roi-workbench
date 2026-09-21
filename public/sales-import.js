(function(root){
'use strict';const M=typeof module==='object'?require('./domain.js'):root.MatModel,R=typeof module==='object'?require('./reusable-rules.js'):root.ReusableRules,MAX=1e12;
const id=v=>typeof v==='string'?v.trim():'';
function fingerprint(plan){return JSON.stringify(plan.items.map(i=>[i.id,i.productId||'',i.skuId||'']).sort((a,b)=>a[0].localeCompare(b[0])));}
function match(plan,row){const product=id(row.productId),sku=id(row.skuId);if(product&&sku){const exact=plan.items.filter(i=>i.productId===product&&i.skuId===sku);if(exact.length===1)return {itemId:exact[0].id};if(exact.length>1)return {error:'商品与 SKU 编号重复'};}if(sku){const candidates=plan.items.filter(i=>i.skuId===sku&&(!product||!i.productId||i.productId===product));if(candidates.length===1)return {itemId:candidates[0].id};}return {itemId:'',error:'请手动绑定 SKU'};}
function allocate(items){const counts=items.map(i=>{if(!Number.isSafeInteger(i.sales)||i.sales<0||i.sales>MAX)throw Error('销量需为非负安全整数');return BigInt(i.sales);}),total=counts.reduce((a,b)=>a+b,0n);if(total<=0n||total>BigInt(MAX))throw Error('总销量需大于 0 且不超过一万亿');const parts=items.map((i,n)=>({id:i.id,bp:counts[n]*10000n/total,remainder:counts[n]*10000n%total})),order=[...parts].sort((a,b)=>a.remainder===b.remainder?(a.id<b.id?-1:a.id>b.id?1:0):(a.remainder>b.remainder?-1:1));let left=10000n-parts.reduce((a,b)=>a+b.bp,0n);for(let i=0;BigInt(i)<left;i++)order[i].bp++;return new Map(parts.map(i=>[i.id,Number(i.bp)/100]));}
function prepare(state,planId,rows,meta={}){const p=state.plans.find(p=>p.id===planId);if(!p)throw Error('计划不存在');return {planId,shopId:p.shopId,skuFingerprint:fingerprint(p),importId:meta.importId||M.uid('sales'),filename:meta.filename||'',period:meta.period||'',basis:meta.basis||'orders',missingPolicy:meta.missingPolicy||'',unitsAcknowledged:!!meta.unitsAcknowledged,matchBy:meta.matchBy,excluded:meta.excluded,additions:M.clone(meta.additions||[]),items:rows.map((r,n)=>({...r,id:r.id||`source-${n}`,count:r.count??r.sales,itemId:r.itemId||match(p,r).itemId,excluded:!!r.excluded}))};}
const sizeKey=(width,height)=>[Number(width),Number(height)].every(n=>Number.isFinite(n)&&n>0&&n<=10000)?[Number(Number(width).toFixed(6)),Number(Number(height).toFixed(6))].sort((a,b)=>a-b).join('×'):'';
const itemSizeKey=(state,item)=>{const size=state.sizes.find(s=>s.id===item.sizeId);if(!size||size.needsReview)return '';const d=M.productionDimensions(size);return sizeKey(d.width,d.height);};
function addImportSizes(state,plan,additions,duplicate){
  if(!Array.isArray(additions)||additions.length>10000)throw Error('待添加尺寸无效');
  if(!additions.length)return [];
  if(!duplicate)R.defaultsValid(state,plan);
  const itemIds=new Set(),dimensions=new Set(),created=[];
  for(const addition of additions){
    const {itemId,sizeId,width,height}=addition,key=sizeKey(width,height);
    if(!key||!id(itemId)||itemIds.has(itemId)||dimensions.has(key))throw Error('待添加尺寸无效或重复');
    itemIds.add(itemId);dimensions.add(key);
    const existing=plan.items.find(i=>i.id===itemId);
    if(existing){if(duplicate&&itemSizeKey(state,existing)===key)continue;throw Error('商品规格已变化，请重新复核');}
    if(duplicate||plan.items.some(i=>itemSizeKey(state,i)===key))throw Error('计划已有此尺寸，请重新匹配');
    let size=state.sizes.find(s=>M.selectable(s)&&M.validSize(s)&&!s.needsReview&&(()=>{const d=M.productionDimensions(s);return sizeKey(d.width,d.height)===key;})());
    if(!size){
      if(!id(sizeId)||state.sizes.some(s=>s.id===sizeId))throw Error('新增尺寸编号冲突，请重新添加');
      size={id:sizeId,name:'',salesW:Number(width),salesH:Number(height),irregular:false,productionW:'',productionH:'',active:true,deleted:false};
      state.sizes.push(size);created.push(M.clone(size));
    }
    plan.items.push({...R.newItem(size.id),id:itemId});
  }
  return created;
}
function apply(state,draft,context={}){
  const s=M.clone(state),p=s.plans.find(x=>x.id===draft.planId),additions=draft.additions||[];
  if(!Array.isArray(additions))throw Error('待添加尺寸无效');
  const duplicate=p?.salesSource?.importId===draft.importId,addedIds=new Set(additions.map(a=>a.itemId));
  const baseFingerprint=p&&duplicate?fingerprint({items:p.items.filter(i=>!addedIds.has(i.id))}):'';
  if(!p||p.shopId!==draft.shopId||(fingerprint(p)!==draft.skuFingerprint&&baseFingerprint!==draft.skuFingerprint)||context.planId&&context.planId!==p.id||['workspaceId','storageEpoch'].some(k=>draft[k]!==undefined&&context[k]!==draft[k]))throw Error('销售候选已过期，请重新复核');
  if(!draft.period?.trim()||!['orders','units'].includes(draft.basis)||draft.basis==='units'&&!draft.unitsAcknowledged)throw Error('请明确统计周期、数量口径及一单一件估算');
  if(additions.length&&draft.matchBy!=='size')throw Error('只有尺寸汇总可以添加规格');
  const before=M.clone(p.items),source=M.clone(p.salesSource),createdSizes=addImportSizes(s,p,additions,duplicate);
  const counts=new Map(),bindings=new Map();let excluded=0;
  for(const row of draft.items){
    if(row.excluded){excluded++;continue;}
    if(!Number.isSafeInteger(row.count)||row.count<0||row.count>MAX||!p.items.some(i=>i.id===row.itemId))throw Error('请处理未匹配或无效销量');
    const count=(counts.get(row.itemId)||0)+row.count;if(!Number.isSafeInteger(count)||count>MAX)throw Error('汇总销量超限');counts.set(row.itemId,count);
    if(row.bind){const value={productId:id(row.productId),skuId:id(row.skuId)},old=bindings.get(row.itemId);if(old&&JSON.stringify(old)!==JSON.stringify(value))throw Error('同一 SKU 存在冲突绑定');bindings.set(row.itemId,value);}
  }
  if(draft.matchBy==='size'){if(!Number.isSafeInteger(draft.excluded)||draft.excluded<0||draft.excluded>10000)throw Error('排除组数无效，请重新复核');excluded=draft.excluded;}
  if(p.items.some(i=>!counts.has(i.id))&&draft.missingPolicy!=='zero')throw Error('请明确未出现的 SKU 按 0 处理');
  const shares=allocate(p.items.map(i=>({id:i.id,sales:counts.get(i.id)||0})));
  if(duplicate){
    const same=source.filename===draft.filename&&source.period===draft.period.trim()&&source.basis===draft.basis&&source.excluded===excluded&&source.missingPolicy===(draft.missingPolicy==='zero'?'zero':'complete')&&!source.editedAfterImport&&p.items.every(i=>i.sales===(counts.get(i.id)||0)&&i.share===shares.get(i.id)&&(!bindings.has(i.id)||(i.productId===bindings.get(i.id).productId&&i.skuId===bindings.get(i.id).skuId)));
    if(!same)throw Error('本次导入已应用且内容已变化，请重新导入销售报表。');return {state:s,duplicate:true,undo:null};
  }
  for(const i of p.items){i.sales=counts.get(i.id)||0;i.share=shares.get(i.id);Object.assign(i,bindings.get(i.id)||{});}
  p.salesSource={filename:draft.filename,period:draft.period.trim(),basis:draft.basis,total:p.items.reduce((n,i)=>n+i.sales,0),excluded,importId:draft.importId,appliedAt:draft.appliedAt||new Date().toISOString(),missingPolicy:draft.missingPolicy==='zero'?'zero':'complete',editedAfterImport:false};
  if(!M.validateBackup(s))throw Error('销售候选或绑定未通过检查');
  return {state:s,undo:{planId:p.id,items:before,source,createdSizes,after:JSON.stringify(p)},duplicate:false};
}
function undo(state,token){
  const s=M.clone(state),p=s.plans.find(x=>x.id===token?.planId);
  if(!p||JSON.stringify(p)!==token.after)throw Error('计划已编辑，不能撤销此次导入');
  p.items=M.clone(token.items);p.salesSource=M.clone(token.source);
  for(const size of token.createdSizes||[]){
    const referenced=s.plans.some(p=>p.items.some(i=>i.sizeId===size.id))||s.sizeSchemes.some(s=>s.sizeIds.includes(size.id));
    if(!referenced)s.sizes=s.sizes.filter(s=>s.id!==size.id||JSON.stringify(s)!==JSON.stringify(size));
  }
  if(!M.validateBackup(s))throw Error('撤销检查失败');return s;
}
function markEdited(plan,field){if(plan.salesSource&&['share','productId','skuId'].includes(field))plan.salesSource.editedAfterImport=true;}
const api={fingerprint,match,allocate,prepare,apply,undo,markEdited};if(typeof module==='object')module.exports=api;else root.SalesImport=api;
})(typeof globalThis==='object'?globalThis:{});
