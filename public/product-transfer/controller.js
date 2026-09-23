(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductTransferController=api;})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const Model=typeof module==='object'&&module.exports?require('./model.js'):root.ProductTransferModel;
  const {Recognition,PAGE_SIZE,CUSTOM,KEEP,TERMINAL_PHASES,WAITING_SHEET_PHASES,FAILED_PHASES,text,array,active,mutationId,safeMessage,materialId,countValue,canonicalRules}=Model;
  const Commands=typeof module==='object'&&module.exports?require('./commands.js'):root.ProductTransferCommands;
  function create(options={}){
    const getState=options.getState||(()=>({})),rerender=options.render||(()=>{}),notify=options.toast||(()=>{}),ports=options.ports||{};
    const local={
      setup:false,setupDirty:false,setupSession:'',uniformChoices:{},materialAssignments:{},assignmentCounts:{},unknownMaterial:'',materialPage:1,manual:false,offerAttention:false,contextSerial:0,context:{},session:null,candidate:null,candidateStatus:null,page:null,pageNumber:1,
      expandedGroupId:'',groupPage:1,groupRows:null,search:'',preferencesKey:'',thicknessDefaults:{},filter:'all',missingThickness:false,moreOpen:false,selected:new Set(),
      reading:false,busy:false,waitStartedAt:0,waitLabel:'',waitStatus:null,jobId:'',jobKind:'',error:'',requestSerial:0,pollTimer:0,dialog:null,lastFocus:null,
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
      if(!isBusy())local.waitStartedAt=(ports.now||Date.now)();
      local.waitLabel=label;local.waitStatus=null;local.busy=true;
    }
    function scheduleRender(){
      if(local.destroyed)return;
      local.pendingOutcome=commands.uncertain();loadPreferences();if(thicknessSetup())initializeSetup();
      rerender();
      root.queueMicrotask?.(()=>{if(local.active&&!local.destroyed)ports.activate?.();});
    }
    function clearPoll(){if(local.pollTimer){root.clearTimeout(local.pollTimer);local.pollTimer=0;}}
    function queuePoll(task,delay=700){clearPoll();local.pollTimer=root.setTimeout(task,delay);}
    function setError(error,fallback){if(local.destroyed)return;local.error=safeMessage(error,fallback);scheduleRender();}
    function updateSessionRevision(result){
      if(local.session&&Number.isFinite(Number(result?.revision)))local.session.revision=Number(result.revision);
    }
    function reconcileSelection(rows){
      const visible=new Set(array(rows).map(row=>text(row.rowId)));
      local.selected=new Set([...local.selected].filter(id=>visible.has(id)));
    }
    async function refreshPage({silent=false}={}){
      if(local.destroyed||!local.session||local.busy&&!silent)return;
      const serial=++local.requestSerial,session=local.session;
      const current=()=>!local.destroyed&&serial===local.requestSerial&&local.session===session;
      if(!silent){local.reading=true;beginWaiting('正在读取复核列表');local.error='';scheduleRender();}
      try{
        const page=await call('rows',{sessionId:session.sessionId,query:{view:local.manual?'products':'rows',materialPage:local.materialPage,search:local.search,attention:!local.manual,status:local.filter,missingThickness:local.missingThickness,page:local.pageNumber,pageSize:PAGE_SIZE}});
        if(!current())return;
        const totalPages=Math.max(1,Number(page?.totalPages)||Math.ceil((Number(page?.total)||0)/PAGE_SIZE)||1);
        if(local.pageNumber>totalPages){local.pageNumber=totalPages;return refreshPage({silent:true});}
        let expanded=local.expandedGroupId,detail=null;
        if(local.manual){
          if(expanded&&!array(page.groups).some(g=>g.groupId===expanded))expanded='';
          if(!expanded&&local.search&&array(page.groups).length===1)expanded=page.groups[0].groupId;
          if(expanded){
            detail=await call('rows',{sessionId:session.sessionId,query:{groupId:expanded,search:local.search,status:local.filter,page:local.groupPage,pageSize:PAGE_SIZE}});
            if(!current())return;
            if(detail.revision!==page.revision)throw Error('商品数据已更新，请重新展开。');
          }
        }
        // Publish one coherent revision; failed detail reads retain the prior view.
        local.pageStale=false;local.error='';local.pageNumber=Number(page.page)||local.pageNumber;
        local.page={...page,page:local.pageNumber,pageSize:PAGE_SIZE,totalPages};
        session.revision=Number(page.revision??session.revision);
        local.expandedGroupId=expanded;local.groupRows=detail;local.groupPage=detail?.page||1;
        reconcileSelection(page.rows);
      }catch(error){if(current()){local.pageStale=true;local.error=safeMessage(error,'复核列表读取失败。');}}
      finally{if(current()){local.reading=false;local.busy=false;scheduleRender();}}
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
      if(!file||local.busy||local.destroyed)return;
      if(commands.uncertain()){notify('请先核对上次修改结果，再替换文件。');return;}
      if(!/\.xlsx$/i.test(file.name)){notify('请选择 .xlsx 文件');return;}
      if(!replaceConfirmed&&local.session&&countValue(local.page,'pending')>0){ports.replace?.(file);return;}
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
      if(unresolved){ports.openMapping?.(unresolved,true);return;}
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
      if(!local.jobId)return;const jobId=local.jobId,contextSerial=local.contextSerial;
      const current=()=>!local.destroyed&&local.contextSerial===contextSerial&&local.jobId===jobId;
      try{await call('cancel',{jobId});if(!current())return;local.waitLabel='正在取消处理';scheduleRender();notify('已请求取消处理');if(local.jobKind==='import')queuePoll(pollCandidate,250);else if(local.jobKind==='export')queuePoll(pollExport,250);}
      catch(error){if(current())setError(error,'取消失败。');}
    }
    async function applyReview({type,rowIds,groupId,patch,overwrite=false}){
      if(!local.session||local.busy)return null;
      if(local.pageStale){setError('列表尚未刷新，请关闭编辑窗口后刷新列表，再核对修改。');return null;}
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
        await refreshPage({silent:true});if(local.session!==session||local.destroyed)return null;
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
      if(!local.session||local.busy||local.pageStale||!local.page?.ready)return;
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
      ports.download?.(url);
      local.busy=false;local.jobId='';local.jobKind='';scheduleRender();notify('商品表已生成');
    }
    function materials(){return active(getState()?.materials);}
    function materialById(id){return array(getState()?.materials).find(item=>text(item.id)===text(id));}
    function thicknessSetup(){return !!local.session&&(local.setup||local.page?.thicknessConfigured===false);}
    function summary(){return local.page?.materialSummary||{materials:[],unknown:0,unknownGroups:[],groupCount:0,page:1,totalPages:1};}
    function loadPreferences(){
      const current=target(),key=`mat-product-thickness:${current.workspaceId}:${current.storageEpoch||''}`;
      if(local.preferencesKey===key)return;local.preferencesKey=key;local.thicknessDefaults={};
      try{const value=JSON.parse(ports.readPreference?.(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))local.thicknessDefaults=value;}catch{}
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
    async function submitUniform(){
      if(local.busy)return;if(local.pageStale){setError('请先刷新列表，再确认材质和厚度。');return;}initializeSetup();const s=summary(),entries=setupMaterials();
      if(s.unknown&&!local.unknownMaterial){local.error='请先确认未识别商品的材质。';scheduleRender();return;}
      if(local.unknownMaterial===CUSTOM&&Object.keys(local.materialAssignments).length<s.groupCount){local.error='请为未识别商品指定材质；复杂情况可选择稍后处理。';scheduleRender();return;}
      const defaults={};for(const {material} of entries){const id=local.uniformChoices[material.id];if(!id){local.error=`请选择${material.name}的统一厚度。`;scheduleRender();return;}if(id!=='__later__')defaults[material.id]=id;}
      try{Recognition.normalizeThicknessDefaults(defaults,stateRules());}catch(error){local.error=safeMessage(error);scheduleRender();return;}
      const assignments=local.unknownMaterial===CUSTOM?Object.fromEntries(Object.entries(local.materialAssignments).filter(([,id])=>id!==KEEP)):{},fallbackMaterialId=local.unknownMaterial&&![CUSTOM,KEEP].includes(local.unknownMaterial)?local.unknownMaterial:'';
      if(await recompute({thicknessDefaults:defaults,applyUniformThickness:true,materialAssignments:assignments,fallbackMaterialId})){
        local.setup=false;local.setupDirty=false;local.manual=false;local.thicknessDefaults={...local.thicknessDefaults,...defaults};try{ports.writePreference?.(local.preferencesKey,JSON.stringify(local.thicknessDefaults));}catch{}scheduleRender();
      }
    }
    async function searchProducts(value){if(local.busy||!local.session)return;local.search=text(value).trim().slice(0,200);local.manual=true;local.filter='all';local.pageNumber=1;resetGroup();await refreshPage();}
    async function recompute(extra={}){
      if(local.busy||!local.session)return false;beginWaiting(extra.applyUniformThickness?'正在统一材质和厚度':'正在重新计算');local.error='';scheduleRender();const session=local.session;
      try{const finished=await commands.run('recompute',session,{...extra,action:{type:'recompute'}});if(local.session!==session)return false;updateSessionRevision(finished);local.undo=null;await refreshPage({silent:true});return local.session===session&&!local.destroyed;}
      catch(error){if(local.session===session)local.error=safeMessage(error,'计算未完成，选择已保留，可重试。');return false;}
      finally{if(local.session===session){local.busy=false;local.jobId='';local.jobKind='';scheduleRender();}}
    }
    function refreshContext(context={},settings={}){
      const previousWorkspace=text(local.context.workspaceId),previousEpoch=text(local.context.storageEpoch);local.context={...local.context,...context};
      if((previousWorkspace&&text(local.context.workspaceId)!==previousWorkspace)||(previousEpoch&&text(local.context.storageEpoch)!==previousEpoch)){
        commands.reset();clearPoll();local.contextSerial++;local.requestSerial++;resetGroup();ports.closeDialog?.(true);local.setup=false;local.setupSession='';local.setupDirty=false;local.search='';local.session=null;local.candidate=null;local.candidateStatus=null;local.page=null;local.selected.clear();local.busy=false;local.jobId='';local.jobKind='';local.undo=null;local.error='工作区已切换，请重新选择商品规格文件。';
      }
      loadPreferences();if(settings.render!==false)scheduleRender();return api;
    }
    async function restoreSession(session){
      if(!session?.sessionId||!session?.ownerToken)throw Error('文件会话信息不完整');
      commands.reset();clearPoll();local.contextSerial++;local.requestSerial++;local.setup=false;local.setupSession='';local.setupDirty=false;local.manual=false;local.search='';resetGroup();local.offerAttention=false;local.busy=false;local.jobId='';local.session={...session};local.candidate=null;local.candidateStatus=null;local.page=null;local.pageNumber=1;local.filter='all';local.missingThickness=false;local.moreOpen=false;local.selected.clear();local.undo=null;local.error='';
      await refreshPage();if(local.page?.rulesStale)await recompute();return api;
    }
    async function checkPending(){
      if(local.busy||!local.session)return;const session=local.session;beginWaiting('正在核对上次修改');scheduleRender();
      try{const outcome=await commands.reconcile();if(local.session!==session||local.destroyed)return;if(outcome?.committed){updateSessionRevision(outcome.result);await refreshPage({silent:true});local.error='已核对：上次操作已经保存。';}else local.error='已核对：没有已提交修改，原输入可继续重试。';}
      catch(error){if(local.session===session&&!local.destroyed)local.error=safeMessage(error);}
      finally{if(local.session===session&&!local.destroyed){local.busy=false;scheduleRender();}}
    }
    function isBusy(){return local.busy||!!local.jobId;}
    function canQuit(){return !commands.uncertain()&&!isBusy()&&!local.dialog&&!local.candidate&&!local.setupDirty;}
    function inspect(){return {manual:local.manual,session:local.session&&{...local.session},candidate:local.candidate&&{...local.candidate},filter:local.filter,missingThickness:local.missingThickness,pageNumber:local.pageNumber,selected:[...local.selected],busy:isBusy()};}

    function activate(context={}){if(local.destroyed)return api;local.active=true;refreshContext(context,{render:false});if(thicknessSetup())initializeSetup();ports.activate?.();if(local.session&&!local.page&&!local.busy)refreshPage();return api;}
    function deactivate(){ports.deactivate?.();if(local.reading){local.reading=false;local.busy=false;}local.active=false;local.requestSerial++;resetGroup();local.search='';local.filter='all';local.missingThickness=false;local.moreOpen=false;local.pageNumber=1;local.selected.clear();local.page=null;}
    function destroy(){commands.reset();clearPoll();local.contextSerial++;local.requestSerial++;local.session=null;local.candidate=null;local.destroyed=true;local.active=false;}
    const api={state:local,checkPending,target,scheduleRender,refreshPage,resetGroup,candidateReady,needsSheet,startImport,candidateSheets,sheetMapping,sheetIssues,chooseSheet,useCandidate,discardCandidate,cancelJob,applyReview,undo,exportFile,download,materials,materialById,thicknessSetup,summary,setupMaterials,submitUniform,searchProducts,recompute,refreshContext,restoreSession,isBusy,canQuit,inspect,activate,deactivate,destroy};
    return api;
  }
  return {create};
});
