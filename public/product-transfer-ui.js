(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ProductTransferUI=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';

  const Recognition=typeof module==='object'&&module.exports?require('./product-recognition.js'):root.ProductRecognition;
  const Commands=typeof module==='object'&&module.exports?require('./product-transfer/commands.js'):root.ProductTransferCommands;
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

  function create(options={}){
    const getState=typeof options.getState==='function'?options.getState:()=>({});
    const rerender=typeof options.render==='function'?options.render:()=>{};
    const notify=typeof options.toast==='function'?options.toast:()=>{};
    const waitingLoader=Loader.create();
    const local={
      setup:false,setupDirty:false,setupSession:'',uniformChoices:{},materialAssignments:{},assignmentCounts:{},unknownMaterial:'',materialPage:1,manual:false,offerAttention:false,contextSerial:0,context:{},session:null,candidate:null,candidateStatus:null,page:null,pageNumber:1,
      expandedGroupId:'',groupPage:1,groupRows:null,search:'',preferencesKey:'',thicknessDefaults:{},filter:'all',missingThickness:false,moreOpen:false,selected:new Set(),
      busy:false,waitStartedAt:0,waitLabel:'',waitStatus:null,jobId:'',jobKind:'',error:'',requestSerial:0,pollTimer:0,dialog:null,lastFocus:null,
      sheetSelection:new Set(),sheetMappings:{},selectionInitialized:false,undo:null,active:false,destroyed:false,listeners:false
    };

    const commands=Commands.create({request:call,waitForJob:waitForMutation,newId:mutationId});

    async function call(action,payload={}){
      if(typeof options.request==='function')return options.request(action,payload);
      const jobs=root.FileJobs;
      if(!jobs)throw Error('文件处理服务尚未加载');
      if(action==='create')return jobs.create(payload.kind,payload.target,payload.rules);
      if(action==='upload')return jobs.upload(payload.sessionId,payload.file,{ownerToken:payload.ownerToken});
      if(action==='status')return jobs.status(payload.sessionId);
      if(action==='selectSheet')return jobs.selectSheet(payload.sessionId,payload.options);
      if(action==='rows')return jobs.rows(payload.sessionId,payload.query);
      if(action==='mutationStatus')return jobs.mutationStatus(payload.sessionId,payload.kind,payload.command);
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
        const page=await call('rows',{sessionId:local.session.sessionId,query:{view:local.manual?'products':'rows',materialPage:local.materialPage,search:local.search,attention:!local.manual,status:local.filter,missingThickness:local.missingThickness,page:local.pageNumber,pageSize:PAGE_SIZE}});
        if(serial!==local.requestSerial||local.session?.sessionId!==sessionId)return;
        const totalPages=Math.max(1,Number(page?.totalPages)||Math.ceil((Number(page?.total)||0)/PAGE_SIZE)||1);
        if(local.pageNumber>totalPages){local.pageNumber=totalPages;return refreshPage({silent:true});}
        local.pageNumber=Number(page?.page)||local.pageNumber;
        local.page={...page,page:Number(page?.page)||local.pageNumber,pageSize:PAGE_SIZE,totalPages};
        local.session.revision=Number(page?.revision??local.session.revision);
        if(local.manual){
          if(local.expandedGroupId&&!array(page.groups).some(g=>g.groupId===local.expandedGroupId))resetGroup();
          if(!local.expandedGroupId&&local.search&&array(page.groups).length===1)local.expandedGroupId=page.groups[0].groupId;
          local.groupRows=null;
          if(local.expandedGroupId){
            const groupId=local.expandedGroupId,detail=await call('rows',{sessionId,query:{groupId,search:local.search,status:local.filter,page:local.groupPage,pageSize:PAGE_SIZE}});
            if(serial!==local.requestSerial||local.session?.sessionId!==sessionId||local.expandedGroupId!==groupId)return;
            if(detail.revision!==page.revision)throw Error('商品数据已更新，请重新展开。');
            local.groupRows=detail;local.groupPage=detail.page;
          }
        }
        reconcileSelection(page?.rows);
      }catch(error){if(serial===local.requestSerial)local.error=safeMessage(error,'复核列表读取失败。');}
      finally{if(serial===local.requestSerial){local.busy=false;scheduleRender();}}
    }

    function resetGroup(){local.expandedGroupId='';local.groupPage=1;local.groupRows=null;}

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
        const options={selections,rules:stateRules(),requireThicknessSetup:true,ownerToken:local.candidate.ownerToken,expectedSessionRevision:Number(local.candidateStatus?.revision??local.candidate.revision)};
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
        local.candidate=null;local.candidateStatus=null;local.page=page;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;local.setup=true;local.setupSession='';local.setupDirty=false;local.manual=false;local.search='';resetGroup();local.offerAttention=false;local.requestSerial++;
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
      const command={action:{type,...(type==='selected-batch'?{overwrite:!!overwrite}:{})},patch};
      if(rowIds)command.rowIds=rowIds;
      if(groupId)command.groupId=groupId;
      beginWaiting('正在保存复核结果');local.error='';scheduleRender();
      try{
        const result=await commands.run('review',session,command);
        if(local.session!==session)return null;
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
      local.jobId=text(jobId);local.jobKind='review';
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
      const session=local.session;beginWaiting('正在撤销修改');scheduleRender();
      try{
        const result=await commands.run('undo',session,{action:{type:'undo'}});if(local.session!==session||local.destroyed)return;
        updateSessionRevision(result);local.undo=null;await refreshPage({silent:true});notify('已撤销上次同链接修改');
      }catch(error){if(local.session===session&&!local.destroyed)local.error=safeMessage(error,'撤销结果待核对。');}
      finally{if(local.session===session&&!local.destroyed){local.busy=false;scheduleRender();}}
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
      return `<nav class="pv4-pager" aria-label="商品规格分页"><button type="button" class="icon-btn" data-pv4-page="${local.pageNumber-1}" aria-label="上一页" ${local.pageNumber<=1?'disabled':''}>${icon('chevron-left')}</button><span>第 ${local.pageNumber} / ${local.page.totalPages} 页 · 共 ${local.page.total} ${local.manual?'个商品':'条'}</span><button type="button" class="icon-btn" data-pv4-page="${local.pageNumber+1}" aria-label="下一页" ${local.pageNumber>=local.page.totalPages?'disabled':''}>${icon('chevron-right')}</button></nav>`;
    }
    function thicknessSetup(){return !!local.session&&(local.setup||local.page?.thicknessConfigured===false);}
    function summary(){return local.page?.materialSummary||{materials:[],unknown:0,unknownGroups:[],groupCount:0,page:1,totalPages:1};}
    function loadPreferences(){
      const current=target(),key=`mat-product-thickness:${current.workspaceId}:${current.storageEpoch||''}`;
      if(local.preferencesKey===key)return;local.preferencesKey=key;local.thicknessDefaults={};
      try{const value=JSON.parse(root.localStorage?.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))local.thicknessDefaults=value;}catch{}
    }
    function setupMaterials(){
      const counts=new Map(summary().materials.map(m=>[m.materialId,m.count]));
      if(local.unknownMaterial&&![CUSTOM,KEEP].includes(local.unknownMaterial))counts.set(local.unknownMaterial,(counts.get(local.unknownMaterial)||0)+summary().unknown);
      for(const [groupId,id] of Object.entries(local.unknownMaterial===CUSTOM?local.materialAssignments:{}))if(id&&id!==KEEP)counts.set(id,(counts.get(id)||0)+(local.assignmentCounts[groupId]||0));
      return [...counts].map(([id,count])=>({material:materialById(id),count})).filter(x=>x.material&&!x.material.deleted);
    }
    function initializeSetup(){
      loadPreferences();if(local.setupSession===local.session?.sessionId)return;
      local.setupSession=local.session?.sessionId||'';local.uniformChoices={...local.thicknessDefaults,...local.page?.thicknessDefaults};local.materialAssignments={};local.assignmentCounts={};local.unknownMaterial='';local.materialPage=1;local.setupDirty=false;
    }
    function fileInput(label='选择 Excel',primary=false){return `<label class="btn ${primary?'primary':''} pv4-file-button">${icon('file-up')}${label}<input type="file" name="product-file" accept=".xlsx" aria-label="选择商品 Excel 文件" data-pv4-file ${local.busy?'disabled':''}></label>`;}
    function unknownHtml(){
      const s=summary();if(!s.unknown)return '';
      const example=array(s.unknownGroups).slice(0,3).map(g=>g.productName).join('、');
      const options=materialOptions([CUSTOM,KEEP].includes(local.unknownMaterial)?'':local.unknownMaterial,{allowBlank:false,compact:false}).replace('请选择材质','请选择这些商品的材质');
      const groups=local.unknownMaterial===CUSTOM?`<div class="pv5-unknown-list">${array(s.unknownGroups).map(g=>`<label class="pv5-unknown-row"><span><strong>${htmlEscape(g.productName)}</strong><small>${htmlEscape(g.examples.join(' / '))} · ${g.count} 条规格</small></span><select name="group-material" aria-label="${htmlEscape(g.productName)}的材质" data-pv5-assign="${htmlEscape(g.groupId)}" ${local.busy?'disabled':''}>${materialOptions(local.materialAssignments[g.groupId]===KEEP?'':local.materialAssignments[g.groupId]||'',{allowBlank:false,compact:false})}<option value="${KEEP}" ${local.materialAssignments[g.groupId]===KEEP?'selected':''}>复杂情况，稍后处理</option></select></label>`).join('')}</div>${s.totalPages>1?`<div class="pv5-material-pager"><button type="button" class="btn ghost" data-pv5-material-page="${s.page-1}" ${s.page<=1||local.busy?'disabled':''}>上一页</button><span>${s.page} / ${s.totalPages} 页</span><button type="button" class="btn ghost" data-pv5-material-page="${s.page+1}" ${s.page>=s.totalPages||local.busy?'disabled':''}>下一页</button></div>`:''}`:'';
      return `<section class="pv5-unknown"><div><h3>先确认 ${s.unknown} 条规格的材质</h3><p>原文未标明材质，或同时出现多个材质。${htmlEscape(example)}${s.groupCount>3?'等':''}。</p></div><label class="pv5-unknown-choice"><span>这些商品的材质</span><select name="unknown-material" data-pv5-unknown ${local.busy?'disabled':''}>${options}<option value="${CUSTOM}" ${local.unknownMaterial===CUSTOM?'selected':''}>材质不同，分别指定</option><option value="${KEEP}" ${local.unknownMaterial===KEEP?'selected':''}>复杂情况，稍后手动处理</option></select></label>${groups}</section>`;
    }
    function setupHtml(){
      initializeSetup();const entries=setupMaterials();
      return `<section class="pv5-setup" data-pv5-setup><div class="pv5-section-title"><h2>为这份表统一材质和厚度</h2><p>每种材质只选一次，应用到对应的全部商品。</p></div>${unknownHtml()}<form data-pv5-uniform-form><div class="pv5-material-list">${entries.map(({material,count})=>{const selected=local.uniformChoices[material.id]||'',available=active(material.weightRules);return `<label class="pv5-material-row"><span><strong>${htmlEscape(material.name)}</strong><small>${count} 条规格</small></span><span class="pv5-thickness-field"><span>统一厚度</span><select name="uniform-${htmlEscape(material.id)}" aria-label="${htmlEscape(material.name)}统一厚度" data-pv5-uniform="${htmlEscape(material.id)}" ${local.busy?'disabled':''}>${thicknessOptions(material.id,selected)}${available.length?'':'<option value="__later__">暂无厚度规则，稍后处理</option>'}</select></span></label>`;}).join('')||(!summary().unknown?'<p class="pv5-note">没有可统一的材质，可继续查看结果。</p>':'')}</div><div class="pv5-step-foot"><p>选定厚度会覆盖原表厚度。少数不同厚度的商品，可在下一步单独修改。</p><div>${local.page?.thicknessConfigured?'<button type="button" class="btn ghost" data-pv5-cancel-setup>取消</button>':''}<button type="submit" class="btn primary" ${local.busy?'disabled':''}>确认并生成${icon('arrow-right')}</button></div></div></form></section>`;
    }
    function resultHtml(){
      const p=local.page;if(!p)return '';const pending=countValue(p,'pending'),total=countValue(p,'total');
      return `<section class="pv5-result" data-pv4-auto-result><div class="pv5-result-title">${icon(p.ready?'circle-check':'file-check')}<h2>${p.rulesStale?'规则已更新，需要重新计算':p.ready?'商品表已准备好':`还需处理 ${pending} 条特殊规格`}</h2><p>${total} 条规格 · ${countValue(p,'confirmed')} 条已完成</p></div><div class="pv5-applied">${setupMaterialsFromPage().map(({name,label,count})=>`<p><strong>${htmlEscape(name)}</strong><span>${htmlEscape(label)}</span><small>${count} 条</small></p>`).join('')}</div><div class="pv5-result-actions">${p.rulesStale?'<button type="button" class="btn primary" data-pv4-recompute>按当前规则重新计算</button>':p.ready?'<button type="button" class="btn primary" data-pv4-export>一键导出 Excel</button>':'<button type="button" class="btn primary" data-pv5-pending>处理特殊规格</button>'}<button type="button" class="btn ${p.ready?'':'ghost'}" data-pv4-manual>手动调整</button></div><button type="button" class="btn ghost pv5-reset" data-pv5-setup>重新统一厚度</button>${p.duplicateRows?`<p class="pv5-note">原表有 ${p.duplicateRows} 条重复内容，已按原样保留。</p>`:''}</section>`;
    }
    function setupMaterialsFromPage(){
      return summary().materials.map(item=>{
        const material=materialById(item.materialId),thicknesses=array(summary().thicknesses).map(t=>({rule:material?.weightRules?.find(r=>`${item.materialId}:${r.id}`===t.value),count:t.count})).filter(t=>t.rule),covered=thicknesses.reduce((n,t)=>n+t.count,0);
        const label=thicknesses.length>1?'多种厚度（已单独调整）':thicknesses.length?thicknessLabel(thicknesses[0].rule)+(covered<item.count?' · 部分待确认':''):'厚度待确认';
        return {name:material?.name||'未知材质',label,count:item.count};
      });
    }
    function searchHtml(){return `<form class="pv5-search" data-pv4-search-form role="search">${icon('search')}<input type="search" name="product-search" aria-label="搜索商品" placeholder="搜索商品名称、ID、SKU 或规格" maxlength="200" value="${htmlEscape(local.search)}" ${local.busy?'disabled':''}><button type="submit" class="btn" ${local.busy?'disabled':''}>搜索</button>${local.search?'<button type="button" class="btn ghost" data-pv4-clear-search>清除</button>':''}</form>`;}
    function groupValues(group){
      const material=materialById(group.materialState),rule=material?.weightRules?.find(r=>`${material.id}:${r.id}`===group.thicknessState);
      return `${material?.name||(group.materialState==='mixed'?'多种材质':'材质待确认')} · ${rule?thicknessLabel(rule):group.thicknessState==='mixed'?'多种厚度':'厚度待确认'}`;
    }
    function skuHtml(row){
      const d=row.derived,status=statusLabel(row),material=materialById(materialId(row)),rule=material?.weightRules?.find(r=>r.id===thicknessId(row));
      return `<article class="pv5-item pv6-sku" data-pv4-row="${row.rowId}"><div class="pv5-item-source"><h4>${htmlEscape(d.specName||'未命名规格')}</h4><small>SKU ${htmlEscape(d.skuId||'未提供')} · ${htmlEscape(row.sheetName)}第 ${row.sourceRow} 行</small></div><div class="pv5-item-values"><p>${htmlEscape(material?.name||'材质待确认')} · ${htmlEscape(rule?thicknessLabel(rule):'厚度待确认')}</p><small>${htmlEscape(d.size?.label||'尺寸待确认')} · ${number(d.weight)===null?'重量待计算':Number(d.weight).toFixed(3)+' kg'} · ${money(d.cost)}</small>${d.issues?.length?`<small class="pv5-item-issue">${htmlEscape(d.issues.map(i=>i.message).join('；'))}</small>`:''}</div><div class="pv5-item-action"><span class="pv4-status ${status[1]}">${status[0]}</span><button type="button" class="btn" data-pv5-edit="${row.rowId}" ${local.busy?'disabled':''}>修改</button></div></article>`;
    }
    function groupDetailHtml(group,index){
      const page=local.groupRows;
      return `<div class="pv6-skus" id="pv6-skus-${index}" role="region" aria-label="${htmlEscape(group.productName)}的 SKU">${page?`<p class="pv6-sku-count">${local.search||local.filter!=='all'?`符合筛选 ${page.total} 条 / 商品共 ${group.total} 条 SKU`:`共 ${group.total} 条 SKU`}</p>${array(page.rows).map(skuHtml).join('')||'<p class="pv5-note">当前筛选下没有 SKU。</p>'}${page.totalPages>1?`<nav class="pv4-pager" aria-label="商品内 SKU 分页"><button type="button" class="btn ghost" data-pv6-sku-page="${page.page-1}" ${page.page<=1||local.busy?'disabled':''}>上一页 SKU</button><span>SKU 第 ${page.page} / ${page.totalPages} 页</span><button type="button" class="btn ghost" data-pv6-sku-page="${page.page+1}" ${page.page>=page.totalPages||local.busy?'disabled':''}>下一页 SKU</button></nav>`:''}`:`<p class="pv5-note" role="status">${local.busy?'正在读取 SKU…':'SKU 未能加载，可收起后重新展开。'}</p>`}</div>`;
    }
    function manualHtml(){
      const groups=array(local.page?.groups),counts=local.page?.productCounts||{};
      return `<section class="pv5-manual"><div class="pv5-manual-head"><div><h2>手动调整</h2><p>按商品统一材质和厚度，展开后可单独修改 SKU。</p></div><button type="button" class="btn" data-pv4-auto>完成调整</button></div>${searchHtml()}<div class="pv5-list-tools"><div role="group" aria-label="商品筛选"><button type="button" class="btn ghost" data-pv4-filter="all" aria-pressed="${local.filter==='all'}">全部 ${counts.total??0} 个商品</button><button type="button" class="btn ghost" data-pv4-filter="pending" aria-pressed="${local.filter==='pending'}">待处理 ${counts.pending??0}</button></div><span>${local.search?`找到 ${local.page?.total||0} 个商品 · ${local.page?.matchedRows||0} 条 SKU`:`共 ${countValue(local.page,'total')} 条 SKU`}</span></div>${local.undo?'<div class="pv6-undo" role="status">已统一修改商品<button type="button" class="btn ghost" data-pv6-undo>撤销这次修改</button></div>':''}<div class="pv6-products">${groups.map((g,index)=>{const expanded=local.expandedGroupId===g.groupId;return `<article class="pv6-product" data-pv6-product="${htmlEscape(g.groupId)}"><div class="pv6-product-head"><button type="button" class="pv6-disclosure" data-pv6-expand="${htmlEscape(g.groupId)}" aria-expanded="${expanded}" ${expanded?`aria-controls="pv6-skus-${index}"`:''} ${local.busy?'disabled':''}>${icon(expanded?'chevron-down':'chevron-right')}<span><strong>${htmlEscape(g.productName)}</strong><small>${htmlEscape(g.platform)} · ${htmlEscape(g.shop)} · 商品 ${htmlEscape(g.productId||'ID 未提供')} · ${g.total} 条 SKU</small></span></button><div class="pv6-product-summary"><p>${htmlEscape(groupValues(g))}</p><span class="pv4-status ${g.pending?'pending':'confirmed'}">${g.pending?`${g.pending} 条待处理`:'全部已确认'}</span></div><button type="button" class="btn" data-pv6-unify="${htmlEscape(g.groupId)}" ${local.busy?'disabled':''}>统一修改</button></div>${expanded?groupDetailHtml(g,index):''}</article>`;}).join('')||'<div class="pv5-no-results"><h3>没有匹配的商品</h3><p>换个关键词，或清除搜索查看全部。</p></div>'}</div>${pagerHtml()}</section>`;
    }
    function html(){
      loadPreferences();const step=!local.session?1:thicknessSetup()?2:3;
      return `<div class="product-v4 product-v5" data-product-v4><div class="page-header"><div class="page-heading"><h1>商品转表</h1><p class="page-sub">导入商品表，统一厚度，确认导出。</p></div></div><div class="pv5-content"><ol class="pv5-steps" role="list">${['导入表格','材质与厚度','确认导出'].map((label,i)=>`<li ${step===i+1?'aria-current="step"':''} data-complete="${step>i+1}"><span>${i+1}</span>${label}</li>`).join('')}</ol>${local.session?`<section class="pv5-file" data-pv4-dropzone aria-label="商品 Excel 上传区域">${icon('file-spreadsheet')}<div><strong class="pv4-current-file">${htmlEscape(local.session.filename||'当前商品表')}</strong><p>${countValue(local.page,'total')} 条规格</p></div>${fileInput('换一份表')}</section>`:!local.busy&&!local.candidate?`<section class="pv5-upload" data-pv4-dropzone aria-label="商品 Excel 上传区域"><div class="pv4-drop-hint"><h2>把商品 Excel 拖到这里</h2><p>支持 .xlsx，导入后只需按材质统一一次厚度。</p><strong>松开即可导入 Excel</strong></div>${fileInput('选择 Excel',true)}</section>`:`<section class="pv5-file" data-pv4-dropzone aria-label="商品 Excel 上传区域"><strong>正在读取商品表</strong>${fileInput('选择 Excel')}</section>`}${local.busy?progressHtml(local.waitStatus||local.candidateStatus):''}${candidateHtml()}${local.error?`<div class="pv4-error" role="alert">${htmlEscape(local.error)}<button type="button" class="icon-btn" data-pv4-dismiss aria-label="关闭提示">${icon('x')}</button></div>`:''}${local.session&&!local.candidate?(thicknessSetup()?setupHtml():local.manual?manualHtml():local.busy?'':resultHtml()):''}</div></div>`;
    }
    async function submitUniform(){
      if(local.busy)return;initializeSetup();const s=summary(),entries=setupMaterials();
      if(s.unknown&&!local.unknownMaterial){local.error='请先确认未识别商品的材质。';scheduleRender();return;}
      if(local.unknownMaterial===CUSTOM&&Object.keys(local.materialAssignments).length<s.groupCount){local.error='请为未识别商品指定材质；复杂情况可选择稍后处理。';scheduleRender();return;}
      const defaults={};for(const {material} of entries){const id=local.uniformChoices[material.id];if(!id){local.error=`请选择${material.name}的统一厚度。`;scheduleRender();return;}if(id!=='__later__')defaults[material.id]=id;}
      try{Recognition.normalizeThicknessDefaults(defaults,stateRules());}catch(error){local.error=safeMessage(error);scheduleRender();return;}
      const assignments=local.unknownMaterial===CUSTOM?Object.fromEntries(Object.entries(local.materialAssignments).filter(([,id])=>id!==KEEP)):{},fallbackMaterialId=local.unknownMaterial&&![CUSTOM,KEEP].includes(local.unknownMaterial)?local.unknownMaterial:'';
      if(await recompute({thicknessDefaults:defaults,applyUniformThickness:true,materialAssignments:assignments,fallbackMaterialId})){
        local.setup=false;local.setupDirty=false;local.manual=false;local.thicknessDefaults={...local.thicknessDefaults,...defaults};try{root.localStorage?.setItem(local.preferencesKey,JSON.stringify(local.thicknessDefaults));}catch{}scheduleRender();
      }
    }
    async function searchProducts(value){if(local.busy||!local.session)return;local.search=text(value).trim().slice(0,200);local.manual=true;local.filter='all';local.pageNumber=1;resetGroup();await refreshPage();}
    async function recompute(extra={}){
      if(local.busy||!local.session)return false;beginWaiting(extra.applyUniformThickness?'正在统一材质和厚度':'正在重新计算');local.error='';scheduleRender();const session=local.session;
      try{const finished=await commands.run('recompute',session,{...extra,action:{type:'recompute'}});if(local.session!==session)return false;updateSessionRevision(finished);local.undo=null;await refreshPage({silent:true});return true;}
      catch(error){if(local.session===session)local.error=safeMessage(error,'计算未完成，选择已保留，可重试。');return false;}
      finally{if(local.session===session){local.busy=false;local.jobId='';local.jobKind='';scheduleRender();}}
    }

    function ensureDialog(){
      if(!root.document)return null;
      let dialog=root.document.getElementById('product-v4-dialog');
      if(!dialog){dialog=root.document.createElement('dialog');dialog.id='product-v4-dialog';dialog.className='pv4-dialog';dialog.setAttribute('aria-labelledby','pv4-dialog-title');root.document.body.append(dialog);dialog.addEventListener('cancel',event=>{if(local.busy)event.preventDefault();});dialog.addEventListener('click',dialogClick);dialog.addEventListener('change',dialogChange);dialog.addEventListener('input',dialogInput);dialog.addEventListener('close',()=>{if(dialog.open)return;local.dialog=null;local.lastFocus?.focus?.({preventScroll:true});local.lastFocus=null;});}
      return dialog;
    }
    function closeDialog(force=false){if(!force&&local.busy)return;const dialog=ensureDialog();local.dialog=null;if(dialog?.open)dialog.close();}
    function dialogShell(title,body,submitLabel='应用修改'){
      return `<form method="dialog" data-pv4-dialog-form><div class="pv4-dialog-head"><h2 id="pv4-dialog-title">${htmlEscape(title)}</h2><button type="button" class="icon-btn" data-pv4-dialog-close aria-label="关闭">${icon('x')}</button></div><div class="pv4-dialog-body">${body}<p class="pv4-dialog-error" role="alert" data-pv4-dialog-error></p></div><div class="pv4-dialog-foot"><button type="button" class="btn ghost" data-pv4-dialog-close>取消</button><button type="submit" class="btn primary">${htmlEscape(submitLabel)}</button></div></form>`;
    }
    function openRow(rowId){
      if(local.busy)return;const row=array(local.groupRows?.rows).find(r=>String(r.rowId)===String(rowId));if(!row)return;
      local.lastFocus=root.document.activeElement;local.dialog={type:'row',row,revision:local.session.revision};
      const material=materialId(row),size=fieldObject(row,'size'),dialog=ensureDialog();
      dialog.innerHTML=dialogShell('调整这条规格',`<div class="pv5-edit-source"><h3>${htmlEscape(row.derived.productName)}</h3><p>${htmlEscape(row.derived.specName)}</p><small>SKU ${htmlEscape(row.derived.skuId)} · 原表第 ${row.sourceRow} 行</small></div><div class="pv5-edit-grid"><label>材质<select name="edit-material">${materialOptions(material,{allowBlank:false,compact:false})}</select></label><label>厚度<select name="edit-thickness" ${material?'':'disabled'}>${thicknessOptions(material,thicknessId(row))}</select></label><label>宽 / cm<input name="edit-width" type="number" min="0" max="10000" step="any" value="${size.status==='value'?size.width:''}"></label><label>长 / cm<input name="edit-length" type="number" min="0" max="10000" step="any" value="${size.status==='value'?size.length:''}"></label></div>${row.derived.issues?.some(i=>['MISSING_FIELD','INVALID_RULE'].includes(i.code))?`<p class="pv5-note">${htmlEscape(row.derived.issues.filter(i=>['MISSING_FIELD','INVALID_RULE'].includes(i.code)).map(i=>i.message).join('；'))}。原表缺失信息请补齐后重新导入；规则成本和重量请在可复用规则中补齐。</p>`:''}<p class="pv5-note">只修改这一条规格，其余商品保持不变。</p>`,'保存修改');dialog.showModal();dialog.querySelector('select')?.focus();
    }
    async function submitRow(form,error){
      const snapshot=local.dialog,row=snapshot.row,material=form.elements['edit-material'].value,rule=form.elements['edit-thickness'].value,width=number(form.elements['edit-width'].value),length=number(form.elements['edit-length'].value),size=fieldObject(row,'size'),patch={};
      if(!material||!rule){error.textContent='请选择材质和厚度。';return;}
      if(material!==materialId(row))patch.material={mode:'value',id:material};
      if(material!==materialId(row)||rule!==thicknessId(row))patch.thickness={mode:'value',materialId:material,ruleId:rule};
      if(width!==number(size.width)||length!==number(size.length)||size.status==='pending'){
        if(!(width>0&&length>0&&width<=10000&&length<=10000)){error.textContent='请输入有效尺寸，宽和长需在 0–10000 cm 之间。';return;}patch.size={mode:'value',width,length};
      }
      if(!Object.keys(patch).length){closeDialog();return;}
      const controls=[...form.querySelectorAll('input,select,button')];controls.forEach(e=>e.disabled=true);const result=await applyReview({type:'row-edit',rowIds:[row.rowId],patch});if(local.dialog!==snapshot)return;
      if(result)closeDialog();else{controls.forEach(e=>e.disabled=false);error.textContent=local.error||'修改未保存，请重试。';}
    }
    function openGroup(groupId){
      const group=array(local.page?.groups).find(g=>g.groupId===groupId);if(!group||local.busy)return;
      local.lastFocus=root.document.activeElement;local.dialog={type:'group',group,revision:local.session.revision};
      const material=materialById(group.materialState),dialog=ensureDialog();
      dialog.innerHTML=dialogShell('统一修改此商品',`<div class="pv5-edit-source"><h3>${htmlEscape(group.productName)}</h3><p>${htmlEscape(group.platform)} · ${htmlEscape(group.shop)} · 商品 ${htmlEscape(group.productId||'ID 未提供')}</p><small>将应用到此商品全部 ${group.total} 条 SKU，包含未展开及未匹配搜索的规格。</small></div><div class="pv5-edit-grid"><label>材质<select name="group-material"><option value="${KEEP}">保留各 SKU 原材质</option>${materialOptions('',{allowBlank:false,placeholder:false,compact:false})}</select></label><label>厚度<select name="group-thickness" ${material?'':'disabled'}><option value="${KEEP}">保留各 SKU 原厚度</option>${material?thicknessOptions(material.id,'',{placeholder:false}):''}</select></label></div><p class="pv5-note" data-pv6-group-note>${material?'只覆盖你选择修改的字段，个别 SKU 的厚度例外也会被所选厚度覆盖。':'此商品包含多种或未确认材质，请先选择统一材质，再选择对应厚度。'}</p>`,'应用到全部 SKU');dialog.showModal();dialog.querySelector('select')?.focus();
    }
    async function submitGroup(form,error){
      const snapshot=local.dialog,group=snapshot.group,material=form.elements['group-material'].value,thickness=form.elements['group-thickness'].value,patch={},effective=material===KEEP?group.materialState:material;
      if(material!==KEEP){if(!material||!thickness||thickness===KEEP){error.textContent='统一材质时，请同时选择对应厚度。';return;}patch.material={mode:'value',id:material};}
      if(thickness&&thickness!==KEEP)patch.thickness={mode:'value',materialId:effective,ruleId:thickness};
      if(!Object.keys(patch).length){error.textContent='请选择需要统一的材质或厚度。';return;}
      const controls=[...form.querySelectorAll('input,select,button')],disabled=controls.map(e=>e.disabled);controls.forEach(e=>e.disabled=true);
      const result=await applyReview({type:'group-unify',groupId:group.groupId,patch});if(local.dialog!==snapshot)return;
      if(result)closeDialog();else{controls.forEach((e,i)=>e.disabled=disabled[i]);error.textContent=local.error||'修改未保存，请重试。';}
    }
    function openMapping(sheet,continueImport=false){
      const headers=array(sheet?.header?.headers),mapping=sheetMapping(sheet),issues=sheetIssues(sheet);if(!headers.length){notify('所选工作表没有可用表头');return;}
      local.lastFocus=root.document.activeElement;local.dialog={type:'mapping',continueImport,sheetId:text(sheet.sheetId||sheet.id),revision:local.candidate?.revision,baseMapping:Object.fromEntries(Object.entries(mapping).filter(([,value])=>Number.isInteger(value)))};local.dialog.fields=continueImport?issues:Object.keys(REQUIRED_PRODUCT_FIELDS);
      const fields=local.dialog.fields.map(key=>`<label>${REQUIRED_PRODUCT_FIELDS[key]}<select name="map-${htmlEscape(key)}"><option value="">未选择</option>${headers.map((header,index)=>`<option value="${index}" ${mapping[key]===index?'selected':''}>第 ${index+1} 列 · ${htmlEscape(header||'空表头')}${sheet.header?.samples?.[index]?.length?' · 例：'+htmlEscape(sheet.header.samples[index].join(' / ')):''}</option>`).join('')}</select></label>`).join('');
      const dialog=ensureDialog();dialog.innerHTML=dialogShell('确认表格字段',`<p class="pv4-dialog-note">${htmlEscape(sheet.name||'工作表')}：${issues.length?'请确认 '+issues.map(key=>REQUIRED_PRODUCT_FIELDS[key]).join('、')+' 对应哪一列，其余已自动识别。':'字段已自动识别，可在这里核对。'}</p><div class="pv4-mapping-grid">${fields}</div>`,'确认并继续');dialog.showModal();dialog.querySelector('select')?.focus();
    }
    function dialogChange(event){
      event.target.form?.querySelector('[data-pv4-dialog-error]')?.replaceChildren();
      if(event.target.name==='group-material'&&event.target.form){
        const chosen=event.target.value,id=chosen===KEEP?local.dialog.group.materialState:chosen,material=materialById(id),thickness=event.target.form.elements['group-thickness'];
        thickness.innerHTML=(chosen===KEEP?`<option value="${KEEP}">保留各 SKU 原厚度</option>`:'')+thicknessOptions(id,'',{placeholder:chosen!==KEEP});thickness.disabled=!material;return;
      }
      if(event.target.name!=='edit-material'||!event.target.form)return;const thickness=event.target.form.elements['edit-thickness'],material=event.target.value,uniform=local.page?.thicknessDefaults?.[material]||'';thickness.innerHTML=thicknessOptions(material,uniform);thickness.disabled=!material;
    }
    function dialogClick(event){if(event.target.closest('[data-pv4-dialog-close]'))closeDialog();}
    function dialogInput(){}
    async function dialogSubmit(event){
      const form=event.target;if(form.matches('[data-pv4-search-form]')){event.preventDefault();await searchProducts(form.elements['product-search'].value);return;}if(form.matches('[data-pv5-uniform-form]')){event.preventDefault();await submitUniform();return;}
      if(!form.matches('[data-pv4-dialog-form]')||!local.dialog)return;event.preventDefault();if(local.busy)return;const error=form.querySelector('[data-pv4-dialog-error]');error.textContent='';
      const revision=local.dialog.type==='mapping'?local.candidate?.revision:local.session?.revision;if(local.dialog.revision!==revision){error.textContent='数据已更新，请关闭后重新打开。';return;}
      if(local.dialog.type==='replace'){const file=local.dialog.file;closeDialog();await startImport(file,true);return;}
      if(local.dialog.type==='group'){await submitGroup(form,error);return;}
      if(local.dialog.type==='row'){await submitRow(form,error);return;}
      if(local.dialog.type==='mapping'){
        const mapping={...local.dialog.baseMapping};for(const key of local.dialog.fields){const value=form.elements[`map-${key}`]?.value;if(value==null||value===''){error.textContent=`请选择${REQUIRED_PRODUCT_FIELDS[key]}对应的列。`;return;}mapping[key]=Number(value);}if(Recognition.productMappingIssues(array(candidateSheets().find(s=>text(s.sheetId||s.id)===local.dialog.sheetId)?.header?.headers),mapping).length){error.textContent='同一列不能同时对应多个必需字段。';return;}
        const snapshot=local.dialog;local.sheetMappings[snapshot.sheetId]=mapping;closeDialog();scheduleRender();if(snapshot.continueImport)await chooseSheet();
      }
    }

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
      const el=event.target;if(!el.closest?.('[data-product-v4]')||local.busy)return;
      if(el.matches('[data-pv4-file]')){const file=el.files?.[0];if(file)await startImport(file);el.value='';return;}
      if(el.matches('[data-pv4-sheet]')){const id=text(el.dataset.pv4Sheet);el.checked?local.sheetSelection.add(id):local.sheetSelection.delete(id);scheduleRender();return;}
      if(el.matches('[data-pv5-uniform]')){local.uniformChoices[el.dataset.pv5Uniform]=el.value;local.setupDirty=true;return;}
      if(el.matches('[data-pv5-unknown]')){local.unknownMaterial=el.value;local.setupDirty=true;scheduleRender();return;}
      if(el.matches('[data-pv5-assign]')){const id=el.dataset.pv5Assign;if(el.value)local.materialAssignments[id]=el.value;else delete local.materialAssignments[id];local.assignmentCounts[id]=summary().unknownGroups.find(g=>g.groupId===id)?.count||0;local.setupDirty=true;scheduleRender();}
    }
    async function documentClick(event){
      const button=event.target.closest?.('[data-product-v4] button');if(!button||local.busy&&!button.matches('[data-pv4-cancel]'))return;
      if(button.matches('[data-pv4-manual]')||button.matches('[data-pv5-pending]')){local.manual=true;local.filter=button.matches('[data-pv5-pending]')?'pending':'all';local.pageNumber=1;local.search='';resetGroup();await refreshPage();return;}
      if(button.matches('[data-pv4-auto]')){local.manual=false;local.search='';local.pageNumber=1;resetGroup();await refreshPage();return;}
      if(button.matches('[data-pv5-setup]')){local.setup=true;local.setupSession='';scheduleRender();return;}
      if(button.matches('[data-pv5-cancel-setup]')){local.setup=false;local.setupDirty=false;local.setupSession='';local.error='';scheduleRender();return;}
      if(button.matches('[data-pv6-expand]')){const id=button.dataset.pv6Expand;if(local.expandedGroupId===id){resetGroup();scheduleRender();}else{resetGroup();local.expandedGroupId=id;await refreshPage();}return;}
      if(button.matches('[data-pv6-unify]')){openGroup(button.dataset.pv6Unify);return;}
      if(button.matches('[data-pv6-sku-page]')){local.groupPage=Math.max(1,Number(button.dataset.pv6SkuPage)||1);await refreshPage();return;}
      if(button.matches('[data-pv6-undo]')){await undo();return;}
      if(button.matches('[data-pv5-edit]')){openRow(button.dataset.pv5Edit);return;}
      if(button.matches('[data-pv5-material-page]')){local.materialPage=Number(button.dataset.pv5MaterialPage);await refreshPage();return;}
      if(button.matches('[data-pv4-clear-search]')){await searchProducts('');return;}
      if(button.matches('[data-pv4-recompute]')){await recompute();return;}
      if(button.matches('[data-pv4-filter]')){local.filter=button.dataset.pv4Filter;local.pageNumber=1;resetGroup();await refreshPage();return;}
      if(button.matches('[data-pv4-page]')){local.pageNumber=Math.max(1,Number(button.dataset.pv4Page)||1);resetGroup();await refreshPage();return;}
      if(button.matches('[data-pv4-export]'))await exportFile();
      else if(button.matches('[data-pv4-use]'))await useCandidate();
      else if(button.matches('[data-pv4-map-sheet]')){const sheet=candidateSheets().find(x=>text(x.sheetId||x.id)===button.dataset.pv4MapSheet);if(sheet)openMapping(sheet);}
      else if(button.matches('[data-pv4-read-sheet]'))await chooseSheet();
      else if(button.matches('[data-pv4-discard]'))await discardCandidate();
      else if(button.matches('[data-pv4-cancel]'))await cancelJob();
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
    function syncChecks(){}
    function activate(context={}){
      local.active=true;refreshContext(context,{render:false});bind();ensureDialog();syncChecks();waitingLoader.activate(root.document?.querySelector('[data-product-v4]'));root.lucide?.createIcons?.();
      if(local.session&&!local.page&&!local.busy)refreshPage();
      return api;
    }
    function deactivate(){
      waitingLoader.stop();resetDrop();
      local.active=false;closeDialog();resetGroup();local.search='';local.filter='all';local.missingThickness=false;local.moreOpen=false;local.pageNumber=1;local.selected.clear();local.page=null;
    }
    function refreshContext(context={},settings={}){
      const previousWorkspace=text(local.context.workspaceId),previousEpoch=text(local.context.storageEpoch);local.context={...local.context,...context};
      if((previousWorkspace&&text(local.context.workspaceId)!==previousWorkspace)||(previousEpoch&&text(local.context.storageEpoch)!==previousEpoch)){
        commands.reset();clearPoll();local.contextSerial++;local.requestSerial++;resetGroup();closeDialog(true);local.setup=false;local.setupSession='';local.setupDirty=false;local.search='';local.session=null;local.candidate=null;local.candidateStatus=null;local.page=null;local.selected.clear();local.busy=false;local.jobId='';local.jobKind='';local.undo=null;local.error='工作区已切换，请重新选择商品规格文件。';
      }
      loadPreferences();if(settings.render!==false)scheduleRender();return api;
    }
    async function restoreSession(session){
      if(!session?.sessionId||!session?.ownerToken)throw Error('文件会话信息不完整');
      commands.reset();clearPoll();local.contextSerial++;local.requestSerial++;local.setup=false;local.setupSession='';local.setupDirty=false;local.manual=false;local.search='';resetGroup();local.offerAttention=false;local.busy=false;local.jobId='';local.session={...session};local.candidate=null;local.candidateStatus=null;local.page=null;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;local.error='';
      await refreshPage();if(local.page?.rulesStale)await recompute();return api;
    }
    function isBusy(){return local.busy||!!local.jobId;}
    function canQuit(){return !commands.uncertain()&&!isBusy()&&!local.dialog&&!local.candidate&&!local.setupDirty;}
    function destroy(){
      waitingLoader.stop();resetDrop();
      commands.reset();clearPoll();local.contextSerial++;local.requestSerial++;local.session=null;local.candidate=null;local.destroyed=true;local.active=false;
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
