(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ProductTransferUI=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';

  const Recognition=typeof module==='object'&&module.exports?require('./product-recognition.js'):root.ProductRecognition;
  const Loader=typeof module==='object'&&module.exports?require('./lattice-loader.js'):root.LatticeLoader;
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

  function create(options={}){
    const getState=typeof options.getState==='function'?options.getState:()=>({});
    const rerender=typeof options.render==='function'?options.render:()=>{};
    const notify=typeof options.toast==='function'?options.toast:()=>{};
    const waitingLoader=Loader.create();
    const local={
      manual:false,offerAttention:false,contextSerial:0,context:{},session:null,candidate:null,candidateStatus:null,page:null,pageNumber:1,
      filter:'all',missingThickness:false,moreOpen:false,selected:new Set(),
      busy:false,waitStartedAt:0,waitLabel:'',waitStatus:null,jobId:'',jobKind:'',error:'',requestSerial:0,pollTimer:0,dialog:null,lastFocus:null,
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
      if(action==='accept')return payload;
      if(action==='recompute')return jobs.recompute(payload.sessionId,payload.options);
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
    function beginWaiting(label){
      if(!isBusy())local.waitStartedAt=Loader.now();
      local.waitLabel=label;local.waitStatus=null;local.busy=true;
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
      const serial=++local.requestSerial,sessionId=local.session.sessionId;
      if(!silent){beginWaiting('正在读取复核列表');local.error='';scheduleRender();}
      try{
        const page=await call('rows',{sessionId:local.session.sessionId,query:{attention:!local.manual,status:local.filter,missingThickness:local.missingThickness,page:local.pageNumber,pageSize:PAGE_SIZE}});
        if(serial!==local.requestSerial||local.session?.sessionId!==sessionId)return;
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
      if(!local.candidate)return;const candidate=local.candidate;
      try{
        const status=await call('status',{sessionId:local.candidate.sessionId});
        if(local.candidate!==candidate)return;local.candidateStatus=status||{};
        if(status?.phase==='inspecting')local.waitLabel='正在识别工作表';
        if(Number.isFinite(Number(status?.revision)))local.candidate.revision=Number(status.revision);
        if(candidateFailed(status)){local.busy=false;local.jobId='';local.jobKind='';local.error=safeMessage(status?.error||status?.job?.error,'文件处理失败。');await discardCandidate();scheduleRender();return;}
        if(candidateReady(status)||needsSheet(status)){local.busy=false;local.jobId='';local.jobKind='';await prepareSheetSelection();scheduleRender();return;}
        scheduleRender();queuePoll(pollCandidate);
      }catch(error){if(local.candidate!==candidate)return;local.busy=false;local.jobId='';setError(error,'无法读取文件处理进度。');}
    }
    async function startImport(file,replaceConfirmed=false){
      if(!file||local.busy)return;
      if(!/\.xlsx$/i.test(file.name)){notify('请选择 .xlsx 文件');return;}
      if(!replaceConfirmed&&local.session&&countValue(local.page,'pending')>0){local.dialog={type:'replace',file,revision:local.session.revision};const dialog=ensureDialog();dialog.innerHTML=dialogShell('替换当前文件？',`<p>当前 ${htmlEscape(local.session.filename||'文件')} 还有 ${countValue(local.page,'pending')} 条待处理。新文件读取成功后将替换当前会话；失败或取消会保留当前文件。</p>`,'继续导入');dialog.showModal();return;}
      const contextSerial=local.contextSerial;
      clearPoll();local.error='';beginWaiting('正在上传 Excel');local.selected.clear();scheduleRender();
      try{
        if(local.candidate)await call('discard',{sessionId:local.candidate.sessionId,ownerToken:local.candidate.ownerToken}).catch(()=>{});
        const created=await call('create',{kind:'product',target:target(),rules:stateRules()});
        if(contextSerial!==local.contextSerial){await call('discard',{sessionId:created.sessionId,ownerToken:created.ownerToken}).catch(()=>{});return;}
        local.candidate={...created,filename:file.name};const candidate=local.candidate;local.sheetSelection.clear();local.sheetMappings={};local.selectionInitialized=false;
        const status=await call('upload',{sessionId:created.sessionId,file,ownerToken:created.ownerToken});
        if(local.candidate!==candidate)return;local.candidateStatus=status||{};if(Number.isFinite(Number(status?.revision)))local.candidate.revision=Number(status.revision);local.jobId=text(status?.jobId||status?.job?.jobId);local.jobKind='import';
        if(candidateReady(status)||needsSheet(status)){local.busy=false;await prepareSheetSelection();scheduleRender();}
        else queuePoll(pollCandidate,300);
      }catch(error){if(contextSerial!==local.contextSerial)return;await discardCandidate();local.busy=false;local.jobId='';setError(error,'Excel 上传失败，请检查文件后重试。');}
    }
    function candidateSheets(){return array(local.candidateStatus?.candidateSheets||local.candidateStatus?.sheets);}
    function sheetMapping(sheet){return local.sheetMappings[text(sheet.sheetId||sheet.id)]||sheet.header?.mapping||sheet.mapping||{};}
    function sheetIssues(sheet){return Recognition.productMappingIssues(array(sheet.header?.headers),sheetMapping(sheet));}
    async function prepareSheetSelection(){
      if(candidateReady(local.candidateStatus)){await useCandidate();return;}
      if(!needsSheet(local.candidateStatus)||local.selectionInitialized)return;
      local.selectionInitialized=true;
      const sheets=candidateSheets().filter(sheet=>array(sheet.header?.headers).length);
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
      const candidate=local.candidate;
      beginWaiting('正在读取商品规格');local.error='';scheduleRender();
      try{
        const options={selections,rules:stateRules(),ownerToken:local.candidate.ownerToken,expectedSessionRevision:Number(local.candidateStatus?.revision??local.candidate.revision)};
        const result=await call('selectSheet',{sessionId:local.candidate.sessionId,options});
        if(local.candidate!==candidate)return;local.candidateStatus={...local.candidateStatus,phase:'importing'};
        local.jobId=text(result?.jobId);local.jobKind='import';scheduleRender();queuePoll(pollCandidate,300);
      }catch(error){if(local.candidate!==candidate)return;local.busy=false;setError(error,'工作表读取失败。');}
    }
    async function useCandidate(){
      if(!local.candidate||!candidateReady(local.candidateStatus))return;
      const candidate=local.candidate,previous=local.session,contextSerial=local.contextSerial;
      beginWaiting('正在校验商品表');scheduleRender();
      try{
        const page=await call('rows',{sessionId:candidate.sessionId,query:{attention:true,pageSize:1}});
        if(local.candidate!==candidate)return;
        if(Number(page.counts?.total??page.total)===0)throw Error('没有读取到商品规格，当前文件已保留。');
        await call('accept',{...candidate,revision:page.revision,fileKind:'product'});
        if(local.candidate!==candidate)return;
        local.session={...candidate,revision:Number(page.revision??candidate.revision)};
        local.candidate=null;local.candidateStatus=null;local.page=page;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;local.manual=false;local.offerAttention=true;local.requestSerial++;
        if(previous)call('discard',{sessionId:previous.sessionId,ownerToken:previous.ownerToken}).catch(()=>{});
      }catch(error){if(contextSerial!==local.contextSerial)return;local.error=safeMessage(error,'校验失败，当前文件已保留。');}
      finally{if(contextSerial===local.contextSerial){local.busy=false;local.jobId='';local.jobKind='';scheduleRender();}}
    }
    async function discardCandidate(){
      if(!local.candidate)return;
      clearPoll();
      const candidate=local.candidate,contextSerial=local.contextSerial;local.candidate=null;local.candidateStatus=null;local.jobId='';local.jobKind='';beginWaiting('正在取消导入');scheduleRender();
      await call('discard',{sessionId:candidate.sessionId,ownerToken:candidate.ownerToken}).catch(()=>{});
      if(contextSerial===local.contextSerial){local.busy=false;scheduleRender();}
    }
    async function cancelJob(){
      if(!local.jobId)return;
      try{await call('cancel',{jobId:local.jobId});local.waitLabel='正在取消处理';scheduleRender();notify('已请求取消处理');if(local.jobKind==='import')queuePoll(pollCandidate,250);else if(local.jobKind==='export')queuePoll(pollExport,250);}
      catch(error){setError(error,'取消失败。');}
    }

    async function applyReview({type,rowIds,groupId,patch,overwrite=false}){
      if(!local.session||local.busy)return null;
      const session=local.session;
      const command={mutationId:mutationId(),expectedSessionRevision:local.session.revision,ownerToken:local.session.ownerToken,action:{type,...(type==='selected-batch'?{overwrite:!!overwrite}:{})},patch};
      if(rowIds)command.rowIds=rowIds;
      if(groupId)command.groupId=groupId;
      beginWaiting('正在保存复核结果');local.error='';scheduleRender();
      try{
        let result=await call('review',{sessionId:local.session.sessionId,command});
        if(local.session!==session)return null;
        if(result?.jobId){local.jobId=text(result.jobId);local.jobKind='review';result=await waitForMutation(result.jobId,session);}
        if(local.session!==session)return null;updateSessionRevision(result);
        local.undo=type==='group-unify'&&result?.undoable!==false?{revision:local.session.revision,label:'撤销上次同链接修改'}:null;
        await refreshPage({silent:true});
        const changed=Number(result?.changedRows??result?.changed??0);
        notify(changed?`已保留 ${changed} 条复核修改`:'复核修改已保留');
        return result;
      }catch(error){if(local.session!==session)return null;local.error=safeMessage(error,'复核修改未保存，输入仍保留。');scheduleRender();return null;}
      finally{if(local.session===session){local.busy=false;local.jobId='';local.jobKind='';scheduleRender();}}
    }
    async function waitForMutation(jobId,session=local.session){
      const deadline=Date.now()+15*60*1000;
      for(;;){
        const status=await call('status',{sessionId:session.sessionId});
        if(local.session!==session)throw Error('当前文件会话已切换。');
        if(candidateFailed(status))throw Error(safeMessage(status.error||status?.job?.error,'批量处理失败。'));
        const job=status?.job;
        if(job&&text(job.jobId)===text(jobId)&&job.state==='succeeded')return job.result||status.receipt||status;
        if(!job&&Number(status?.revision)>Number(local.session.revision))return status.receipt||status;
        local.waitStatus=status;scheduleRender();
        if(Date.now()>deadline)throw Error('批量处理超过 15 分钟，已停止等待结果');
        await new Promise(resolve=>root.setTimeout(resolve,450));
      }
    }
    async function undo(){
      if(!local.session||!local.undo||local.busy)return;
      beginWaiting('正在撤销修改');scheduleRender();
      try{
        const result=await call('undo',{sessionId:local.session.sessionId,command:{mutationId:mutationId(),expectedSessionRevision:local.session.revision,ownerToken:local.session.ownerToken}});
        updateSessionRevision(result);local.undo=null;await refreshPage({silent:true});notify('已撤销上次同链接修改');
      }catch(error){local.error=safeMessage(error,'当前修改已经不能撤销。');local.undo=null;}
      finally{local.busy=false;scheduleRender();}
    }

    async function exportFile(){
      if(!local.session||local.busy||!local.page?.ready)return;
      const session=local.session;
      beginWaiting('正在生成商品表');local.error='';scheduleRender();
      try{
        const result=await call('startExport',{sessionId:local.session.sessionId,options:{ownerToken:local.session.ownerToken,expectedSessionRevision:local.session.revision}});
        if(local.session!==session)return;local.jobId=text(result?.jobId);local.jobKind='export';
        if(result?.artifactId)await download(result.artifactId);
        else queuePoll(pollExport,350);
      }catch(error){if(local.session!==session)return;local.busy=false;local.jobId='';setError(error,'商品表生成失败。');}
    }
    async function pollExport(){
      if(!local.session)return;const session=local.session;
      try{
        const status=await call('status',{sessionId:session.sessionId});
        if(local.session!==session)return;
        if(candidateFailed(status)){local.busy=false;local.jobId='';local.jobKind='';setError(status.error||status?.job?.error,'商品表生成失败。');return;}
        local.waitStatus=status;
        const artifactId=text(status?.artifactId||status?.exportArtifactId||status?.artifact?.id||status?.job?.artifactId);
        if(artifactId){await download(artifactId);return;}
        scheduleRender();queuePoll(pollExport);
      }catch(error){if(local.session!==session)return;local.busy=false;local.jobId='';setError(error,'无法读取导出进度。');}
    }
    async function download(artifactId){
      const session=local.session;const result=await call('downloadUrl',{sessionId:session.sessionId,artifactId});if(local.session!==session)return;
      const url=typeof result==='string'?result:result?.url;
      if(!url)throw Error('导出文件地址无效');
      const link=root.document.createElement('a');link.href=url;link.download='';link.rel='noopener';root.document.body.append(link);link.click();link.remove();
      local.busy=false;local.jobId='';local.jobKind='';scheduleRender();notify('商品表已生成');
    }

    function materials(){return active(getState()?.materials);}
    function sizes(){return active(getState()?.sizes).filter(size=>number(sizeWidth(size))>0&&number(sizeHeight(size))>0&&!size.needsReview);}
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
    function reason(row,key){const code=text(fieldObject(row,key).reason||row?.derived?.[`${key}Reason`]||'');return ({missing:'未识别到',multiple:'发现多个尺寸',invalid:'尺寸无效',conflict:'发现多个厚度',unknown:'没有匹配的厚度规则',ambiguous:'存在多个匹配项','material-pending':'请先选择材质','pseudo-linen':'需人工确认材质','missing-material':'材质已不可用','invalid-rule':'厚度规则已不可用'})[code]||'';}
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
        <td class="num"><strong>${money(rawValue(row,'price','salePrice'))}</strong><small>库存 ${htmlEscape(rawValue(row,'inventory','stock')??'—')}</small></td>
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
      const total=number(progressState.bytesTotal??progressState.rowsTotal);
      const rawPercent=progressState.percent??status?.percent;
      const percent=rawPercent!==undefined?number(rawPercent):completed!==null&&total>0?completed/total*100:null;
      const progress=percent===null?'':`${Math.max(0,Math.min(100,percent)).toFixed(0)}%`;
      const label=local.waitLabel||'正在处理商品表';
      return `<div class="pv4-progress pv4-lattice-wait">${waitingLoader.html({label,startedAt:local.waitStartedAt})}${progress?`<span class="pv4-wait-percent">${progress}</span>`:''}${local.jobId?`<button type="button" class="btn ghost" data-pv4-cancel>${icon('x')}取消</button>`:''}</div>`;
    }
    function candidateHtml(){
      if(!local.candidate)return '';
      const status=local.candidateStatus||{};
      if(needsSheet(status)){
        const sheets=candidateSheets();return `<section class="pv4-candidate pv4-sheet-picker"><div><strong>${htmlEscape(local.candidate.filename)}</strong><p>选择需要转表的工作表，可多选。字段默认自动识别。</p></div><div class="pv4-sheet-list">${sheets.map(sheet=>{const id=text(sheet.sheetId||sheet.id),issues=sheetIssues(sheet),available=array(sheet.header?.headers).length>0;return `<div class="pv4-sheet-option"><label><input type="checkbox" data-pv4-sheet="${htmlEscape(id)}" ${local.sheetSelection.has(id)?'checked':''} ${available&&!local.busy?'':'disabled'}><span>${htmlEscape(sheet.name||id)}<small>${!available?'未识别到表头':issues.length?'需确认 '+issues.map(key=>REQUIRED_PRODUCT_FIELDS[key]).join('、'):'已自动识别商品字段'}</small></span></label>${available?`<button type="button" class="btn ghost" data-pv4-map-sheet="${htmlEscape(id)}" ${local.busy?'disabled':''}>核对字段</button>`:''}</div>`;}).join('')}</div><div class="pv4-candidate-actions"><button type="button" class="btn" data-pv4-read-sheet ${local.busy||!local.sheetSelection.size?'disabled':''}>读取所选 ${local.sheetSelection.size} 张表</button><button type="button" class="btn ghost" data-pv4-discard ${local.busy?'disabled':''}>取消</button></div></section>`;
      }
      if(candidateReady(status)&&!local.busy)return `<section class="pv4-candidate ready"><div><strong>${htmlEscape(local.candidate.filename)}</strong><p>已完成校验，共 ${htmlEscape(status.counts?.total??status.totalRows??status.total??'—')} 条规格，来自 ${array(status.selectedSheets).length||1} 张工作表。${status.duplicateRows?`发现 ${htmlEscape(status.duplicateRows)} 条重复商品内容，已全部保留，请核对来源。`:''}校验通过后自动载入。</p></div><div class="pv4-candidate-actions"><button type="button" class="btn" data-pv4-use>重新校验</button><button type="button" class="btn ghost" data-pv4-discard>取消</button></div></section>`;
      return '';
    }
    function pagerHtml(){
      if(!local.page||local.page.totalPages<=1)return '';
      return `<nav class="pv4-pager" aria-label="商品规格分页"><button type="button" class="icon-btn" data-pv4-page="${local.pageNumber-1}" aria-label="上一页" ${local.pageNumber<=1?'disabled':''}>${icon('chevron-left')}</button><span>第 ${local.pageNumber} / ${local.page.totalPages} 页 · 共 ${local.page.total} 条</span><button type="button" class="icon-btn" data-pv4-page="${local.pageNumber+1}" aria-label="下一页" ${local.pageNumber>=local.page.totalPages?'disabled':''}>${icon('chevron-right')}</button></nav>`;
    }
    function html(){
      const selected=local.selected.size;const ready=!!local.page?.ready;
      return `<div class="product-v4" data-product-v4>
        <div class="page-header"><div class="page-heading"><h1>商品转表</h1><p class="page-sub">拖入商品表，自动识别完成即可导出。</p></div>${local.manual?`<button type="button" class="btn primary" data-pv4-export ${!ready||local.busy?'disabled':''}>${icon('download')}一键导出 Excel</button>`:''}</div>
        <div class="wide-content pv4-content">
          <section class="pv4-upload" data-pv4-dropzone aria-label="商品 Excel 上传区域" aria-disabled="${local.busy}"><div><h2>ERP 商品规格</h2><p class="pv4-drop-hint"><span>拖入一个 .xlsx 文件，或点击选择 Excel。</span><strong>松开即可导入 Excel</strong></p>${local.session?`<p class="pv4-current-file">当前会话 ${htmlEscape(local.session.filename||local.session.sessionId)}</p>`:''}</div><label class="btn pv4-file-button">${icon('file-up')}选择 Excel<input type="file" name="product-file" accept=".xlsx" aria-label="选择商品 Excel 文件" data-pv4-file ${local.busy?'disabled':''}></label></section>
          ${local.busy?progressHtml(local.waitStatus||local.candidateStatus):''}${candidateHtml()}${local.error?`<div class="pv4-error" role="alert">${htmlEscape(local.error)}<button type="button" class="icon-btn" data-pv4-dismiss aria-label="关闭提示">${icon('x')}</button></div>`:''}
          ${local.session&&!local.manual?autoHtml():local.session?`<section class="pv4-review"><button type="button" class="btn ghost" data-pv4-auto>返回自动处理</button>${local.page?.duplicateRows?`<p class="pv4-dialog-note">发现 ${htmlEscape(local.page.duplicateRows)} 条重复商品内容，原行已全部保留。</p>`:''}<div class="pv4-toolbar">${filterHtml()}<div class="pv4-actions"><span>${selected?`已选 ${selected} 条`:`本页 ${array(local.page?.rows).length} 条`}</span><button type="button" class="btn" data-pv4-batch ${!selected||local.busy?'disabled':''}>${icon('layers')}批量处理所选</button>${local.undo?`<button type="button" class="btn ghost" data-pv4-undo ${local.busy?'disabled':''}>${icon('undo-2')}撤销</button>`:''}</div></div>${tableHtml()}${pagerHtml()}</section>`:`<div class="pv4-empty"><h2>等待商品规格文件</h2><p>自动识别材质、厚度和尺寸，仅在需要时请你补充。</p></div>`}
        </div>
      </div>`;
    }

    function autoHtml(){
      if(local.busy)return '';
      const p=local.page;if(!p)return '';
      const pending=countValue(p,'pending'),total=countValue(p,'total');
      const message=p.rulesStale?'规则已变化，需要重新校验':p.ready?'已自动识别完成':total===0?'文件中没有可导出的商品规格':`还有 ${pending} 条规格需要补充`;
      return `<section class="pv4-auto-result" data-pv4-auto-result><span class="pv4-auto-icon">${icon(p.ready?'circle-check':'file-search')}</span><h2>${message}</h2><p>共 ${total} 条规格 · 已确认 ${countValue(p,'confirmed')} 条</p>${p.duplicateRows?`<p>发现 ${p.duplicateRows} 条重复商品内容，已全部保留，可在手动调整中核对。</p>`:''}<div class="pv4-auto-actions">${p.rulesStale?'<button type="button" class="btn primary" data-pv4-recompute>按当前规则重新校验</button>':p.ready?'<button type="button" class="btn primary" data-pv4-export>一键导出 Excel</button>':pending?'<button type="button" class="btn primary" data-pv4-attention>补充未识别信息</button>':''}<button type="button" class="btn ghost" data-pv4-manual>手动调整</button></div></section>`;
    }
    function openAttention(){
      if(local.busy||local.dialog||local.manual||!local.page||local.page.ready||local.page.rulesStale)return;
      const row=array(local.page.rows)[0];if(!row)return;
      const field=Recognition.attentionField(row.derived),labels={material:'材质',size:'尺寸',thickness:'厚度'};
      local.lastFocus=root.document?.activeElement;local.dialog={type:'attention',row,field,revision:local.session.revision};
      let input='';
      if(field==='material')input=`<label>选择材质<select name="attention-value" required>${materialOptions('',{allowBlank:false,compact:false})}</select></label>`;
      if(field==='thickness')input=`<label>选择厚度<select name="attention-value" required>${thicknessOptions(materialId(row),'')}</select></label>`;
      if(field==='size'){
        const candidates=array(row.derived.size.candidates).map(value=>Recognition.parseDimensions(value)).filter(value=>value.status==='value');
        const unique=[...new Map(candidates.map(value=>[value.label,value])).values()];local.dialog.sizes=unique;
        input=`${unique.length?`<label>选择原文中的尺寸<select name="attention-size"><option value="">手动输入长宽</option>${unique.map((value,index)=>`<option value="${index}">${htmlEscape(value.label)} cm</option>`).join('')}</select></label>`:''}<div class="pv4-custom-size"><label>宽 / cm<input name="attention-width" type="number" min="0" max="10000" step="any"></label><label>长 / cm<input name="attention-length" type="number" min="0" max="10000" step="any"></label></div>`;
      }
      const sameGroup=field&&['material','thickness'].includes(field)&&fieldObject(row,field).reason==='missing'&&fieldObject(row,field).source!=='manual'&&row.missingPeers>1;
      const scope=sameGroup?`<label class="pv4-overwrite"><input type="checkbox" name="attention-group" checked>应用到同一商品${field==='thickness'?'、相同材质':''}的 ${row.missingPeers} 条缺失${labels[field]}规格</label><p class="pv4-dialog-note">已有${labels[field]}、冲突值和人工确认值会保留。</p>`:'';
      const body=`<p class="pv4-dialog-note">只需补充${labels[field]||'原表信息'}，其他识别结果已保留。</p><div class="pv4-attention-source">${sourceCell(row)}</div>${field?input+scope:`<p>${htmlEscape(array(row.derived.issues).map(i=>i.message).join('；'))}。${array(row.derived.issues).some(i=>i.code==='INVALID_RULE')?'请在可复用规则中补齐重量和成本，再返回重新校验。':'请修正原 Excel 后重新导入。'}</p>`}`;
      const dialog=ensureDialog();dialog.innerHTML=field?dialogShell(`确认${labels[field]}`,body,'确认并继续'):`<div class="pv4-dialog-head"><h2 id="pv4-dialog-title">原表信息不完整</h2></div><div class="pv4-dialog-body">${body}</div><div class="pv4-dialog-foot"><button type="button" class="btn" data-pv4-dialog-close>知道了</button></div>`;
      dialog.showModal();root.lucide?.createIcons?.();dialog.querySelector('select,input')?.focus();
    }
    async function submitAttention(form,error){
      const snapshot={...local.dialog},field=snapshot.field,row=snapshot.row;let part;
      if(field==='size'){
        const selected=form.elements['attention-size']?.value,choice=selected!==undefined&&selected!==''?snapshot.sizes[Number(selected)]:null;
        const width=choice?.width??number(form.elements['attention-width'].value),length=choice?.length??number(form.elements['attention-length'].value);
        if(!(width>0&&width<=10000&&length>0&&length<=10000)){error.textContent='请选择尺寸或输入有效长宽（0–10000 cm）。';return;}part={mode:'value',width,length};
      }else{
        const value=form.elements['attention-value']?.value;if(!value){error.textContent='请选择需要补充的值。';return;}
        part=field==='material'?{mode:'value',id:value}:{mode:'value',materialId:materialId(row),ruleId:value};
      }
      const group=!!form.elements['attention-group']?.checked;
      const result=await applyReview({type:group?'group-fill-missing':'row-edit',groupId:group?row.groupId:undefined,rowIds:group?undefined:[row.rowId],patch:{[field]:part}});
      if(!result){error.textContent=local.error||'未能保存，请重试。';return;}
      closeDialog();local.offerAttention=true;scheduleRender();
    }
    async function recompute(){
      if(local.busy||!local.session)return;beginWaiting('正在按当前规则重新校验');scheduleRender();
      const session=local.session,sessionId=session.sessionId;
      try{const result=await call('recompute',{sessionId,options:{ownerToken:local.session.ownerToken,expectedSessionRevision:local.session.revision}});if(local.session!==session)return;local.jobId=result.jobId;local.jobKind='review';await waitForMutation(result.jobId,session);local.offerAttention=true;await refreshPage({silent:true});}
      catch(error){if(local.session===session)local.error=safeMessage(error,'重新校验失败，请重试。');}
      finally{if(local.session===session){local.busy=false;local.jobId='';local.jobKind='';scheduleRender();}}
    }

    function ensureDialog(){
      if(!root.document)return null;
      let dialog=root.document.getElementById('product-v4-dialog');
      if(!dialog){dialog=root.document.createElement('dialog');dialog.id='product-v4-dialog';dialog.className='pv4-dialog';dialog.setAttribute('aria-labelledby','pv4-dialog-title');root.document.body.append(dialog);dialog.addEventListener('cancel',event=>{if(local.busy)event.preventDefault();});dialog.addEventListener('click',dialogClick);dialog.addEventListener('change',dialogChange);dialog.addEventListener('input',dialogInput);dialog.addEventListener('close',()=>{if(dialog.open)return;local.dialog=null;local.lastFocus?.focus?.({preventScroll:true});local.lastFocus=null;});}
      return dialog;
    }
    function closeDialog(force=false){if(!force&&local.busy&&local.dialog?.type==='attention')return;const dialog=ensureDialog();local.dialog=null;if(dialog?.open)dialog.close();}
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
      local.dialog.fields=continueImport?issues:Object.keys(REQUIRED_PRODUCT_FIELDS);
      const fields=local.dialog.fields.map(key=>[key,REQUIRED_PRODUCT_FIELDS[key]]).map(([key,label])=>`<label>${label}<select name="map-${htmlEscape(key)}"><option value="">未选择</option>${headers.map((header,index)=>`<option value="${index}" ${mapping[key]===index?'selected':''}>第 ${index+1} 列 · ${htmlEscape(header||'空表头')}${sheet.header?.samples?.[index]?.length?' · 例：'+htmlEscape(sheet.header.samples[index].join(' / ')):''}</option>`).join('')}</select></label>`).join('');
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
      event.preventDefault();if(local.busy)return;const error=form.querySelector('[data-pv4-dialog-error]');error.textContent='';
      const currentRevision=local.dialog.type==='mapping'?local.candidate?.revision:local.session?.revision;
      if(local.dialog.revision!==currentRevision){error.textContent='复核数据已更新，请关闭后重新选择。';return;}
      let patch,overwrite=false;
      if(local.dialog.type==='replace'){const file=local.dialog.file;closeDialog();await startImport(file,true);return;}
      if(local.dialog.type==='attention'){await submitAttention(form,error);return;}
      if(local.dialog.type==='mapping'){
        const requiredMapping=Object.fromEntries(Object.keys(REQUIRED_PRODUCT_FIELDS).filter(key=>Number.isInteger(local.dialog.baseMapping[key])).map(key=>[key,local.dialog.baseMapping[key]]));for(const key of local.dialog.fields){const value=form.elements[`map-${key}`]?.value;if(value==null||value===''){error.textContent=`请选择${REQUIRED_PRODUCT_FIELDS[key]}对应的列。`;return;}requiredMapping[key]=Number(value);}if(new Set(Object.values(requiredMapping)).size!==Object.keys(requiredMapping).length){error.textContent='同一列不能同时对应多个必需字段。';return;}const mapping={...local.dialog.baseMapping,...requiredMapping};
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
      const snapshot={...local.dialog};const result=await applyReview({type:snapshot.type==='batch'?'selected-batch':'row-edit',rowIds:snapshot.rowIds,patch,overwrite});if(result)closeDialog();else error.textContent=local.error;
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
    function fileDrag(event){return Array.from(event.dataTransfer?.types||[]).includes('Files')||!!event.dataTransfer?.files?.length;}
    function dropZone(target){return target?.closest?.('[data-product-v4] [data-pv4-dropzone]');}
    function resetDrop(){root.document?.querySelector('[data-pv4-dropzone]')?.removeAttribute('data-pv4-dragging');}
    function documentDragOver(event){
      if(!local.active||!fileDrag(event))return;
      event.preventDefault();
      const zone=dropZone(event.target),available=zone&&!isBusy()&&!local.dialog;
      event.dataTransfer.dropEffect=available?'copy':'none';
      if(available)zone.setAttribute('data-pv4-dragging','true');else resetDrop();
    }
    function documentDragLeave(event){
      const zone=dropZone(event.target);
      if(!zone||!zone.contains(event.relatedTarget))resetDrop();
    }
    async function documentDrop(event){
      if(!local.active||!fileDrag(event))return;
      event.preventDefault();resetDrop();
      if(isBusy()){notify('文件正在处理中，请完成或取消后再导入');return;}
      if(local.dialog){notify('请先完成或关闭当前窗口');return;}
      if(!dropZone(event.target)){notify('请将 Excel 拖入上方上传区域');return;}
      const files=Array.from(event.dataTransfer.files||[]);
      if(Array.from(event.dataTransfer.items||[]).some(item=>item.webkitGetAsEntry?.()?.isDirectory)){notify('请拖入 .xlsx 文件，不支持文件夹');return;}
      if(files.length!==1){notify('每次只能导入一个 .xlsx 文件');return;}
      await startImport(files[0]);
    }
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
      if(button.matches('[data-pv4-manual]')){closeDialog();local.manual=true;local.offerAttention=false;local.page=null;local.pageNumber=1;await refreshPage();return;}
      if(button.matches('[data-pv4-auto]')){local.manual=false;local.offerAttention=true;local.page=null;await refreshPage();return;}
      if(button.matches('[data-pv4-attention]')){openAttention();return;}
      if(button.matches('[data-pv4-recompute]')){await recompute();return;}
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
      root.document.addEventListener('dragenter',documentDragOver);
      root.document.addEventListener('dragover',documentDragOver);
      root.document.addEventListener('dragleave',documentDragLeave);
      root.document.addEventListener('drop',documentDrop);
      root.document.addEventListener('dragend',resetDrop);
    }
    function syncChecks(){
      const scope=root.document?.querySelector('[data-product-v4]');if(!scope)return;
      const visible=pageRows(),selected=visible.filter(id=>local.selected.has(id)).length,pageCheck=scope.querySelector('[data-pv4-select-page]');
      if(pageCheck){pageCheck.checked=!!visible.length&&selected===visible.length;pageCheck.indeterminate=selected>0&&selected<visible.length;}
      scope.querySelectorAll('[data-pv4-select-group]').forEach(check=>{const ids=text(check.dataset.groupRows).split(',').filter(Boolean),count=ids.filter(id=>local.selected.has(id)).length;check.checked=!!ids.length&&count===ids.length;check.indeterminate=count>0&&count<ids.length;});
    }
    function activate(context={}){
      local.active=true;refreshContext(context,{render:false});bind();ensureDialog();syncChecks();waitingLoader.activate(root.document?.querySelector('[data-product-v4]'));root.lucide?.createIcons?.();
      if(local.session&&!local.page&&!local.busy)refreshPage();
      else if(local.offerAttention&&!local.manual&&!local.busy&&!local.dialog&&!local.candidate){local.offerAttention=false;openAttention();}
      return api;
    }
    function deactivate(){
      waitingLoader.stop();resetDrop();
      local.active=false;closeDialog();local.filter='all';local.missingThickness=false;local.moreOpen=false;local.pageNumber=1;local.selected.clear();local.page=null;
    }
    function refreshContext(context={},settings={}){
      const previousWorkspace=text(local.context.workspaceId),previousEpoch=text(local.context.storageEpoch);local.context={...local.context,...context};
      if((previousWorkspace&&text(local.context.workspaceId)!==previousWorkspace)||(previousEpoch&&text(local.context.storageEpoch)!==previousEpoch)){
        clearPoll();local.contextSerial++;local.requestSerial++;closeDialog(true);local.session=null;local.candidate=null;local.candidateStatus=null;local.page=null;local.selected.clear();local.busy=false;local.jobId='';local.jobKind='';local.undo=null;local.error='工作区已切换，请重新选择商品规格文件。';
      }
      if(settings.render!==false)scheduleRender();return api;
    }
    async function restoreSession(session){
      if(!session?.sessionId||!session?.ownerToken)throw Error('文件会话信息不完整');
      clearPoll();local.contextSerial++;local.requestSerial++;local.manual=false;local.offerAttention=true;local.busy=false;local.jobId='';local.session={...session};local.candidate=null;local.candidateStatus=null;local.page=null;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;local.error='';
      await refreshPage();return api;
    }
    function isBusy(){return local.busy||!!local.jobId;}
    function canQuit(){return !isBusy()&&!local.dialog&&!local.candidate;}
    function destroy(){
      waitingLoader.stop();resetDrop();
      clearPoll();local.destroyed=true;local.active=false;
      if(local.listeners&&root.document){root.document.removeEventListener('click',documentClick);root.document.removeEventListener('change',documentChange);root.document.removeEventListener('submit',dialogSubmit);}
      if(local.listeners&&root.document){root.document.removeEventListener('dragenter',documentDragOver);root.document.removeEventListener('dragover',documentDragOver);root.document.removeEventListener('dragleave',documentDragLeave);root.document.removeEventListener('drop',documentDrop);root.document.removeEventListener('dragend',resetDrop);}
      local.dialog=null;root.document?.getElementById('product-v4-dialog')?.remove();
    }
    function inspect(){return {manual:local.manual,session:local.session&&{...local.session},candidate:local.candidate&&{...local.candidate},filter:local.filter,missingThickness:local.missingThickness,pageNumber:local.pageNumber,selected:[...local.selected],busy:isBusy()};}

    const api={html,activate,deactivate,refreshContext,restoreSession,refresh:refreshPage,isBusy,canQuit,destroy,inspect};
    return api;
  }

  return {create,truncateId,canonicalRules,PAGE_SIZE};
});
