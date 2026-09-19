(function(root){
  'use strict';
  const M=typeof module==='object'?require('./domain-v3.js'):root.MatModelV3;
  const T=typeof module==='object'?require('./transfer-v3.js'):root.MatTransferV3;
  const Trends=typeof module==='object'?require('./trends-v3.js'):root.MatTrendsV3;
  const Excel=typeof module==='object'?require('./assets/exceljs.min.js'):root.ExcelJS;
  const clean=v=>v===undefined||v===null||typeof v==='number'&&!Number.isFinite(v)?'':v;
  const status=h=>h.kind==='snapshot'?'旧版试算':({confirmed:'已入账',superseded:'已更正',void:'已作废'}[h.status]);
  function tables(s,format=4){
    const shop=id=>s.shops.find(x=>x.id===id)?.name||'',material=id=>s.materials.find(x=>x.id===id),shipping=id=>s.shippingTemplates.find(x=>x.id===id);
    const splitPlans=format>=3;
    const legacyShippingRows=t=>t.type==='tiers'?t.tiers.map((v,i)=>[t.name,'重量分档',i?t.tiers[i-1].upTo:0,v.upTo,v.fee,'','','','','按重量所在档收取整单运费',t.active?'启用':'停用']):[[t.name,t.type==='fixed'?'固定运费':'首重续重',t.type==='step'?0:'',t.maxWeight,t.fee,t.firstWeight,t.firstFee,t.stepWeight,t.stepFee,t.type==='step'?'不足一个续重按一个计费':'每单固定收取',t.active?'启用':'停用']];
    const planHeader=splitPlans?['店铺','计划','状态','材料','运费模板','广告消耗（元）','支付ROI','退款率（兼容）（%）','未发货仅退款率（%）','已发货仅退款率（%）','退货退款率（%）','1 小时内退款率（%）','其他费用发生范围','平台费（%）','税率（%）','回收比例（%）','其他费用（元/单）','每退货单额外费用（元）','保本ROI','预估盈亏（元）','备注']:['店铺','计划','状态','材料','运费模板','广告消耗（元）','支付ROI','退货率（%）','平台费（%）','税率（%）','回收比例（%）','其他费用（元/单）','每退货单额外费用（元）','保本ROI','预估盈亏（元）','备注'];
    const planRows=s.plans.map(p=>{const r=M.calculate(s,p),rates=M.refundMetrics(p.params);return splitPlans?[shop(p.shopId),p.name,p.deleted?'已删除':'使用中',material(p.materialId)?.name,shipping(p.shippingId)?.name,p.params.spend,p.params.actualRoi,format>=4?rates.refundTotal:p.params.refund,rates.unshipped,rates.shippedOnly,rates.returnRefund,p.params.refundRates?.firstHour??'',rates.otherFeeScope,p.params.fee,p.params.tax,p.params.recovery,p.params.other,p.params.returnCost,r.valid?M.ceilRoi(r.roi):'',r.profit,p.note]:[shop(p.shopId),p.name,p.deleted?'已删除':'使用中',material(p.materialId)?.name,shipping(p.shippingId)?.name,p.params.spend,p.params.actualRoi,p.params.refund,p.params.fee,p.params.tax,p.params.recovery,p.params.other,p.params.returnCost,r.valid?M.ceilRoi(r.roi):'',r.profit,p.note];});
    const sheets=[
      ['使用说明',[['项目','说明'],['文件用途','运营查看与完整工作区恢复；在工作台导入本文件即可恢复。'],['恢复要求','使用未改动的原始导出文件恢复。需要加工分析时请另存副本，避免表格与冻结账目不一致。'],['费用口径','每单总成本按退款类型分摊商品和运费，含平台费、税及其他费用，不含广告；总投入包含广告。'],['历史合计','只有“已入账”的每日记录计入合计；已更正、已作废和旧版试算不累计。'],['备份范围','全部店铺、计划、公共资料、冻结账目及显示设置。隐藏的恢复数据页用于完整还原，请保留。']]],
      ['店铺',[['店铺','状态','使用中计划数'],...s.shops.map(x=>[x.name,x.deleted?'已删除':'使用中',s.plans.filter(p=>p.shopId===x.id&&!p.deleted).length])]],
      ['计划',[planHeader,...planRows]],
      ['商品规格',[['店铺','计划','商品规格','销售长（cm）','销售宽（cm）','异形','生产长（cm）','生产宽（cm）','发货重量（kg）','售价（元）','订单占比（%）','材料成本（元）','运费（元）','每单总成本（未含广告）'],...s.plans.flatMap(p=>M.calculate(s,p).rows.map(i=>[shop(p.shopId),p.name,M.sizeLabel(i.size),i.size.salesW,i.size.salesH,i.size.irregular?'是':'否',i.size.irregular?i.size.productionW:i.size.salesW,i.size.irregular?i.size.productionH:i.size.salesH,i.weight,i.price,i.share,i.material,i.shipping,i.cost]))]],
      ['材料',[['材料','厚度或说明','单价（元/㎡）','状态'],...s.materials.map(m=>[m.name,m.description,m.price,m.active?'启用':'停用'])]],
      ['报价记录',[['材料','报价日期','单价（元/㎡）','备注'],...s.materials.flatMap(m=>m.history.map(h=>[m.name,h.date,h.price,h.note]))]],
      ['尺寸库',[['规格名称','销售长（cm）','销售宽（cm）','异形','生产长（cm）','生产宽（cm）','生产面积（㎡）','状态'],...s.sizes.map(x=>[M.sizeLabel(x),x.salesW,x.salesH,x.irregular?'是':'否',x.irregular?x.productionW:x.salesW,x.irregular?x.productionH:x.salesH,M.productionArea(x),x.needsReview?'待补生产尺寸':x.active?'启用':'停用'])]],
      ['运费模板',[['模板','类型','重量下限（不含，kg）','重量上限（含，kg）','固定或分档费用（元）','首重（kg）','首重费用（元）','续重（kg）','每续重费用（元）','计费说明','状态'],...s.shippingTemplates.flatMap(legacyShippingRows)]],
      ['历史账目',[['记录编号','日期','店铺','计划','状态','材料','当时单价（元/㎡）','广告费（元）','支付销售额（元）','保本ROI','预估盈亏（元）','入账备注','更正原因','原记录编号'],...s.records.map(h=>[h.id,h.date,h.shopName,h.planName,status(h),h.frame?.materials[0].name||h.legacy?.materialName,h.frame&&format>=4?M.frameMaterialPrice(h.frame):h.frame?.materials[0].price??h.legacy?.materialPrice,h.frame?.plan.params.spend??h.legacy?.spend,h.result.gmv,M.ceilRoi(h.result.roi),h.result.profit,h.note,h.reason,h.previousId])]],
      ['入账规格',[['记录编号','日期','店铺','计划','状态','规格','生产面积（㎡）','售价（元）','订单占比（%）','材料成本（元）','发货重量（kg）','运费（元）','每单总成本（未含广告）'],...s.records.flatMap(h=>h.frame?M.calculate(h.frame,h.frame.plan).rows.map(i=>[h.id,h.date,h.shopName,h.planName,status(h),M.sizeLabel(i.size),i.area,i.price,i.share,i.material,i.weight,i.shipping,i.cost]):(h.legacy?.items||[]).map(i=>[h.id,h.date,h.shopName,h.planName,status(h),i.name||`${i.w} × ${i.h}`,i.billingArea??i.area,i.price,i.share,i.material,'',h.legacy.params.shipping,'']))]],
      ['显示设置',[['顺序','指标'],...s.prefs.ids.map((id,i)=>[i+1,M.metricList.find(x=>x.id===id).label])]]
    ];
    if(format>=2){
      const scope=s.exportScope,selection=M.ledger(s,{from:scope?.from||'',to:scope?.to||''});
      const instructions=sheets[0][1];instructions[1][1]='运营查看与工作台恢复；整份或按范围导出均可在其他电脑导入。';instructions[5][1]=scope?'仅包含所选店铺、计划、日期内账目、关联更正版本及所需公共资料。':'全部店铺、计划、公共资料、冻结账目及显示设置。';
      sheets.splice(1,0,['导出范围',[
        ['项目','内容'],['导出类型',scope?'按范围导出':'完整工作区'],['店铺',s.shops.map(x=>x.name).join('；')],['计划',s.plans.map(x=>`${shop(x.shopId)} / ${x.name}`).join('；')||'无计划'],['开始日期',scope?.from||'不限'],['结束日期',scope?.to||'不限'],['范围内有效入账',selection.count],['范围内利润（元）',selection.profit],['额外关联更正版本',scope?.relatedIds.length||0],['公共资料','当前计划使用的材料、尺寸和运费规则；历史用料与费用另存于各笔账目。'],['日期口径','日期只筛选历史账目，计划参数和公共资料均为导出时的当前值。'],['恢复方式',scope?'合并恢复，可选同步所选计划的试算参数；其他店铺及范围外账目保留。':'可合并恢复，或确认后替换整个工作区。'],['冲突处理','重复账目不累计；存在分支或同日不同账目时，保留本机该计划的全部账目，并显示未导入清单。'],['更正关系','相关更正版本可能在日期范围外，一并保存以保证账目完整；合计只统计日期范围内有效版本。']
      ]]);
      const history=sheets.find(([name])=>name==='历史账目')[1];history[0].push('总投入（元，含广告）','范围归属');s.records.forEach((h,i)=>history[i+1].push(h.kind==='daily'?Trends.investment(h):'',scope?.relatedIds.includes(h.id)?'关联更正版本':'所选范围'));
    }
    if(format>=4){
      const rows=sheets.find(([name])=>name==='运费模板')[1];
      const regionalRows=t=>{
        const bandRows=(label,rate)=>rate.bands?[...rate.bands.map((fee,i)=>[label,'区域重量分档',i?[.3,.5,1,2,3,4,5][i-1]:0,[.3,.5,1,2,3,4,5][i],fee,'','','','','所在重量档整单价；不含面单费',t.active?'启用':'停用']),[label,'区域整公斤计费',5,50,'','', '',1,rate.extra,'超过 5 kg 按总重量向上取整 × 每公斤费用；偏远地区人工核价',t.active?'启用':'停用']]:[[label,'区域首重续重',0,50,'',1,rate.first,1,rate.extra,'偏远地区人工核价；不含面单费',t.active?'启用':'停用']];
        return [...bandRows(t.name+' · 普通省份最高常规价',M.REGULAR_SHIPPING_RATES),...Object.entries(t.rates).flatMap(([region,rate])=>bandRows(t.name+' · '+region,rate))];
      };
      rows.splice(1,rows.length-1,...s.shippingTemplates.flatMap(t=>t.type==='regional'?regionalRows(t):legacyShippingRows(t)));
    }
    if(format>=3){
      for(const [name,columns] of [['商品规格',[8]],['入账规格',[10]],['运费模板',[2,3,5,7]]]){
        const rows=sheets.find(([title])=>title===name)[1];
        for(const col of columns){rows[0][col]=rows[0][col].replaceAll('kg','g');for(const row of rows.slice(1))row[col]=M.toGrams(row[col]);}
      }
      const selected=M.skuColumns(s),display=sheets.find(([name])=>name==='显示设置');
      display[1]=[['区域','顺序','字段','显示'],...s.prefs.ids.map((id,i)=>['当前测算',i+1,M.metricList.find(x=>x.id===id).label,'是']),['商品规格','固定首列','规格名称','是'],...selected.map((id,i)=>['商品规格',i+1,M.skuColumnList.find(x=>x.id===id).label,'是']),...M.skuColumnList.filter(x=>!selected.includes(x.id)).map(x=>['商品规格','',x.label,'否']),['商品规格','固定末列','操作','是']];
    }
    return sheets.map(([name,rows])=>[name,rows.map(row=>row.map(clean))]);
  }
  async function exportWorkbook(state,scope){
    if(scope)state=T.select(state,scope);
    if(!M.validateBackup(state))throw Error('当前数据未通过检查，请先核对输入');
    if(!T.validScope(state))throw Error('导出范围未通过检查');
    const s=M.clone(state),book=new Excel.Workbook();book.creator='地垫工作台';book.created=new Date();
    for(const [name,rows] of tables(s)){
      const sheet=book.addWorksheet(name);sheet.addRows(rows);sheet.views=[{state:'frozen',ySplit:1}];
      sheet.autoFilter={from:'A1',to:{row:1,column:rows[0].length}};
      sheet.getRow(1).height=30;sheet.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'},size:11};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF28684F'}};c.alignment={vertical:'middle',wrapText:true};});
      sheet.columns.forEach((col,i)=>{col.width=['使用说明','导出范围'].includes(name)?(i?100:24):Math.min(34,Math.max(16,String(rows[0][i]).length*1.7));});
      sheet.eachRow((row,index)=>{if(index===1)return;row.height=27;row.eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};c.font={name:'Microsoft YaHei',size:10};if(typeof c.value==='number')c.numFmt='#,##0.00####;[Red]-#,##0.00####';if(index%2===0)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7F4'}};});});
      sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
    }
    const data=book.addWorksheet('恢复数据');data.state='veryHidden';data.addRow(['MAT-ROI-XLSX',4]);
    const json=JSON.stringify(s);let offset=0,index=0;
    while(offset<json.length){let end=Math.min(json.length,offset+24000);if(end<json.length&&/[\uD800-\uDBFF]/.test(json[end-1]))end--;data.addRow([index++,json.slice(offset,end)]);offset=end;}
    return book.xlsx.writeBuffer();
  }
  async function importWorkbook(bytes){
    const book=new Excel.Workbook();await book.xlsx.load(bytes);
    const sheet=book.getWorksheet('恢复数据');
    if(!sheet||sheet.getCell('A1').value!=='MAT-ROI-XLSX'||![1,2,3,4].includes(sheet.getCell('B1').value))throw Error('请选择由工作台导出的完整或按范围 Excel 备份');
    if(sheet.rowCount>2000)throw Error('备份过大，请按店铺或日期分批导出后导入');
    let json='';for(let r=2;r<=sheet.rowCount;r++){if(sheet.getCell(r,1).value!==r-2||typeof sheet.getCell(r,2).value!=='string')throw Error('恢复数据不完整');json+=sheet.getCell(r,2).value;}
    const state=JSON.parse(json);if(!M.validateBackup(state)||!T.validScope(state))throw Error('账目、范围或成本校验未通过，当前工作区保留');
    for(const [name,rows] of tables(state,sheet.getCell('B1').value)){
      const ws=book.getWorksheet(name);if(!ws||ws.rowCount!==rows.length)throw Error('工作表已被改动，请使用未修改的原始备份恢复');
      rows.forEach((row,r)=>row.forEach((v,c)=>{const actual=clean(ws.getCell(r+1,c+1).value);if(typeof v==='number'&&typeof actual==='number'?Math.abs(v-actual)>1e-9*Math.max(1,Math.abs(v)):v!==actual)throw Error(`“${name}”已被改动，请使用未修改的原始备份恢复`);}));
    }
    return state;
  }
  async function exportLedgerWorkbook(state,filters={}){
    const shopIds=filters.shopId?[filters.shopId]:filters.planId?state.plans.filter(p=>p.id===filters.planId).map(p=>p.shopId):state.shops.map(s=>s.id);
    return exportWorkbook(state,{mode:'scoped',shopIds,planIds:state.plans.filter(p=>shopIds.includes(p.shopId)&&(!filters.planId||p.id===filters.planId)).map(p=>p.id),from:filters.from||'',to:filters.to||''});
  }
  const api={tables,exportWorkbook,importWorkbook,exportLedgerWorkbook};if(typeof module==='object')module.exports=api;else root.MatWorkbookV3=api;
})(typeof window==='object'?window:{});
