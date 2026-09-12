(function(root){
  'use strict';
  const M=typeof module==='object'?require('./domain.js'):root.MatModel;
  const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,JSON.parse(canonical(v[k]))])):v);
  const same=(a,b)=>canonical(a)===canonical(b);
  function select(state,scope={mode:'all'}){
    if(scope.mode==='all'){const full=M.clone(state);delete full.exportScope;return full;}
    const {shopIds=[],planIds=[],from='',to=''}=scope;
    if(from&&!M.validDate(from)||to&&!M.validDate(to)||from&&to&&from>to)throw Error('开始日期不能晚于结束日期，请检查日期范围');
    if(!shopIds.length)throw Error('请至少选择一家店铺');
    const shops=state.shops.filter(s=>shopIds.includes(s.id)),plans=state.plans.filter(p=>shopIds.includes(p.shopId)&&planIds.includes(p.id));
    if(!shops.length)throw Error('所选店铺不存在');
    const selected=new Set(plans.map(p=>p.id)),matched=state.records.filter(h=>selected.has(h.planId)&&(!from||h.date>=from)&&(!to||h.date<=to));
    const ids=new Set(matched.map(h=>h.id)),related=new Map(state.records.map(h=>[h.id,h]));
    const queue=[...matched];for(let i=0;i<queue.length;i++)for(const id of [queue[i].previousId,queue[i].replacedBy])if(id&&!ids.has(id)){const h=related.get(id);if(!h||h.planId!==queue[i].planId)throw Error('更正记录不完整，暂时无法导出');ids.add(id);queue.push(h);}
    const materials=state.materials.filter(m=>plans.some(p=>p.materialId===m.id)),shippingTemplates=state.shippingTemplates.filter(t=>plans.some(p=>p.shippingId===t.id));
    // Empty shops still need a default material and freight rule to create a plan after restoration.
    if(!materials.length)materials.push(state.materials[0]);if(!shippingTemplates.length)shippingTemplates.push(state.shippingTemplates[0]);
    const result=M.clone({...state,shops,plans,materials,shippingTemplates,sizes:state.sizes.filter(s=>plans.some(p=>p.items.some(i=>i.sizeId===s.id))),records:state.records.filter(h=>ids.has(h.id)),activeShop:shops[0].id,active:plans.find(p=>p.shopId===shops[0].id&&!p.deleted)?.id||'',exportScope:{mode:'scoped',shopIds:shops.map(s=>s.id),planIds:plans.map(p=>p.id),from,to,matchedIds:matched.map(h=>h.id),relatedIds:[...ids].filter(id=>!matched.some(h=>h.id===id))}});
    if(!M.validateBackup(result))throw Error('所选数据未通过检查，暂时无法导出');return result;
  }
  function validScope(s){
    const x=s.exportScope;if(!x)return true;
    return x.mode==='scoped'&&Array.isArray(x.shopIds)&&Array.isArray(x.planIds)&&same([...x.shopIds].sort(),s.shops.map(v=>v.id).sort())&&same([...x.planIds].sort(),s.plans.map(v=>v.id).sort())&&(!x.from||M.validDate(x.from))&&(!x.to||M.validDate(x.to))&&(!x.from||!x.to||x.from<=x.to)&&Array.isArray(x.matchedIds)&&Array.isArray(x.relatedIds)&&same([...x.matchedIds,...x.relatedIds].sort(),s.records.map(h=>h.id).sort())&&s.records.every(h=>x.matchedIds.includes(h.id)===((!x.from||h.date>=x.from)&&(!x.to||h.date<=x.to)));
  }
  function merge(current,incoming,{restorePlans=false}={}){
    if(!M.validateBackup(current)||!M.validateBackup(incoming)||!validScope(incoming))throw Error('恢复数据未通过检查');
    const result=M.clone(current);delete result.exportScope;
    const report={shops:0,plans:0,plansUpdated:0,added:0,updated:0,duplicates:0,conflicts:[],resources:0};
    for(const s of incoming.shops)if(!result.shops.some(x=>x.id===s.id)){result.shops.push(M.clone(s));report.shops++;}
    const refs={};
    for(const key of ['materials','sizes','shippingTemplates']){
      refs[key]=new Map();for(const source of incoming[key]){
        const withoutId=x=>{const v=M.clone(x);delete v.id;return v;};
        const existing=result[key].find(x=>x.id===source.id);
        if(existing&&same(existing,source)){refs[key].set(source.id,existing.id);continue;}
        const equivalent=result[key].find(x=>same(withoutId(x),withoutId(source)));
        if(equivalent){refs[key].set(source.id,equivalent.id);continue;}
        const copy=M.clone(source);if(existing)copy.id=M.uid(key);result[key].push(copy);refs[key].set(source.id,copy.id);report.resources++;
      }
    }
    const immutable=h=>{const copy=M.clone(h);delete copy.status;delete copy.replacedBy;delete copy.voidedAt;return copy;};
    for(const plan of incoming.plans){
      let local=result.plans.find(p=>p.id===plan.id);
      if(local&&local.shopId!==plan.shopId){report.conflicts.push({name:plan.name,reason:'所属店铺不一致'});continue;}
      if(!local||restorePlans){const copy=M.clone(plan);copy.materialId=refs.materials.get(plan.materialId);copy.shippingId=refs.shippingTemplates.get(plan.shippingId);copy.items.forEach(i=>i.sizeId=refs.sizes.get(i.sizeId));if(local){if(!same(local,copy))report.plansUpdated++;result.plans[result.plans.indexOf(local)]=copy;}else{result.plans.push(copy);report.plans++;}local=copy;}
      const originals=result.records.filter(h=>h.planId===plan.id),merged=new Map(originals.map(h=>[h.id,h]));let conflict='',added=0,updated=0,duplicates=0;
      for(const h of incoming.records.filter(h=>h.planId===plan.id)){
        const old=merged.get(h.id),collision=result.records.find(x=>x.id===h.id&&x.planId!==plan.id);
        if(collision){conflict='记录编号重复';break;}
        if(!old){merged.set(h.id,M.clone(h));added++;continue;}
        if(!same(immutable(old),immutable(h))){conflict='同一记录的金额或成本不同';break;}
        if(old.status===h.status){if(old.replacedBy!==h.replacedBy){conflict='更正记录分支不同';break;}duplicates++;continue;}
        if(old.status==='confirmed'){merged.set(h.id,M.clone(h));updated++;}
        else if(h.status==='confirmed')duplicates++;
        else {conflict='作废与更正状态不同';break;}
      }
      const dates=new Set();for(const h of merged.values())if(h.kind==='daily'&&h.status==='confirmed'){if(dates.has(h.date)){conflict='同一天存在两笔不同的有效账目';break;}dates.add(h.date);}
      const records=[...result.records.filter(h=>h.planId!==plan.id),...merged.values()];
      if(!conflict&&!M.validateBackup({...result,records}))conflict='更正关系不完整';
      if(conflict){report.conflicts.push({name:plan.name,reason:conflict});continue;}
      result.records=records;report.added+=added;report.updated+=updated;report.duplicates+=duplicates;
    }
    if(!M.validateBackup(result))throw Error('合并检查未通过，本机数据保留');return {state:result,report};
  }
  const api={select,validScope,merge};if(typeof module==='object')module.exports=api;else root.MatTransfer=api;
})(typeof window==='object'?window:{});
