(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ProductTransferUI=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';

  const Recognition=typeof module==='object'&&module.exports?require('./product-recognition.js'):root.ProductRecognition;
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
  const number=value=>Number.isFinite(Number(value))?Number(value):null;
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
    if(Number.isFinite(Number(counts[key])))return Number(counts[key]);
    if(counts.status&&Number.isFinite(Number(counts.status[key])))return Number(counts.status[key]);
    return key==='all'?Number(page?.total||0):0;
  };
  const sizeLabel=size=>text(size?.name)||`${text(size?.salesW??size?.width)} × ${text(size?.salesH??size?.length)} cm`;
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
      id:size.id,name:size.name,salesW:size.salesW,salesH:size.salesH,
      irregular:!!size.irregular,deleted:!!size.deleted
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

  function create(options={}){
    const getState=typeof options.getState==='function'?options.getState:()=>({});
    const rerender=typeof options.render==='function'?options.render:()=>{};
    const notify=typeof options.toast==='function'?options.toast:()=>{};
    const local={
      context:{},session:null,candidate:null,candidateStatus:null,page:null,pageNumber:1,
      filter:'all',missingThickness:false,moreOpen:false,selected:new Set(),
      busy:false,jobId:'',jobKind:'',error:'',requestSerial:0,pollTimer:0,dialog:null,lastFocus:null,
      sheetSelection:new Set(),sheetMappings:{},selectionInitialized:false,undo:null,active:false,destroyed:false,listeners:false
    };

    async function call(action,payload={}){
      if(typeof options.request==='function')return options.request(action,payload);
      const jobs=root.FileJobs;
      if(!jobs)throw Error('文件处理服务尚未加载');
      if(action==='create')return jobs.create(payload.kind,payload.target,payload.rules);
      if(action==='upload')return jobs.upload(payload.sessionId,payload.file,{ownerToken:payload.ownerToken});
      if(action==='status')return jobs.status(payload.sessionId);
      if(action==='selectSheet')return jobs.selectSheet(payload.sessionId,payload.options);
      if(action==='rows')return jobs.rows(payload.sessionId,payload.query);
      if(action==='review')return jobs.review(payload.sessionId,payload.command);
      if(action==='undo')return jobs.undo(payload.sessionId,payload.command);
      if(action==='startExport')return jobs.startExport(payload.sessionId,payload.options);
      if(action==='downloadUrl')return jobs.downloadUrl(payload.sessionId,payload.artifactId);
      if(action==='cancel')return jobs.cancel(payload.jobId);
      if(action==='discard')return jobs.discard(payload.sessionId,{ownerToken:payload.ownerToken});
      throw Error(`未知文件操作：${action}`);
    }

    function stateRules(){
      return canonicalRules(getState()||{});
    }
    function target(){
      const state=getState()||{};
      return {workspaceId:state.workspaceId||local.context.workspaceId||'',storageEpoch:local.context.storageEpoch,shopId:state.activeShop||'',planId:state.active||''};
    }
    function scheduleRender(){
      if(local.destroyed)return;
      rerender();
      root.queueMicrotask?.(()=>{if(local.active)activate();});
    }
    function clearPoll(){if(local.pollTimer){root.clearTimeout(local.pollTimer);local.pollTimer=0;}}
    function queuePoll(task,delay=700){clearPoll();local.pollTimer=root.setTimeout(task,delay);}
    function setError(error,fallback){local.error=safeMessage(error,fallback);scheduleRender();}
    function updateSessionRevision(result){
      if(local.session&&Number.isFinite(Number(result?.revision)))local.session.revision=Number(result.revision);
    }
    function reconcileSelection(rows){
      const visible=new Set(array(rows).map(row=>text(row.rowId)));
      local.selected=new Set([...local.selected].filter(id=>visible.has(id)));
    }

    async function refreshPage({silent=false}={}){
      if(!local.session||local.busy&&!silent)return;
      const serial=++local.requestSerial;
      if(!silent){local.busy=true;local.error='';scheduleRender();}
      try{
        const page=await call('rows',{sessionId:local.session.sessionId,query:{status:local.filter,missingThickness:local.missingThickness,page:local.pageNumber,pageSize:PAGE_SIZE}});
        if(serial!==local.requestSerial||!local.session)return;
        const totalPages=Math.max(1,Number(page?.totalPages)||Math.ceil((Number(page?.total)||0)/PAGE_SIZE)||1);
        if(local.pageNumber>totalPages){local.pageNumber=totalPages;return refreshPage({silent:true});}
        local.page={...page,page:Number(page?.page)||local.pageNumber,pageSize:PAGE_SIZE,totalPages};
        local.session.revision=Number(page?.revision??local.session.revision);
        reconcileSelection(page?.rows);
      }catch(error){if(serial===local.requestSerial)local.error=safeMessage(error,'复核列表读取失败。');}
      finally{if(serial===local.requestSerial){local.busy=false;scheduleRender();}}
    }

    function candidateReady(status){return TERMINAL_PHASES.has(text(status?.phase).toLowerCase())||status?.ready===true;}
    function candidateFailed(status){return FAILED_PHASES.has(text(status?.phase).toLowerCase())||FAILED_PHASES.has(text(status?.job?.state).toLowerCase())||!!status?.error||!!status?.job?.error;}
    function needsSheet(status){return WAITING_SHEET_PHASES.has(text(status?.phase).toLowerCase())||status?.requiresSheetSelection===true;}
    async function pollCandidate(){
      if(!local.candidate)return;
      try{
        const status=await call('status',{sessionId:local.candidate.sessionId});
        local.candidateStatus=status||{};
        if(Number.isFinite(Number(status?.revision)))local.candidate.revision=Number(status.revision);
        if(candidateFailed(status)){local.busy=false;local.jobId='';local.jobKind='';local.error=safeMessage(status?.error||status?.job?.error,'文件处理失败。');scheduleRender();return;}
        if(candidateReady(status)||needsSheet(status)){local.busy=false;local.jobId='';local.jobKind='';await prepareSheetSelection();scheduleRender();return;}
        scheduleRender();queuePoll(pollCandidate);
      }catch(error){local.busy=false;local.jobId='';setError(error,'无法读取文件处理进度。');}
    }
    async function startImport(file){
      if(!file||local.busy)return;
      if(!/\.xlsx$/i.test(file.name)){notify('请选择 .xlsx 文件');return;}
      clearPoll();local.error='';local.busy=true;local.selected.clear();scheduleRender();
      try{
        if(local.candidate)await call('discard',{sessionId:local.candidate.sessionId,ownerToken:local.candidate.ownerToken}).catch(()=>{});
        const created=await call('create',{kind:'product',target:target(),rules:stateRules()});
        local.candidate={...created,filename:file.name};local.sheetSelection.clear();local.sheetMappings={};local.selectionInitialized=false;
        const status=await call('upload',{sessionId:created.sessionId,file,ownerToken:created.ownerToken});
        local.candidateStatus=status||{};if(Number.isFinite(Number(status?.revision)))local.candidate.revision=Number(status.revision);local.jobId=text(status?.jobId||status?.job?.jobId);local.jobKind='import';
        if(candidateReady(status)||needsSheet(status)){local.busy=false;await prepareSheetSelection();scheduleRender();}
        else queuePoll(pollCandidate,300);
      }catch(error){local.busy=false;local.jobId='';setError(error,'Excel 上传失败，请检查文件后重试。');}
    }
    function candidateSheets(){return array(local.candidateStatus?.candidateSheets||local.candidateStatus?.sheets);}
    function sheetMapping(sheet){return local.sheetMappings[text(sheet.sheetId||sheet.id)]||sheet.header?.mapping||sheet.mapping||{};}
    function sheetIssues(sheet){return Recognition.productMappingIssues(array(sheet.header?.headers),sheetMapping(sheet));}
    async function prepareSheetSelection(){
      if(!needsSheet(local.candidateStatus)||local.selectionInitialized)return;
      local.selectionInitialized=true;
      const sheets=candidateSheets();
      if(sheets.length===1){local.sheetSelection.add(text(sheets[0].sheetId||sheets[0].id));await chooseSheet();}
    }
    async function chooseSheet(){
      if(!local.candidate||local.busy)return;
      const selected=candidateSheets().filter(sheet=>local.sheetSelection.has(text(sheet.sheetId||sheet.id)));
      if(!selected.length){notify('请选择要读取的工作表');return;}
      const unresolved=selected.find(sheet=>sheetIssues(sheet).length);
      if(unresolved){openMapping(unresolved,true);return;}
      await startSheetImport(selected.map(sheet=>({sheetId:text(sheet.sheetId||sheet.id),mapping:sheetMapping(sheet)})));
    }
    async function startSheetImport(selections){
      local.busy=true;local.error='';scheduleRender();
      try{
        const options={selections,rules:stateRules(),ownerToken:local.candidate.ownerToken,expectedSessionRevision:Number(local.candidateStatus?.revision??local.candidate.revision)};
        const result=await call('selectSheet',{sessionId:local.candidate.sessionId,options});
        local.candidateStatus={...local.candidateStatus,phase:'importing'};
        local.jobId=text(result?.jobId);local.jobKind='import';scheduleRender();queuePoll(pollCandidate,300);
      }catch(error){local.busy=false;setError(error,'工作表读取失败。');}
    }
    async function useCandidate(){
      if(!local.candidate||!candidateReady(local.candidateStatus))return;
      const previous=local.session;
      local.session={...local.candidate,revision:Number(local.candidateStatus?.revision??local.candidate.revision)};
      local.candidate=null;local.candidateStatus=null;local.page=null;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;
      if(previous)call('discard',{sessionId:previous.sessionId,ownerToken:previous.ownerToken}).catch(()=>{});
      await refreshPage();
      notify('商品规格已载入，可以开始复核');
    }
    async function discardCandidate(){
      if(!local.candidate)return;
      clearPoll();
      const candidate=local.candidate;local.candidate=null;local.candidateStatus=null;local.busy=false;local.jobId='';local.jobKind='';scheduleRender();
      await call('discard',{sessionId:candidate.sessionId,ownerToken:candidate.ownerToken}).catch(()=>{});
    }
    async function cancelJob(){
      if(!local.jobId)return;
      try{await call('cancel',{jobId:local.jobId});notify('已请求取消处理');if(local.jobKind==='import')queuePoll(pollCandidate,250);else if(local.jobKind==='export')queuePoll(pollExport,250);}
      catch(error){setError(error,'取消失败。');}
    }

    async function applyReview({type,rowIds,groupId,patch,overwrite=false}){
      if(!local.session||local.busy)return null;
      const command={mutationId:mutationId(),expectedSessionRevision:local.session.revision,ownerToken:local.session.ownerToken,action:{type,...(type==='selected-batch'?{overwrite:!!overwrite}:{})},patch};
      if(rowIds)command.rowIds=rowIds;
      if(groupId)command.groupId=groupId;
      local.busy=true;local.error='';scheduleRender();
      try{
        let result=await call('review',{sessionId:local.session.sessionId,command});
        if(result?.jobId){local.jobId=text(result.jobId);local.jobKind='review';result=await waitForMutation(result.jobId);}
        updateSessionRevision(result);
        local.undo=type==='group-unify'&&result?.undoable!==false?{revision:local.session.revision,label:'撤销上次同链接修改'}:null;
        await refreshPage({silent:true});
        const changed=Number(result?.changedRows??result?.changed??0);
        notify(changed?`已保留 ${changed} 条复核修改`:'复核修改已保留');
        return result;
      }catch(error){local.error=safeMessage(error,'复核修改未保存，输入仍保留。');scheduleRender();return null;}
      finally{local.busy=false;local.jobId='';local.jobKind='';scheduleRender();}
    }
    async function waitForMutation(jobId){
      const deadline=Date.now()+15*60*1000;
      for(;;){
        const status=await call('status',{sessionId:local.session.sessionId});
        if(candidateFailed(status))throw Error(safeMessage(status.error||status?.job?.error,'批量处理失败。'));
        const job=status?.job;
        if(job&&text(job.jobId)===text(jobId)&&job.state==='succeeded')return job.result||status.receipt||status;
        if(!job&&Number(status?.revision)>Number(local.session.revision))return status.receipt||status;
        if(Date.now()>deadline)throw Error('批量处理超过 15 分钟，已停止等待结果');
        await new Promise(resolve=>root.setTimeout(resolve,450));
      }
    }
    async function undo(){
      if(!local.session||!local.undo||local.busy)return;
      local.busy=true;scheduleRender();
      try{
        const result=await call('undo',{sessionId:local.session.sessionId,command:{mutationId:mutationId(),expectedSessionRevision:local.session.revision,ownerToken:local.session.ownerToken}});
        updateSessionRevision(result);local.undo=null;await refreshPage({silent:true});notify('已撤销上次同链接修改');
      }catch(error){local.error=safeMessage(error,'当前修改已经不能撤销。');local.undo=null;}
      finally{local.busy=false;scheduleRender();}
    }

    async function exportFile(){
      if(!local.session||local.busy||!local.page?.ready)return;
      local.busy=true;local.error='';scheduleRender();
      try{
        const result=await call('startExport',{sessionId:local.session.sessionId,options:{ownerToken:local.session.ownerToken,expectedSessionRevision:local.session.revision}});
        local.jobId=text(result?.jobId);local.jobKind='export';
        if(result?.artifactId)await download(result.artifactId);
        else queuePoll(pollExport,350);
      }catch(error){local.busy=false;local.jobId='';setError(error,'商品表生成失败。');}
    }
    async function pollExport(){
      if(!local.session)return;
      try{
        const status=await call('status',{sessionId:local.session.sessionId});
        if(candidateFailed(status)){local.busy=false;local.jobId='';local.jobKind='';setError(status.error||status?.job?.error,'商品表生成失败。');return;}
        const artifactId=text(status?.artifactId||status?.exportArtifactId||status?.artifact?.id||status?.job?.artifactId);
        if(artifactId){await download(artifactId);return;}
        scheduleRender();queuePoll(pollExport);
      }catch(error){local.busy=false;local.jobId='';setError(error,'无法读取导出进度。');}
    }
    async function download(artifactId){
      const result=await call('downloadUrl',{sessionId:local.session.sessionId,artifactId});
      const url=typeof result==='string'?result:result?.url;
      if(!url)throw Error('导出文件地址无效');
      const link=root.document.createElement('a');link.href=url;link.download='';link.rel='noopener';root.document.body.append(link);link.click();link.remove();
      local.busy=false;local.jobId='';local.jobKind='';scheduleRender();notify('商品表已生成');
    }

    function materials(){return active(getState()?.materials);}
    function sizes(){return active(getState()?.sizes).filter(size=>number(size.salesW??size.width)>0&&number(size.salesH??size.length)>0&&!size.irregular);}
    function materialById(id){return array(getState()?.materials).find(item=>text(item.id)===text(id));}
    function materialOptions(selected,{allowBlank=true,placeholder=true,compact=true}={}){
      const allItems=materials(),selectedItem=allItems.find(item=>text(item.id)===selected),items=compact?allItems.slice(0,INLINE_OPTION_LIMIT):allItems;let out=placeholder?'<option value="">请选择材质</option>':'';
      if(allowBlank)out+=`<option value="${BLANK}" ${selected===BLANK?'selected':''}>保留为空</option>`;
      out+=items.map(item=>`<option value="${htmlEscape(item.id)}" ${text(item.id)===selected?'selected':''}>${htmlEscape(item.name)}</option>`).join('');
      if(selectedItem&&!items.includes(selectedItem))out+=`<option value="${htmlEscape(selected)}" selected>${htmlEscape(selectedItem.name)}</option>`;
      else if(selected&&selected!==BLANK&&!allItems.some(item=>text(item.id)===selected)){const old=materialById(selected);out+=`<option value="${htmlEscape(selected)}" selected disabled>${htmlEscape(old?.name||'已删除材质')}</option>`;}
      if(compact&&allItems.length>INLINE_OPTION_LIMIT)out+=`<option value="${CHOOSE}">选择其他材质…</option>`;
      return out;
    }
    function thicknessOptions(material,selected,{placeholder=true}={}){
      const rules=active(materialById(material)?.weightRules);let out=placeholder?'<option value="">请选择厚度</option>':'';
      out+=rules.map(rule=>`<option value="${htmlEscape(rule.id)}" ${text(rule.id)===selected?'selected':''}>${htmlEscape(thicknessLabel(rule))}</option>`).join('');
      if(selected&&!rules.some(rule=>text(rule.id)===selected))out+=`<option value="${htmlEscape(selected)}" selected disabled>已删除厚度规则</option>`;
      return out;
    }
    function sizeOptions(row){
      const selected=isBlank(row,'size')?BLANK:sizeId(row),derivedSize=fieldObject(row,'size'),allItems=sizes(),selectedItem=allItems.find(item=>text(item.id)===selected),items=allItems.slice(0,INLINE_OPTION_LIMIT);let out='<option value="">请选择尺寸</option>';
      out+=`<option value="${BLANK}" ${selected===BLANK?'selected':''}>保留为空</option>`;
      out+=items.map(item=>`<option value="${htmlEscape(item.id)}" ${text(item.id)===selected?'selected':''}>${htmlEscape(sizeLabel(item))}</option>`).join('');
      if(selectedItem&&!items.includes(selectedItem))out+=`<option value="${htmlEscape(selected)}" selected>${htmlEscape(sizeLabel(selectedItem))}</option>`;
      else if(selected&&selected!==BLANK&&!allItems.some(item=>text(item.id)===selected))out+=`<option value="${htmlEscape(selected)}" selected disabled>${htmlEscape(row?.derived?.sizeLabel||'本次自定义尺寸')}</option>`;
      else if(!selected&&derivedSize.status==='value')out+=`<option value="${DERIVED}" selected disabled>${htmlEscape(derivedSize.label||`${derivedSize.width} × ${derivedSize.length} cm`)}</option>`;
      if(allItems.length>INLINE_OPTION_LIMIT)out+=`<option value="${CHOOSE}">选择其他尺寸…</option>`;
      out+=`<option value="${CUSTOM}">输入本次尺寸…</option>`;return out;
    }
    function rowMaterialValue(row){return isBlank(row,'material')?BLANK:materialId(row);}
    function selectClass(row,key){return ['pending','blocked'].includes(fieldStatus(row,key))?'pv4-select needs-review':'pv4-select';}
    function statusLabel(row){
      const value=text(row?.status||row?.derived?.status).toLowerCase();
      if(value==='confirmed'||value==='ready'||value==='value')return ['已确认','confirmed'];
      if(value==='error'||array(row?.derived?.errors).length)return ['有错误','error'];
      return ['待复核','pending'];
    }
    function reason(row,key){return text(fieldObject(row,key).reason||row?.derived?.[`${key}Reason`]||'');}
    function rawIdentity(row){return text(rawValue(row,'specId','skuId','platformSkuId'));}
    function sourceCell(row){
      const name=rawValue(row,'productName','name');const spec=rawValue(row,'specName','spec','skuName');
      return `<p class="pv4-product-name">${htmlEscape(name||'未命名商品')}</p><p class="pv4-product-spec">${htmlEscape(spec||'未提供规格')}</p><p class="pv4-source-id" title="${htmlEscape(rawIdentity(row))}">SKU ${htmlEscape(truncateId(rawIdentity(row)))}</p><p class="pv4-source-id">${htmlEscape(row.sheetName||'原表')} · 第 ${htmlEscape(row.sourceRow||row.rowId)} 行</p>`;
    }
    function rowHtml(row){
      const id=text(row.rowId),material=rowMaterialValue(row),thickness=thicknessId(row),status=statusLabel(row);
      const weight=row?.derived?.weight, cost=row?.derived?.cost??row?.derived?.materialCost;
      const width=row?.derived?.width??fieldObject(row,'size').width, length=row?.derived?.length??fieldObject(row,'size').length;
      const sizeHint=reason(row,'size')||(width&&length?`${width} × ${length} cm`:'');
      return `<tr data-pv4-row="${htmlEscape(id)}">
        <td><input type="checkbox" name="product-row" aria-label="选择第 ${htmlEscape(row.sourceRow||id)} 行" data-pv4-select-row="${htmlEscape(id)}" ${local.selected.has(id)?'checked':''}></td>
        <td>${sourceCell(row)}</td>
        <td class="num"><strong>${money(rawValue(row,'price','salePrice'))}</strong><small>库存 ${htmlEscape(rawValue(row,'inventory','stock')||'—')}</small></td>
        <td><select name="material-${htmlEscape(id)}" aria-label="第 ${htmlEscape(row.sourceRow||id)} 行材质" class="${selectClass(row,'material')}" data-pv4-row-field="material" data-row-id="${htmlEscape(id)}">${materialOptions(material)}</select>${reason(row,'material')?`<small class="pv4-cell-hint">${htmlEscape(reason(row,'material'))}</small>`:''}</td>
        <td><select name="thickness-${htmlEscape(id)}" aria-label="第 ${htmlEscape(row.sourceRow||id)} 行厚度" class="${selectClass(row,'thickness')}" data-pv4-row-field="thickness" data-row-id="${htmlEscape(id)}" ${!material||material===BLANK?'disabled':''}>${thicknessOptions(material,thickness)}</select>${reason(row,'thickness')?`<small class="pv4-cell-hint">${htmlEscape(reason(row,'thickness'))}</small>`:''}</td>
        <td><select name="size-${htmlEscape(id)}" aria-label="第 ${htmlEscape(row.sourceRow||id)} 行尺寸" class="${selectClass(row,'size')}" data-pv4-row-field="size" data-row-id="${htmlEscape(id)}">${sizeOptions(row)}</select>${sizeHint?`<small class="pv4-cell-hint">${htmlEscape(sizeHint)}</small>`:''}</td>
        <td class="num"><strong>${number(weight)===null?'—':Number(weight).toFixed(3)+' kg'}</strong><small>${money(cost)}</small></td>
        <td><span class="pv4-status ${status[1]}">${status[0]}</span></td>
      </tr>`;
    }
    function groupHtml(group,rows){
      const id=text(group?.groupId||rows[0]?.groupId),productId=text(group?.productId||rawValue(rows[0],'productId','platformProductId'));
      const platform=text(group?.platform||rawValue(rows[0],'platform'));const shop=text(group?.shop||rawValue(rows[0],'shop','shopName'));
      const visible=rows.length,total=Number.isFinite(Number(group?.total))?Number(group.total):visible,hidden=Math.max(0,Number.isFinite(Number(group?.hidden))?Number(group.hidden):total-visible);
      const ids=rows.map(row=>text(row.rowId)),selectedCount=ids.filter(rowId=>local.selected.has(rowId)).length;
      const material=currentMaterial(group,rows),mixed=group?.materialState==='mixed'||group?.materialState==='pending'||typeof group?.materialState==='object'&&['mixed','pending'].includes(group.materialState.status);
      const thicknessState=group?.thicknessState,rule=text(group?.materialRuleId||group?.thicknessRuleId||thicknessState?.ruleId||(typeof thicknessState==='string'&&thicknessState.includes(':')?thicknessState.slice(thicknessState.indexOf(':')+1):''));
      return `<tr class="pv4-group-row" data-group-id="${htmlEscape(id)}">
        <td><input type="checkbox" name="product-group" aria-label="选择本页该商品的 ${visible} 个规格" data-pv4-select-group="${htmlEscape(id)}" data-group-rows="${htmlEscape(ids.join(','))}" ${selectedCount===ids.length&&ids.length?'checked':''}></td>
        <td colspan="2"><div class="pv4-group-title"><strong title="${htmlEscape(productId)}">${htmlEscape(truncateId(productId))}</strong><span>同链接批量处理</span></div><small>${htmlEscape(platform||'平台未填')} · ${htmlEscape(shop||'店铺未填')} · 全组 ${total} 个 SKU${hidden?`，当前隐藏 ${hidden} 个`:''}${!productId?' · 身份不全，仅处理本行':''}</small></td>
        <td><select name="group-material-${htmlEscape(id)}" aria-label="统一该商品全部 SKU 的材质" class="pv4-select" data-pv4-group-field="material" data-group-id="${htmlEscape(id)}">${materialOptions(material)}</select></td>
        <td><select name="group-thickness-${htmlEscape(id)}" aria-label="统一该商品全部 SKU 的厚度" class="pv4-select" data-pv4-group-field="thickness" data-group-id="${htmlEscape(id)}" data-material-id="${htmlEscape(material)}" ${mixed||!material||material===BLANK?'disabled':''}>${thicknessOptions(material,rule)}</select></td>
        <td colspan="3"><small>材质与厚度会应用到全组；各 SKU 尺寸保持不变。</small></td>
      </tr>`;
    }
    function tableHtml(){
      const rows=array(local.page?.rows);if(!rows.length)return '<div class="pv4-empty"><h2>当前筛选没有规格</h2><p>筛选结果为空不代表整张表已完成复核。</p></div>';
      const groups=normalizeGroupMap(local.page);let lastGroup='',body='';
      for(const row of rows){const groupId=text(row.groupId);if(groupId!==lastGroup){const groupRows=rows.filter(item=>text(item.groupId)===groupId);body+=groupHtml(groups.get(groupId)||{groupId},groupRows);lastGroup=groupId;}body+=rowHtml(row);}
      return `<div class="pv4-table-scroll"><table class="pv4-table"><caption class="sr-only">商品规格复核</caption><thead><tr><th><input type="checkbox" name="product-page" aria-label="选择当前页全部规格" data-pv4-select-page></th><th>商品与规格原文</th><th class="num">平台售价</th><th>材质</th><th>厚度</th><th>尺寸</th><th class="num">重量与成本</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></div>`;
    }
    function filterButton(key,label){return `<button type="button" class="pv4-filter" data-pv4-filter="${key}" aria-pressed="${local.filter===key}">${label}<span>${countValue(local.page,key)}</span></button>`;}
    function filterHtml(){
      const missingActive=local.missingThickness;
      return `<div class="pv4-filter-group" role="group" aria-label="复核状态筛选">${filterButton('all','全部规格')}${filterButton('pending','待复核')}${filterButton('confirmed','已确认')}${local.moreOpen?`<button type="button" class="pv4-filter" data-pv4-missing aria-pressed="${missingActive}">未写厚度<span>${countValue(local.page,'missingThickness')}</span></button><button type="button" class="pv4-filter pv4-collapse" data-pv4-more aria-expanded="true" aria-controls="pv4-extra-filter" aria-label="收起更多筛选">${icon('chevron-left')}</button>`:`<button type="button" class="pv4-filter pv4-more ${missingActive?'active':''}" data-pv4-more aria-expanded="false" aria-controls="pv4-extra-filter">更多筛选${missingActive?'<span>1</span>':''}${icon('chevron-right')}</button>`}</div>`;
    }
    function progressHtml(status){
      const progressState=status?.job?.progress||status?.progress||{};
      const completed=number(progressState.bytesRead??progressState.rowsCommitted??progressState.rowsRead);
      const total=number(progressState.bytesTotal??progressState.rowsTotal??status?.counts?.total);
      const progress=Math.max(0,Math.min(100,Number(progressState.percent??status?.percent??(completed!==null&&total>0?completed/total*100:0))||0));
      const label=text(progressState.message||progressState.phase||status?.message||'正在读取并校验文件');
      return `<div class="pv4-progress" role="status" aria-live="polite"><div><strong>${htmlEscape(label)}</strong><span>${progress?`${progress}%`:'请稍候'}</span></div><div class="pv4-progress-track"><span style="--pv4-progress:${progress}%"></span></div>${local.jobId?`<button type="button" class="btn ghost" data-pv4-cancel>${icon('x')}取消</button>`:''}</div>`;
    }
    function candidateHtml(){
      if(!local.candidate)return '';
      const status=local.candidateStatus||{};
      if(needsSheet(status)){
        const sheets=candidateSheets();return `<section class="pv4-candidate pv4-sheet-picker"><div><strong>${htmlEscape(local.candidate.filename)}</strong><p>选择需要转表的工作表，可多选。字段默认自动识别。</p></div><div class="pv4-sheet-list">${sheets.map(sheet=>{const id=text(sheet.sheetId||sheet.id),issues=sheetIssues(sheet),available=array(sheet.header?.headers).length>0;return `<div class="pv4-sheet-option"><label><input type="checkbox" data-pv4-sheet="${htmlEscape(id)}" ${local.sheetSelection.has(id)?'checked':''} ${available&&!local.busy?'':'disabled'}><span>${htmlEscape(sheet.name||id)}<small>${!available?'未识别到表头':issues.length?'需确认 '+issues.map(key=>REQUIRED_PRODUCT_FIELDS[key]).join('、'):'已自动识别商品字段'}</small></span></label>${available?`<button type="button" class="btn ghost" data-pv4-map-sheet="${htmlEscape(id)}" ${local.busy?'disabled':''}>核对字段</button>`:''}</div>`;}).join('')}</div><div class="pv4-candidate-actions"><button type="button" class="btn" data-pv4-read-sheet ${local.busy||!local.sheetSelection.size?'disabled':''}>读取所选 ${local.sheetSelection.size} 张表</button><button type="button" class="btn ghost" data-pv4-discard ${local.busy?'disabled':''}>取消</button></div></section>`;
      }
      if(candidateReady(status))return `<section class="pv4-candidate ready"><div><strong>${htmlEscape(local.candidate.filename)}</strong><p>已完成校验，共 ${htmlEscape(status.counts?.total??status.totalRows??status.total??'—')} 条规格，来自 ${array(status.selectedSheets).length||1} 张工作表。${status.duplicateRows?`发现 ${htmlEscape(status.duplicateRows)} 条重复商品内容，已全部保留，请核对来源。`:''}使用后将替换当前复核会话。</p></div><div class="pv4-candidate-actions"><button type="button" class="btn" data-pv4-use>使用这次导入</button><button type="button" class="btn ghost" data-pv4-discard>取消</button></div></section>`;
      return progressHtml(status);
    }
    function pagerHtml(){
      if(!local.page||local.page.totalPages<=1)return '';
      return `<nav class="pv4-pager" aria-label="商品规格分页"><button type="button" class="icon-btn" data-pv4-page="${local.pageNumber-1}" aria-label="上一页" ${local.pageNumber<=1?'disabled':''}>${icon('chevron-left')}</button><span>第 ${local.pageNumber} / ${local.page.totalPages} 页 · 共 ${local.page.total} 条</span><button type="button" class="icon-btn" data-pv4-page="${local.pageNumber+1}" aria-label="下一页" ${local.pageNumber>=local.page.totalPages?'disabled':''}>${icon('chevron-right')}</button></nav>`;
    }
    function html(){
      const selected=local.selected.size;const ready=!!local.page?.ready;
      return `<div class="product-v4" data-product-v4>
        <div class="page-header"><div class="page-heading"><h1>商品转表</h1><p class="page-sub">上传 ERP 商品规格，复核材质、厚度和尺寸后生成固定 29 列商品表。</p></div><button type="button" class="btn primary" data-pv4-export ${!ready||local.busy?'disabled':''}>${icon('download')}导出商品表</button></div>
        <div class="wide-content pv4-content">
          <section class="pv4-upload"><div><h2>ERP 商品规格</h2><p>${local.session?`当前会话 ${htmlEscape(local.session.filename||local.session.sessionId)}`:'支持单个 .xlsx 文件，页面每次只读取当前 100 条。'}</p></div><label class="btn pv4-file-button">${icon('file-up')}选择 Excel<input type="file" name="product-file" accept=".xlsx" data-pv4-file ${local.busy?'disabled':''}></label></section>
          ${candidateHtml()}${local.error?`<div class="pv4-error" role="alert">${htmlEscape(local.error)}<button type="button" class="icon-btn" data-pv4-dismiss aria-label="关闭提示">${icon('x')}</button></div>`:''}
          ${local.session?`<section class="pv4-review">${local.page?.duplicateRows?`<p class="pv4-dialog-note">发现 ${htmlEscape(local.page.duplicateRows)} 条重复商品内容，原行已全部保留。</p>`:''}<div class="pv4-toolbar">${filterHtml()}<div class="pv4-actions"><span>${selected?`已选 ${selected} 条`:`本页 ${array(local.page?.rows).length} 条`}</span><button type="button" class="btn" data-pv4-batch ${!selected||local.busy?'disabled':''}>${icon('layers')}批量处理所选</button>${local.undo?`<button type="button" class="btn ghost" data-pv4-undo ${local.busy?'disabled':''}>${icon('undo-2')}撤销</button>`:''}</div></div>${local.busy&&!local.candidate?progressHtml({message:local.jobId?'正在处理任务':'正在保存复核结果'}):''}${tableHtml()}${pagerHtml()}</section>`:`<div class="pv4-empty"><h2>等待商品规格文件</h2><p>选择 Excel 后，系统会自动识别并在这里集中复核。</p></div>`}
        </div>
      </div>`;
    }

    function ensureDialog(){
      if(!root.document)return null;
      let dialog=root.document.getElementById('product-v4-dialog');
      if(!dialog){dialog=root.document.createElement('dialog');dialog.id='product-v4-dialog';dialog.className='pv4-dialog';dialog.setAttribute('aria-labelledby','pv4-dialog-title');root.document.body.append(dialog);dialog.addEventListener('click',dialogClick);dialog.addEventListener('change',dialogChange);dialog.addEventListener('input',dialogInput);dialog.addEventListener('close',()=>{if(dialog.open)return;local.dialog=null;local.lastFocus?.focus?.({preventScroll:true});local.lastFocus=null;});}
      return dialog;
    }
    function closeDialog(){const dialog=ensureDialog();if(dialog?.open)dialog.close();}
    function dialogShell(title,body,submitLabel='应用修改'){
      return `<form method="dialog" data-pv4-dialog-form><div class="pv4-dialog-head"><h2 id="pv4-dialog-title">${htmlEscape(title)}</h2><button type="button" class="icon-btn" data-pv4-dialog-close aria-label="关闭">${icon('x')}</button></div><div class="pv4-dialog-body">${body}<p class="pv4-dialog-error" role="alert" data-pv4-dialog-error></p></div><div class="pv4-dialog-foot"><button type="button" class="btn ghost" data-pv4-dialog-close>取消</button><button type="submit" class="btn primary">${htmlEscape(submitLabel)}</button></div></form>`;
    }
    function openBatch(){
      const ids=[...local.selected];if(!ids.length)return;
      const selectedRows=array(local.page?.rows).filter(row=>ids.includes(text(row.rowId))),materialIds=[...new Set(selectedRows.map(materialId).filter(Boolean))];
      const uniformMaterial=materialIds.length===1?materialIds[0]:'';
      local.lastFocus=root.document.activeElement;local.dialog={type:'batch',rowIds:ids,revision:local.session.revision};
      const dialog=ensureDialog();dialog.innerHTML=dialogShell('批量处理所选',`<p class="pv4-dialog-note">本次固定处理当前选中的 ${ids.length} 条规格。默认只补待复核字段；勾选覆盖后才修改已确认值或留空。</p><div class="pv4-batch-grid">
        <label>材质<select name="batch-material"><option value="${KEEP}">保持原值</option><option value="${BLANK}">保留为空</option>${materials().map(item=>`<option value="${htmlEscape(item.id)}">${htmlEscape(item.name)}</option>`).join('')}</select></label>
        <label>厚度<select name="batch-thickness" data-current-material="${htmlEscape(uniformMaterial)}" ${uniformMaterial?'':'disabled'}><option value="${KEEP}">保持原值</option>${uniformMaterial?active(materialById(uniformMaterial)?.weightRules).map(rule=>`<option value="${htmlEscape(rule.id)}">${htmlEscape(thicknessLabel(rule))}</option>`).join(''):''}</select></label>
        <label>尺寸<select name="batch-size"><option value="${KEEP}">保持原值</option><option value="${BLANK}">保留为空</option>${sizes().map(item=>`<option value="${htmlEscape(item.id)}">${htmlEscape(sizeLabel(item))}</option>`).join('')}<option value="${CUSTOM}">输入本次尺寸…</option></select></label>
      </div><div class="pv4-custom-size" data-pv4-custom-size hidden><label>宽 / cm<input name="batch-width" type="number" min="0.000001" max="10000" step="any"></label><label>长 / cm<input name="batch-length" type="number" min="0.000001" max="10000" step="any"></label></div><label class="pv4-overwrite"><input name="batch-overwrite" type="checkbox">覆盖已确认、自动识别和已留空的字段</label>`);
      dialog.showModal();root.lucide?.createIcons?.();dialog.querySelector('select')?.focus();
    }
    function openCustomSize(rowId){
      local.lastFocus=root.document.activeElement;local.dialog={type:'custom-size',rowIds:[rowId],revision:local.session.revision};
      const dialog=ensureDialog();dialog.innerHTML=dialogShell('输入本次尺寸',`<p class="pv4-dialog-note">只应用到当前规格，不写入可复用尺寸方案。</p><div class="pv4-custom-size"><label>宽 / cm<input name="custom-width" type="number" min="0.000001" max="10000" step="any" required></label><label>长 / cm<input name="custom-length" type="number" min="0.000001" max="10000" step="any" required></label></div>`,'应用尺寸');
      dialog.showModal();root.lucide?.createIcons?.();dialog.querySelector('input')?.focus();
    }
    function openMapping(sheet,continueImport=false){
      const headers=array(sheet?.header?.headers),mapping=sheetMapping(sheet),issues=sheetIssues(sheet);
      if(!headers.length){notify('所选工作表没有可用表头');return;}
      local.lastFocus=root.document.activeElement;local.dialog={type:'mapping',continueImport,sheetId:text(sheet.sheetId||sheet.id),revision:local.candidate?.revision,baseMapping:Object.fromEntries(Object.entries(mapping).filter(([,value])=>Number.isInteger(value)))};
      const fields=Object.entries(REQUIRED_PRODUCT_FIELDS).map(([key,label])=>`<label>${label}<select name="map-${htmlEscape(key)}"><option value="">未选择</option>${headers.map((header,index)=>`<option value="${index}" ${mapping[key]===index?'selected':''}>第 ${index+1} 列 · ${htmlEscape(header||'空表头')}</option>`).join('')}</select></label>`).join('');
      const dialog=ensureDialog();dialog.innerHTML=dialogShell('确认商品字段',`<p class="pv4-dialog-note">${htmlEscape(sheet.name||'工作表')}：${issues.length?'请补充或确认 '+issues.map(key=>REQUIRED_PRODUCT_FIELDS[key]).join('、')+'；其余字段已自动识别。':'字段已自动识别，可在这里手动核对。'}</p><div class="pv4-mapping-grid">${fields}</div>`,continueImport?'确认并继续':'保存字段');dialog.showModal();root.lucide?.createIcons?.();dialog.querySelector('select')?.focus();
    }
    function openPicker({field,rowId='',groupId=''}){
      const entries=field==='material'?materials().map(item=>({id:text(item.id),label:text(item.name)})):sizes().map(item=>({id:text(item.id),label:sizeLabel(item)}));
      local.lastFocus=root.document.activeElement;local.dialog={type:'picker',field,rowId,groupId,entries,query:''};
      const dialog=ensureDialog();dialog.innerHTML=`<div class="pv4-dialog-head"><h2 id="pv4-dialog-title">${field==='material'?'选择材质':'选择尺寸'}</h2><button type="button" class="icon-btn" data-pv4-dialog-close aria-label="关闭">${icon('x')}</button></div><div class="pv4-dialog-body"><label class="pv4-picker-search"><span class="sr-only">搜索${field==='material'?'材质':'尺寸'}</span><input type="search" name="picker-search" placeholder="搜索${field==='material'?'材质名称':'尺寸名称或长宽'}" autocomplete="off"></label><div class="pv4-picker-results" data-pv4-picker-results></div></div>`;
      renderPickerResults(dialog);dialog.showModal();root.lucide?.createIcons?.();dialog.querySelector('input')?.focus();
    }
    function renderPickerResults(dialog=ensureDialog()){
      if(local.dialog?.type!=='picker')return;
      const query=text(local.dialog.query).normalize('NFKC').toLowerCase(),entries=local.dialog.entries.filter(item=>!query||item.label.normalize('NFKC').toLowerCase().includes(query)).slice(0,100);
      const results=dialog.querySelector('[data-pv4-picker-results]');if(!results)return;
      results.innerHTML=`<button type="button" data-pv4-picker-value="${BLANK}">保留为空</button>${entries.map(item=>`<button type="button" data-pv4-picker-value="${htmlEscape(item.id)}"><span>${htmlEscape(item.label)}</span>${icon('chevron-right')}</button>`).join('')}${entries.length?'<small>最多显示 100 项，可继续输入缩小范围。</small>':'<p>没有匹配项。</p>'}`;
      root.lucide?.createIcons?.();
    }
    function dialogChange(event){
      const form=event.target.form;if(!form)return;
      if(event.target.name==='batch-material'){
        const thickness=form.elements['batch-thickness'],chosen=event.target.value,material=chosen===KEEP?text(thickness.dataset.currentMaterial):chosen;thickness.innerHTML=`<option value="${KEEP}">保持原值</option>${material&&material!==BLANK?active(materialById(material)?.weightRules).map(rule=>`<option value="${htmlEscape(rule.id)}">${htmlEscape(thicknessLabel(rule))}</option>`).join(''):''}`;thickness.value=KEEP;thickness.disabled=!material||material===BLANK;
      }
      if(event.target.name==='batch-size')form.querySelector('[data-pv4-custom-size]').hidden=event.target.value!==CUSTOM;
    }
    async function dialogClick(event){
      if(event.target.closest('[data-pv4-dialog-close]')){closeDialog();return;}
      const option=event.target.closest('[data-pv4-picker-value]');
      if(option&&local.dialog?.type==='picker'){
        const snapshot={...local.dialog},value=text(option.dataset.pv4PickerValue),patch=snapshot.field==='material'?{material:value===BLANK?{mode:'blank'}:{mode:'value',id:value}}:{size:value===BLANK?{mode:'blank'}:{mode:'value',id:value}};
        closeDialog();await applyReview({type:snapshot.groupId?'group-unify':'row-edit',rowIds:snapshot.rowId?[snapshot.rowId]:undefined,groupId:snapshot.groupId||undefined,patch});return;
      }
      const form=event.target.closest('form');if(!form||event.type!=='submit')return;
    }
    function dialogInput(event){if(event.target.name==='picker-search'&&local.dialog?.type==='picker'){local.dialog.query=event.target.value;renderPickerResults(event.currentTarget);}}
    async function dialogSubmit(event){
      const form=event.target;if(!form.matches('[data-pv4-dialog-form]')||!local.dialog)return;
      event.preventDefault();const error=form.querySelector('[data-pv4-dialog-error]');error.textContent='';
      const currentRevision=local.dialog.type==='mapping'?local.candidate?.revision:local.session?.revision;
      if(local.dialog.revision!==currentRevision){error.textContent='复核数据已更新，请关闭后重新选择。';return;}
      let patch,overwrite=false;
      if(local.dialog.type==='mapping'){
        const requiredMapping={};for(const key of Object.keys(REQUIRED_PRODUCT_FIELDS)){const value=form.elements[`map-${key}`]?.value;if(value===''){error.textContent=`请选择${REQUIRED_PRODUCT_FIELDS[key]}对应的列。`;return;}requiredMapping[key]=Number(value);}if(new Set(Object.values(requiredMapping)).size!==Object.keys(requiredMapping).length){error.textContent='同一列不能同时对应多个必需字段。';return;}const mapping={...local.dialog.baseMapping,...requiredMapping};
        const snapshot={...local.dialog};local.sheetMappings[snapshot.sheetId]=mapping;closeDialog();scheduleRender();if(snapshot.continueImport)await chooseSheet();return;
      }else if(local.dialog.type==='custom-size'){
        const width=number(form.elements['custom-width'].value),length=number(form.elements['custom-length'].value);
        if(!(width>0&&width<=10000&&length>0&&length<=10000)){error.textContent='宽和长需大于 0，且不超过 10000 cm。';return;}
        patch={size:{mode:'value',width,length}};
      }else{
        const material=text(form.elements['batch-material'].value),thickness=text(form.elements['batch-thickness'].value),size=text(form.elements['batch-size'].value),thicknessMaterial=material===KEEP?text(form.elements['batch-thickness'].dataset.currentMaterial):material;overwrite=form.elements['batch-overwrite'].checked;
        patch={material:material===KEEP?{mode:'keep'}:material===BLANK?{mode:'blank'}:{mode:'value',id:material},thickness:thickness===KEEP?{mode:'keep'}:{mode:'value',materialId:thicknessMaterial,ruleId:thickness},size:size===KEEP?{mode:'keep'}:size===BLANK?{mode:'blank'}:size===CUSTOM?{mode:'value',width:number(form.elements['batch-width'].value),length:number(form.elements['batch-length'].value)}:{mode:'value',id:size}};
        if(size===CUSTOM&&!(patch.size.width>0&&patch.size.width<=10000&&patch.size.length>0&&patch.size.length<=10000)){error.textContent='宽和长需大于 0，且不超过 10000 cm。';return;}
        if(material===BLANK&&thickness!==KEEP){error.textContent='材质保留为空时，厚度必须保持原值。';return;}
        if([material,thickness,size].every(value=>value===KEEP)){error.textContent='请选择至少一个需要修改的字段。';return;}
      }
      const snapshot={...local.dialog};closeDialog();await applyReview({type:snapshot.type==='batch'?'selected-batch':'row-edit',rowIds:snapshot.rowIds,patch,overwrite});
    }

    async function rowFieldChange(select){
      const rowId=text(select.dataset.rowId),field=select.dataset.pv4RowField,value=text(select.value);if(!value)return refreshPage({silent:true});
      if(value===CHOOSE){const row=array(local.page?.rows).find(item=>text(item.rowId)===rowId);select.value=field==='material'?rowMaterialValue(row):isBlank(row,'size')?BLANK:sizeId(row)||DERIVED;openPicker({field,rowId});return;}
      if(field==='size'&&value===CUSTOM){const row=array(local.page?.rows).find(item=>text(item.rowId)===rowId);select.value=isBlank(row,'size')?BLANK:sizeId(row)||DERIVED;openCustomSize(rowId);return;}
      let patch;
      if(field==='material')patch={material:value===BLANK?{mode:'blank'}:{mode:'value',id:value}};
      else if(field==='size')patch={size:value===BLANK?{mode:'blank'}:{mode:'value',id:value}};
      else {const row=array(local.page?.rows).find(item=>text(item.rowId)===rowId);patch={thickness:{mode:'value',materialId:materialId(row),ruleId:value}};}
      await applyReview({type:'row-edit',rowIds:[rowId],patch});
    }
    async function groupFieldChange(select){
      const groupId=text(select.dataset.groupId),field=select.dataset.pv4GroupField,value=text(select.value);if(!value)return refreshPage({silent:true});
      if(value===CHOOSE){const group=normalizeGroupMap(local.page).get(groupId),rows=array(local.page?.rows).filter(row=>text(row.groupId)===groupId);select.value=currentMaterial(group,rows);openPicker({field:'material',groupId});return;}
      const patch=field==='material'?{material:value===BLANK?{mode:'blank'}:{mode:'value',id:value}}:{thickness:{mode:'value',materialId:text(select.dataset.materialId),ruleId:value}};
      await applyReview({type:'group-unify',groupId,patch});
    }
    function pageRows(){return array(local.page?.rows).map(row=>text(row.rowId));}
    function toggleRows(ids,checked){for(const id of ids)checked?local.selected.add(id):local.selected.delete(id);scheduleRender();}
    async function documentChange(event){
      const target=event.target;if(!target.closest?.('[data-product-v4]'))return;
      if(target.matches('[data-pv4-file]')){const file=target.files?.[0];if(file)await startImport(file);target.value='';return;}
      if(target.matches('[data-pv4-sheet]')){const id=text(target.dataset.pv4Sheet);target.checked?local.sheetSelection.add(id):local.sheetSelection.delete(id);scheduleRender();return;}
      if(target.matches('[data-pv4-select-page]')){toggleRows(pageRows(),target.checked);return;}
      if(target.matches('[data-pv4-select-group]')){toggleRows(text(target.dataset.groupRows).split(',').filter(Boolean),target.checked);return;}
      if(target.matches('[data-pv4-select-row]')){toggleRows([text(target.dataset.pv4SelectRow)],target.checked);return;}
      if(target.matches('[data-pv4-row-field]'))await rowFieldChange(target);
      if(target.matches('[data-pv4-group-field]'))await groupFieldChange(target);
    }
    async function documentClick(event){
      const button=event.target.closest?.('[data-product-v4] button');if(!button)return;
      if(button.matches('[data-pv4-filter]')){local.filter=button.dataset.pv4Filter;local.pageNumber=1;local.selected.clear();await refreshPage();return;}
      if(button.matches('[data-pv4-more]')){local.moreOpen=!local.moreOpen;scheduleRender();return;}
      if(button.matches('[data-pv4-missing]')){local.missingThickness=!local.missingThickness;local.pageNumber=1;local.selected.clear();await refreshPage();return;}
      if(button.matches('[data-pv4-page]')){local.pageNumber=Math.max(1,Number(button.dataset.pv4Page)||1);local.selected.clear();await refreshPage();return;}
      if(button.matches('[data-pv4-batch]'))openBatch();
      else if(button.matches('[data-pv4-export]'))await exportFile();
      else if(button.matches('[data-pv4-use]'))await useCandidate();
      else if(button.matches('[data-pv4-map-sheet]')){const sheet=candidateSheets().find(x=>text(x.sheetId||x.id)===button.dataset.pv4MapSheet);if(sheet)openMapping(sheet);}
      else if(button.matches('[data-pv4-read-sheet]'))await chooseSheet();
      else if(button.matches('[data-pv4-discard]'))await discardCandidate();
      else if(button.matches('[data-pv4-cancel]'))await cancelJob();
      else if(button.matches('[data-pv4-undo]'))await undo();
      else if(button.matches('[data-pv4-dismiss]')){local.error='';scheduleRender();}
    }
    function bind(){
      if(local.listeners||!root.document)return;local.listeners=true;
      root.document.addEventListener('click',documentClick);
      root.document.addEventListener('change',documentChange);
      root.document.addEventListener('submit',dialogSubmit);
    }
    function syncChecks(){
      const scope=root.document?.querySelector('[data-product-v4]');if(!scope)return;
      const visible=pageRows(),selected=visible.filter(id=>local.selected.has(id)).length,pageCheck=scope.querySelector('[data-pv4-select-page]');
      if(pageCheck){pageCheck.checked=!!visible.length&&selected===visible.length;pageCheck.indeterminate=selected>0&&selected<visible.length;}
      scope.querySelectorAll('[data-pv4-select-group]').forEach(check=>{const ids=text(check.dataset.groupRows).split(',').filter(Boolean),count=ids.filter(id=>local.selected.has(id)).length;check.checked=!!ids.length&&count===ids.length;check.indeterminate=count>0&&count<ids.length;});
    }
    function activate(context={}){
      local.active=true;refreshContext(context,{render:false});bind();ensureDialog();syncChecks();root.lucide?.createIcons?.();
      if(local.session&&!local.page&&!local.busy)refreshPage();
      return api;
    }
    function deactivate(){
      local.active=false;closeDialog();local.filter='all';local.missingThickness=false;local.moreOpen=false;local.pageNumber=1;local.selected.clear();local.page=null;
    }
    function refreshContext(context={},settings={}){
      const previousWorkspace=text(local.context.workspaceId),previousEpoch=text(local.context.storageEpoch);local.context={...local.context,...context};
      if((previousWorkspace&&text(local.context.workspaceId)!==previousWorkspace)||(previousEpoch&&text(local.context.storageEpoch)!==previousEpoch)){
        clearPoll();local.session=null;local.candidate=null;local.candidateStatus=null;local.page=null;local.selected.clear();local.busy=false;local.jobId='';local.jobKind='';local.undo=null;local.error='工作区已切换，请重新选择商品规格文件。';
      }
      if(settings.render!==false)scheduleRender();return api;
    }
    async function restoreSession(session){
      if(!session?.sessionId||!session?.ownerToken)throw Error('文件会话信息不完整');
      clearPoll();local.session={...session};local.candidate=null;local.candidateStatus=null;local.page=null;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;local.error='';
      await refreshPage();return api;
    }
    function isBusy(){return local.busy||!!local.jobId;}
    function canQuit(){return !isBusy()&&!local.dialog&&!local.candidate;}
    function destroy(){
      clearPoll();local.destroyed=true;local.active=false;
      if(local.listeners&&root.document){root.document.removeEventListener('click',documentClick);root.document.removeEventListener('change',documentChange);root.document.removeEventListener('submit',dialogSubmit);}
      local.dialog=null;root.document?.getElementById('product-v4-dialog')?.remove();
    }
    function inspect(){return {session:local.session&&{...local.session},candidate:local.candidate&&{...local.candidate},filter:local.filter,missingThickness:local.missingThickness,pageNumber:local.pageNumber,selected:[...local.selected],busy:isBusy()};}

    const api={html,activate,deactivate,refreshContext,restoreSession,refresh:refreshPage,isBusy,canQuit,destroy,inspect};
    return api;
  }

  return {create,truncateId,canonicalRules,PAGE_SIZE};
});
