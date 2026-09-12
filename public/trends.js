(function(root){
  'use strict';
  const M=typeof module==='object'?require('./domain.js'):root.MatModel;
  const Legacy=typeof module==='object'?require('./legacy-domain.js'):root.LegacyMatModel;
  const dateString=d=>d.toISOString().slice(0,10);
  function shift(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return dateString(d);}
  function period(date,unit){const d=new Date(date+'T00:00:00Z');if(unit==='month')d.setUTCDate(1);if(unit==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return dateString(d);}
  function next(date,unit){if(unit!=='month')return shift(date,unit==='week'?7:1);const d=new Date(date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return dateString(d);}
  function investment(h){
    if(h.frame&&Number.isFinite(h.result.investment))return h.result.investment;
    if(!h.legacy?.params||!h.legacy.items)return null;
    // Legacy daily entries contain their own prices, dimensions and fees.
    const l=h.legacy,mat={id:'frozen',price:l.materialPrice,baseThickness:l.materialBaseThickness};
    const r=Legacy.calculate({materials:[mat],sizes:l.items.map(i=>({...i,id:i.sizeId}))},{materialId:mat.id,params:l.params,items:l.items});
    const value=Number(l.params.spend)+r.gmv/r.price*r.cost;
    return r.valid&&Number.isFinite(value)?value:null;
  }
  function series(state,{shopId='',planId='',from='',to='',unit='day'}={}){
    if(!['day','week','month'].includes(unit))throw Error('请选择按日、周或月查看');
    if(from&&!M.validDate(from)||to&&!M.validDate(to)||from&&to&&from>to)throw Error('请检查开始和结束日期');
    const records=M.ledger(state,{shopId,planId,from,to}).rows;
    if(!records.length)return {points:[],count:0,profit:0,investment:0,missingInvestment:0};
    const start=from||records.at(-1).date,end=to||records[0].date,groups=new Map();
    for(const h of records){const key=period(h.date,unit),g=groups.get(key)||{profit:0,investment:0,count:0,missingInvestment:0,days:new Set()};const cost=investment(h);g.count++;g.days.add(h.date);g.profit+=h.result.profit;if(cost===null)g.missingInvestment++;else g.investment+=cost;groups.set(key,g);}
    const points=[];
    for(let key=period(start,unit);key<=end;key=next(key,unit)){
      if(points.length>=4000)throw Error('日期跨度较大，请改为按周、按月查看或缩短范围');
      const g=groups.get(key),last=shift(next(key,unit),-1),fromDate=key<start?start:key,toDate=last>end?end:last;
      points.push({key,from:fromDate,to:toDate,label:unit==='day'?key:unit==='month'?key.slice(0,7):`${fromDate} ～ ${toDate}`,partial:key<start||last>end,count:g?.count||0,days:g?.days.size||0,profit:g?g.profit:null,investment:g&&!g.missingInvestment?g.investment:null,missingInvestment:g?.missingInvestment||0});
    }
    const missingInvestment=points.reduce((a,p)=>a+p.missingInvestment,0);
    return {points,count:records.length,profit:records.reduce((a,h)=>a+h.result.profit,0),investment:missingInvestment?null:points.reduce((a,p)=>a+(p.investment||0),0),missingInvestment};
  }
  const api={shift,period,investment,series};if(typeof module==='object')module.exports=api;else root.MatTrends=api;
})(typeof window==='object'?window:{});
