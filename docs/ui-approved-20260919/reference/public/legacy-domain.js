(function(root){
  'use strict';
  const metricList=[
    {id:'roi',label:'保本 ROI',note:'广告花 1 元，至少带来多少销售额'},
    {id:'profit',label:'预估盈亏',note:'扣除广告费后的预计盈亏'},
    {id:'cost',label:'平均每单成本',note:'商品、快递、平台费和税的合计'},
    {id:'price',label:'平均售价',note:'当前计划各尺寸售价的加权平均'},
    {id:'margin',label:'每单可投广告费',note:'每卖出一单，最多能拿多少钱投广告'},
    {id:'rate',label:'每百元结余',note:'扣退款和各项成本，未扣广告费'},
    {id:'gmv',label:'预计销售额',note:'广告消耗 × 支付 ROI'},
    {id:'range',label:'不同情况的保本线',note:'退货率 5%–20% 的参考范围'}
  ];
  const defaults={shipping:1.35,refund:10,fee:5,tax:2,recovery:0,other:0,returnCost:0,spend:1000,actualRoi:3};
  const ceilRoi=v=>Number.isFinite(v)?Math.ceil(v*100-1e-10)/100:null;
  const isNum=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Math.abs(Number(v))<=1e12;
  // Cost follows billable material, not the visible silhouette of the finished mat.
  const area=s=>s?.shape==='irregular'&&s.areaMode!=='bounds'?Number(s.area):Number(s?.w)*Number(s?.h)/10000;
  const areaFactor=s=>s?.shape==='irregular'?Number(s.factor===undefined?1:s.factor):1;
  const billingArea=s=>area(s)*areaFactor(s);
  // Unspecified thickness uses the quoted material as-is, preserving existing costs.
  const validThickness=v=>v==null||(isNum(v)&&Number(v)>0&&Number(v)<=100);
  const thickness=s=>s?.thickness==null?null:Number(s.thickness);
  const materialBaseThickness=m=>m?.baseThickness==null?null:Number(m.baseThickness);
  const thicknessFactor=(s,m)=>!validThickness(s?.thickness)||!validThickness(m?.baseThickness)?NaN:thickness(s)===null?1:materialBaseThickness(m)>0?thickness(s)/materialBaseThickness(m):NaN;
  const materialCost=(s,m)=>billingArea(s)*Number(m?.price)*thicknessFactor(s,m);
  const sizeLabel=s=>(s?.shape==='irregular'?s.name:`${s?.w} × ${s?.h}`)+(thickness(s)===null?'':` · ${thickness(s)} mm`);
  const sameSize=(a,b)=>thickness(a)===thickness(b)&&(a.shape==='irregular'?b.shape==='irregular'&&a.name===b.name:b.shape!=='irregular'&&Number(a.w)===Number(b.w)&&Number(a.h)===Number(b.h));
  function validSize(s){
    if(!s||!['rectangle','irregular'].includes(s.shape||'rectangle'))return false;
    const positive=v=>isNum(v)&&Number(v)>0;
    if(!validThickness(s.thickness))return false;
    if(s.shape==='irregular'){
      if(typeof s.name!=='string'||!s.name.trim()||s.name.length>40||!['area','bounds'].includes(s.areaMode||'area')||!positive(s.factor===undefined?1:s.factor))return false;
      if(s.areaMode!=='bounds'&&!positive(s.area))return false;
    }
    if(s.shape!=='irregular'||s.areaMode==='bounds')if(!positive(s.w)||!positive(s.h)||Number(s.w)>10000||Number(s.h)>10000)return false;
    return Number.isFinite(billingArea(s))&&billingArea(s)>0;
  }
  function getMaterial(state,id){return state.materials?.find(m=>m.id===id);}
  function calculate(state,plan,overrides={}){
    const p={...plan.params,...overrides},mat=getMaterial(state,plan.materialId),errors=[];
    if(!mat)errors.push('请先为计划选择材料');
    for(const key of ['shipping','refund','fee','tax','recovery','other','returnCost'])if(!isNum(p[key])||Number(p[key])<0||(['refund','fee','tax','recovery'].includes(key)&&Number(p[key])>100))errors.push('请检查费用和比例');
    if(!mat||!isNum(mat.price)||Number(mat.price)<0)errors.push('材料价格无效');
    if(mat&&!validThickness(mat.baseThickness))errors.push('请检查材料报价厚度');
    if(!plan.items.length)errors.push('请为计划添加尺寸和售价');
    const r=Number(p.refund)/100,v=Number(p.recovery)/100;
    const rows=plan.items.map(item=>{
      const size=state.sizes.find(s=>s.id===item.sizeId),price=Number(item.price),material=validSize(size)&&mat?materialCost(size,mat):NaN;
      if(!validSize(size))errors.push('请检查规格面积、厚度和用料系数');
      if(size&&thickness(size)!==null&&mat&&materialBaseThickness(mat)===null)errors.push('请在材料库填写报价厚度，才能换算指定厚度的成本');
      if(!Number.isFinite(material))errors.push('材料成本暂时无法计算');
      if(!size||!isNum(item.price)||price<=0||!isNum(item.share)||Number(item.share)<0||Number(item.share)>100)errors.push('请补齐尺寸售价和订单占比');
      const revenue=price*(1-r),goods=material*(1-r*v),fees=revenue*Number(p.fee)/100,tax=revenue*Number(p.tax)/100,shipping=Number(p.shipping),other=Number(p.other),returns=r*Number(p.returnCost),cost=goods+fees+tax+shipping+other+returns,margin=revenue-cost;
      return {...item,size,material,revenue,goods,fees,tax,shipping,other,returns,cost,margin,roi:margin>0?price/margin:null};
    });
    const total=plan.items.reduce((a,i)=>a+Number(i.share),0);if(!Number.isFinite(total)||Math.abs(total-100)>1e-6)errors.push('订单占比需要合计 100%');
    const sum=k=>rows.reduce((a,i)=>a+Number(i.share)/100*i[k],0),price=rows.reduce((a,i)=>a+Number(i.share)/100*Number(i.price),0),margin=sum('margin');
    for(const key of ['spend','actualRoi'])if(p[key]!==''&&(!isNum(p[key])||Number(p[key])<0))errors.push('请检查广告消耗和支付 ROI，数值需在 0–1 万亿之间');
    if(!Number.isFinite(price)||!Number.isFinite(margin)||!Number.isFinite(sum('cost')))errors.push('计算结果超出范围，请检查输入');
    const valid=errors.length===0,forecast=isNum(p.spend)&&Number(p.spend)>=0&&isNum(p.actualRoi)&&Number(p.actualRoi)>=0;
    return {valid,errors:[...new Set(errors)],material:mat,rows,total,price,margin,cost:sum('cost'),revenue:sum('revenue'),goods:sum('goods'),shipping:sum('shipping'),fees:sum('fees'),tax:sum('tax'),other:sum('other')+sum('returns'),roi:valid&&margin>0?price/margin:null,rate:valid&&price>0?margin/price:null,gmv:forecast?Number(p.spend)*Number(p.actualRoi):null,profit:valid&&forecast?Number(p.spend)*(Number(p.actualRoi)*margin/price-1):null};
  }
  function seed(){
    const sizes=[[30,40],[40,60],[50,80],[60,90],[80,100],[80,120]].map(([w,h],i)=>({id:'s'+i,w,h,active:true}));
    const materials=[
      {id:'mat-silica',name:'硅藻泥基础料',price:10.2,baseThickness:null,unit:'元 / ㎡',active:true,updatedAt:'2026-09-07',history:[{date:'2026-09-07',price:10.2,note:'初始材料价'}]},
      {id:'mat-pvc',name:'PVC 防滑底',price:12.8,baseThickness:null,unit:'元 / ㎡',active:true,updatedAt:'2026-09-07',history:[{date:'2026-09-07',price:12.8,note:'初始材料价'}]},
      {id:'mat-custom',name:'定制加厚料',price:16.5,baseThickness:null,unit:'元 / ㎡',active:true,updatedAt:'2026-09-07',history:[{date:'2026-09-07',price:16.5,note:'初始材料价'}]}
    ];
    const make=(id,name,materialId,params,items,note)=>({id,name,materialId,note,example:true,params:{...defaults,...params},items,lowId:items[0].sizeId,referenceId:items[1]?.sizeId||items[0].sizeId,history:[]});
    const state={version:2,materials,sizes,plans:[],prefs:{count:2,ids:['roi','profit']},active:'plan-a'};
    state.plans=[make('plan-a','A · 日常投放','mat-silica',{},[{sizeId:'s0',price:4.19,share:20},{sizeId:'s1',price:8.99,share:80}],'低价款 20%，主销款 80%'),make('plan-b','B · 大尺寸测试','mat-pvc',{refund:12},[{sizeId:'s1',price:8.99,share:25},{sizeId:'s2',price:13.5,share:45},{sizeId:'s3',price:18.9,share:30}],'换一种材料，测试中大规格')];
    state.plans.forEach(p=>{const r=calculate(state,p),m=getMaterial(state,p.materialId);p.history=[{id:'h-'+p.id+'-initial',kind:'snapshot',date:'2026-09-07',label:'示例初始测算',materialId:p.materialId,materialName:m.name,materialPrice:m.price,roi:r.roi,profit:r.profit,price:r.price,shareSnapshot:p.items.map(i=>({sizeId:i.sizeId,price:i.price,share:i.share}))}];});
    return state;
  }
  function scenario(state,plan,share,refund){const low=plan.items.find(i=>i.sizeId===plan.lowId)||plan.items[0],rest=plan.items.filter(i=>i!==low);if(!low||!rest.length)return null;const total=rest.reduce((a,i)=>a+Number(i.share),0),items=[{...low,share},...rest.map(i=>({...i,share:(100-share)*(total?Number(i.share)/total:0)}))];if(total===0)items[1].share=100-share;return calculate(state,{...plan,items},{refund});}
  function validDate(date){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const d=new Date(date+'T00:00:00Z');return !Number.isNaN(+d)&&d.toISOString().slice(0,10)===date;}
  function createRecord(state,plan,date,label=''){
    const r=calculate(state,plan);
    if(!validDate(date))throw new Error('请选择有效日期');
    if(!r.valid||!Number.isFinite(r.profit)||!Number.isFinite(r.gmv))throw new Error('请先补齐售价、占比、费用和投放数据');
    if(date>new Date().toLocaleDateString('sv-SE'))throw new Error('不能记录未来日期');
    if(plan.history.some(h=>h.kind==='daily'&&!h.voided&&h.date===date))throw new Error('这一天已记账，请先查看历史记录，避免重复累计');
    return {id:'h-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),kind:'daily',date,label:label.trim()||'当日记录',recordedAt:new Date().toISOString(),materialId:r.material.id,materialName:r.material.name,materialPrice:Number(r.material.price),materialBaseThickness:materialBaseThickness(r.material),params:structuredClone(plan.params),items:r.rows.map(i=>({sizeId:i.sizeId,shape:i.size.shape||'rectangle',name:i.size.name||'',areaMode:i.size.areaMode||'area',w:i.size.w??null,h:i.size.h??null,area:area(i.size),factor:areaFactor(i.size),thickness:thickness(i.size),thicknessFactor:thicknessFactor(i.size,r.material),billingArea:billingArea(i.size),price:Number(i.price),share:Number(i.share),material:i.material})),roi:r.roi,profit:r.profit,price:r.price,spend:Number(plan.params.spend),gmv:r.gmv,cost:r.cost,margin:r.margin};
  }
  // Old scratch calculations remain snapshots; they must not become daily profit entries.
  function migrate(s){
    if(!s||typeof s!=='object')return s;
    s=structuredClone(s);
    if(s.version===1&&isNum(s.material)){
      const date=s.materialDate||'',id='mat-legacy';
      s.materials=[{id,name:'原有材料',price:Number(s.material),active:true,updatedAt:date,history:[{date,price:Number(s.material),note:'从旧版保留'}]}];
      s.plans?.forEach(p=>{p.materialId=id;p.history=[];});
      s.version=2;delete s.material;delete s.materialDate;
    }
    if(s.version===2)s.plans?.forEach(p=>p.history?.forEach(h=>{h.kind ||= 'snapshot';}));
    return s;
  }
  function validateBackup(s){
    try{
      const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
      const name=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
      const draft=v=>v===''||(typeof v==='number'&&isNum(v));
      const text=(v,max)=>v===undefined||(typeof v==='string'&&v.length<=max);
      const near=(a,b)=>a===null&&b===null||Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(b));
      if(!s||s.version!==2||!Array.isArray(s.materials)||!s.materials.length||!Array.isArray(s.sizes)||!Array.isArray(s.plans)||!s.plans.length)return false;
      if(s.materials.length>500||s.sizes.length>5000||s.plans.length>500)return false;
      const mids=new Set(s.materials.map(m=>m.id)),sids=new Set(s.sizes.map(x=>x.id));
      if(mids.size!==s.materials.length||sids.size!==s.sizes.length)return false;
      if(s.materials.some(m=>!id(m.id)||!name(m.name)||!isNum(m.price)||Number(m.price)<0||!validThickness(m.baseThickness)||typeof m.active!=='boolean'||!Array.isArray(m.history)||m.history.some(h=>!h||!isNum(h.price)||Number(h.price)<0||!validThickness(h.baseThickness)||!text(h.note,1000)||!text(h.date,40))))return false;
      if(s.sizes.some(x=>!id(x.id)||typeof x.active!=='boolean'||!validSize(x)))return false;
      if(new Set(s.plans.map(p=>p.id)).size!==s.plans.length)return false;
      for(const p of s.plans){
        if(!id(p.id)||!name(p.name)||!text(p.note,10000)||p.archived!==undefined&&typeof p.archived!=='boolean'||!mids.has(p.materialId)||!p.params||Object.keys(defaults).some(k=>!draft(p.params[k]))||!Array.isArray(p.items)||!Array.isArray(p.history))return false;
        if(new Set(p.items.map(i=>i.sizeId)).size!==p.items.length||p.items.some(i=>!sids.has(i.sizeId)||!draft(i.price)||!draft(i.share)))return false;
        const dates=new Set();if(new Set(p.history.map(h=>h.id)).size!==p.history.length)return false;
        for(const h of p.history){
          if(!id(h.id)||!name(h.materialName)||!isNum(h.materialPrice)||Number(h.materialPrice)<0||!text(h.label,1000)||!validDate(h.date)||h.voided!==undefined&&typeof h.voided!=='boolean'||!(h.roi===null||Number.isFinite(h.roi))||!(h.profit===null||Number.isFinite(h.profit))||!Number.isFinite(h.price))return false;
          if(h.kind==='daily'){
            if(!h.voided&&dates.has(h.date)||!Number.isFinite(h.profit)||!Number.isFinite(h.spend)||h.spend<0||!Number.isFinite(h.gmv)||h.gmv<0||!validThickness(h.materialBaseThickness)||!h.params||Object.keys(defaults).some(k=>!Number.isFinite(h.params[k]))||!Array.isArray(h.items)||!h.items.length||h.items.some(i=>!id(i.sizeId)||!validSize(i)||['price','share','material'].some(k=>!Number.isFinite(i[k]))||(i.thicknessFactor!==undefined&&(!Number.isFinite(i.thicknessFactor)||i.thicknessFactor<=0))))return false;
            if(new Set(h.items.map(i=>i.sizeId)).size!==h.items.length)return false;
            const mat={id:'frozen',price:h.materialPrice,baseThickness:h.materialBaseThickness};
            const frozenState={materials:[mat],sizes:h.items.map(i=>({...i,id:i.sizeId}))};
            const r=calculate(frozenState,{materialId:mat.id,params:h.params,items:h.items});
            if(!r.valid||!near(h.roi,r.roi)||!near(h.profit,r.profit)||!near(h.price,r.price)||!near(h.gmv,r.gmv)||!near(h.spend,h.params.spend))return false;
            if(['cost','margin'].some(k=>h[k]!==undefined&&!near(h[k],r[k])))return false;
            if(h.items.some((i,j)=>!near(i.material,r.rows[j].material)||i.billingArea!==undefined&&!near(i.billingArea,billingArea(i))||i.thicknessFactor!==undefined&&!near(i.thicknessFactor,thicknessFactor(i,mat))))return false;
            if(!h.voided)dates.add(h.date);
          }else if(h.kind!=='snapshot')return false;
        }
      }
      if(s.prefs&&(!Array.isArray(s.prefs.ids)||s.prefs.ids.length<1||s.prefs.ids.length>4||new Set(s.prefs.ids).size!==s.prefs.ids.length||s.prefs.ids.some(id=>!metricList.some(m=>m.id===id))))return false;
      return true;
    }catch{return false;}
  }
  function initialState(){
    const s=seed();
    s.materials=[s.materials[0]];s.materials[0].name='我的地垫材料';
    s.plans=[{id:'plan-first',name:'我的第一个计划',materialId:s.materials[0].id,note:'',params:{...defaults,spend:'',actualRoi:''},items:[],history:[]}];
    s.active=s.plans[0].id;return s;
  }
  const api={metricList,defaults,ceilRoi,seed,initialState,getMaterial,isNum,area,areaFactor,billingArea,validThickness,thickness,materialBaseThickness,thicknessFactor,materialCost,sizeLabel,sameSize,validSize,calculate,scenario,validateBackup,migrate,createRecord,validDate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LegacyMatModel=api;
})(typeof window!=='undefined'?window:{});
