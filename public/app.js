/* Desktop workbench. Confirmed records and database persistence are independent of the forecast. */
(() => {
  'use strict';
  const M=window.MatModel,W=window.MatWorkbook,T=window.MatTransfer,H=window.MatTrends,P=window.MatProductTransfer,R=window.ReusableRules,A=window.PromotionRules,S=window.SalesImport;
  const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
  const APP_VERSION=window.WorkbenchConfig?.version||'未知',updates=window.matUpdates;
  const updatesSupported=!!updates&&window.WorkbenchConfig?.updatesSupported===true;
  let operationPending=false,skuOptionsOpen=false,showDeletedRules=false,inlineDrafts={};
  let state=M.initialState(),view='plan',tab='sku',libraryTab='materials',query='',shape='all',showInactiveMaterials=false,modal=null,lastFocus=null,saveError='',toastTimer,busy=false;
  let formDrafts=null,recoveryContext=null,productUI=null,salesUI=null,commitSerial=0;
  let pendingFileSessions=[],fileSessionDrafts=new Map();
  let queue,saveStatus='loading',booted=false,pendingRecovery=null,backupItems=[],dataPath='';
  let updateStatus={state:'idle',version:null,percent:null,message:''};
  const DRAFT_PREFIX='mat-roi-workbench-draft-';
  let clientId;
  try{clientId=sessionStorage.getItem('mat-roi-client')||crypto.randomUUID();sessionStorage.setItem('mat-roi-client',clientId);}catch{clientId=crypto.randomUUID();}
  let draftKey=DRAFT_PREFIX+clientId,workspaceId='',storageEpoch=0;
  let filters={shopId:'',planId:'',from:'',to:'',includeOld:false};
  let productFiles={template:null,source:null},productResult=null,productBusy=false,productError='',productReviews={},productGroupPage=0,productRowPage=0;
  let chartFilters={from:H.shift(M.today(),-29),to:M.today(),unit:'day'},ledgerUnit='day',trendPoints=[];
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const money=v=>Number.isFinite(v)?'¥'+n(v):'—';
  const short=v=>!Number.isFinite(v)?'—':Math.abs(v)>=1e8?n(v/1e8)+' 亿':Math.abs(v)>=1e4?n(v/1e4)+' 万':n(v);
  const roi=v=>v===null?'无法保本':n(M.ceilRoi(v));
  const icon=name=>`<i data-lucide="${name}" class="icon" aria-hidden="true"></i>`;
  const btn=(a,label,ico='',cls='',extra='')=>`<button type="button" class="btn ${cls}" data-action="${a}" ${extra}>${ico?icon(ico):''}${e(label)}</button>`;
  const ib=(a,label,ico,extra='')=>`<button type="button" class="icon-btn" data-action="${a}" aria-label="${e(label)}" title="${e(label)}" ${extra}>${icon(ico)}</button>`;
  const current=()=>state.plans.find(p=>p.id===state.active&&!p.deleted&&p.shopId===state.activeShop);
  const activePlans=()=>state.plans.filter(p=>!p.deleted&&p.shopId===state.activeShop);
  const shopName=id=>state.shops.find(s=>s.id===id)?.name||'店铺';
  const sizeName=s=>s?M.sizeLabel(s):'待选规格';
  const dimensions=s=>s?`${s.salesW||'—'} × ${s.salesH||'—'} cm`:'';
  const production=s=>s?.needsReview?'待补生产尺寸':s?.irregular?`${s.productionW} × ${s.productionH} cm`:dimensions(s);
  const field=(label,key,value,type='number',attrs='')=>`<label class="field"><span class="field-label">${e(label)}</span><input type="${type}" data-field="${key}" aria-label="${e(label)}" value="${e(value)}" ${type==='number'?'step="any"':''} ${attrs}></label>`;
  const gramField=(label,key,value)=>field(label,key,M.toGrams(value),'number','data-unit="g" min="0"');
  const weightText=v=>Number.isFinite(v)?M.toGrams(v).toLocaleString('zh-CN',{maximumFractionDigits:6}):'—';
  const option=(id,name,selected)=>`<option value="${e(id)}" ${id===selected?'selected':''}>${e(name)}</option>`;
  const materialRuleUsable=r=>r&&!r.variant&&r.coefficient!==''&&r.costPerSqm!==''&&Number.isFinite(Number(r.coefficient))&&Number(r.coefficient)>=0&&Number.isFinite(Number(r.costPerSqm))&&Number(r.costPerSqm)>=0;
  const materialOptions=id=>state.materials.filter(m=>((m.active&&!m.deleted&&(m.weightRules||[]).some(materialRuleUsable))||m.id===id)).map(m=>option(m.id,`${m.name}${m.deleted?'（已删除）':m.active?'':'（停用）'}`,id)).join('');
  const materialDisplayCost=m=>{const r=(m?.weightRules||[]).find(x=>x.default&&materialRuleUsable(x))||(m?.weightRules||[]).find(materialRuleUsable);return r?money(Number(r.costPerSqm)):'—';};
  const shippingOptions=id=>state.shippingTemplates.filter(t=>t.active&&!t.deleted||t.id===id).map(t=>option(t.id,t.name+(t.deleted?'（已删除）':t.active?'':'（停用）'),id)).join('');
  const shippingTypeLabels={regional:'区域重量分档（内置）',fixed:'固定运费',tiers:'重量分档',step:'首重续重'};
  const shippingTypeOptions=type=>type==='regional'?[['regional',shippingTypeLabels.regional]]:[['fixed',shippingTypeLabels.fixed],['tiers',shippingTypeLabels.tiers],['step',shippingTypeLabels.step]];
  function ruleText(t){if(!t)return '待选模板';if(t.type==='regional')return '中通区域运费 · 0–5kg 分档，5kg以上按整公斤续重 · 不含面单费';if(t.type==='fixed')return `每单 ${money(t.fee)}`;if(t.type==='tiers')return t.tiers.map((r,i)=>`${weightText(i?t.tiers[i-1].upTo:0)}–${weightText(r.upTo)} g：${money(r.fee)}`).join('；');return `首 ${weightText(t.firstWeight)} g ${money(t.firstFee)}，每续 ${weightText(t.stepWeight)} g 加 ${money(t.stepFee)}；不足一档按一档，最高 ${weightText(t.maxWeight)} g`;}
  function normalize(){
    if(!state.shops.some(s=>s.id===state.activeShop&&!s.deleted))state.activeShop=state.shops.find(s=>!s.deleted)?.id||'';
    if(!current())state.active=activePlans()[0]?.id||'';
  }
  function refundSummaryText(params){const r=M.refundMetrics(params);if(!Number.isFinite(r.refundTotal))return '三类退款率合计：待填写';const first=Number.isFinite(r.firstHour)?` · 1 小时内 ${n(r.firstHour,2)}%`:'';return `三类退款率合计 ${n(r.refundTotal,2)}% · 已发货退款 ${n(r.shippedRefund,2)}%${first}`;}
  function safeError(error,message='操作未完成，请核对输入后重试；持续失败时请导出备份并联系维护人员。'){
    console.error('[workbench]',error);return message;
  }
  function toast(message){clearTimeout(toastTimer);const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');toastTimer=setTimeout(()=>t.classList.remove('show'),5000);}
  function save(reason='save'){queue?.enqueue(state,reason);}
  function saveStatusText(){return {loading:'正在读取数据',pending:'有修改待保存',saving:'正在保存…',saved:'已保存到电脑',error:'保存失败',conflict:'其他窗口已更新'}[saveStatus];}
  function updateInstallBlocked(){return !booted||!!modal||Object.keys(inlineDrafts).length>0||operationPending||busy||productBusy||productUI?.canQuit?.()===false||salesUI?.canQuit?.()===false||formDrafts?.status().pending>0||!!formDrafts?.status().error||!!queue?.pending||!!queue?.sending||!!queue?.failedSent||!!saveError||saveStatus!=='saved';}
  function updateStatusText(){if(!updatesSupported)return '仅 Windows x64 支持自动更新';const s=updateStatus;return s.state==='checking'?'正在检查更新…':s.state==='available'?`发现新版本 v${e(s.version||'')}`:s.state==='downloading'?`正在后台下载 ${e(s.percent??0)}%`:s.state==='downloaded'?'已下载，重启安装':s.state==='uptodate'?'当前已是最新版':s.state==='error'?'更新失败，继续使用当前版本':'检查更新';}
  function updateAction(){
    if(!updatesSupported)return btn('check-updates','检查更新','refresh-cw','ghost','disabled');
    if(updateStatus.state==='available')return btn('download-update','下载更新','download','primary');
    if(updateStatus.state==='downloaded')return btn('quit-and-install','重启安装','power','primary',updateInstallBlocked()?'disabled':'');
    return btn('check-updates','检查更新','refresh-cw','ghost',updateStatus.state==='checking'||updateStatus.state==='downloading'?'disabled':'');
  }
  function paintUpdateStatus(){const el=document.querySelector('#update-controls');if(el){el.innerHTML=`<span id="update-status" class="update-status" role="status" aria-live="polite" title="${e(updateStatus.message||updateStatusText())}">${updateStatusText()}</span>${updateAction()}`;window.lucide?.createIcons();}}
  function handleUpdateStatus(status){if(!status||typeof status!=='object')return;updateStatus={state:String(status.state||'error'),version:status.version||null,percent:status.percent??null,message:status.state==='error'?safeError(status.message,'更新失败，请检查网络后重试；可继续使用当前版本。'):String(status.message||'')};paintUpdateStatus();if(updateStatus.state==='error'&&updateStatus.message)toast('更新失败，继续使用当前版本');}
  async function checkUpdates(){if(!updatesSupported||!updates?.checkForUpdates)return toast('自动更新仅桌面版可用');try{await updates.checkForUpdates();}catch(error){handleUpdateStatus({state:'error',message:safeError(error)});}}
  async function downloadUpdate(){if(!updatesSupported||!updates?.downloadUpdate)return toast('自动更新仅桌面版可用');try{await updates.downloadUpdate();}catch(error){handleUpdateStatus({state:'error',message:safeError(error)});}}
  async function quitAndInstall(){if(updateInstallBlocked())return toast('请先完成保存后再重启安装');if(!updates?.quitAndInstall)return toast('自动更新仅桌面版可用');try{await updates.quitAndInstall();}catch(error){toast(safeError(error,'重启安装失败，请先保存并重新下载更新后重试。'));}}
  function paintSaveStatus(){const el=document.querySelector('#save-status');if(el){el.textContent=saveStatusText();el.dataset.status=saveStatus;}const banner=document.querySelector('#save-banner');if(banner)banner.innerHTML=saveError?`<div class="message-error" role="alert">${e(saveError)}${queue?.cacheFailed?' 草稿缓存空间不足，请保持窗口打开并导出 Excel。':' 尚未写入数据库的修改会保留为草稿。'}${btn('export','导出 Excel')}${queue?.blocked?'':btn('retry-save','重试保存')}${btn('reload','重新载入')}</div>`:'';const draftBanner=document.querySelector('#inline-draft-banner');if(draftBanner)draftBanner.innerHTML=Object.keys(inlineDrafts).length?`<div class="message-error" role="status">有输入尚未通过检查，已保留填写内容。${btn('discard-inline-drafts','放弃无效输入','','ghost')}</div>`:'';paintUpdateStatus();}
  function commit(next=state,reason='save'){if(!M.validateBackup(next))throw Error('数据未通过检查，请核对输入');state=next;pruneInlineDrafts();commitSerial++;normalize();save(reason);render();}
  function requestSignal(){try{return typeof AbortSignal==='function'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(15000):undefined;}catch(error){return undefined;}}
  async function request(path,options={}){
    const response=await fetch(path,{...options,signal:requestSignal(),headers:{'Content-Type':'application/json','X-Workbench':'1',...options.headers}});
    const data=await response.json();if(!response.ok){const error=Error(typeof data.error==='string'?data.error:data.error?.message||'保存服务暂时不可用');error.status=response.status;error.code=data.code||data.error?.code;throw error;}return data;
  }
  async function initialize(){
    booted=false;app.innerHTML='<main class="startup-error"><h1>地垫工作台</h1><p role="status">正在读取本机数据…</p></main>';
    try{
      const saved=await request('/api/state');const revision=saved.revision;
      state=saved.state;workspaceId=saved.workspaceId;storageEpoch=saved.storageEpoch;recoveryContext=null;
      if(state?.version!==4||!M.validateBackup(state))throw Error('数据未通过检查，原数据库已保留。');
      draftKey=DRAFT_PREFIX+workspaceId+'-'+storageEpoch+'-'+clientId;
      normalize();queue?.dispose();await formDrafts?.close();
      if(window.WorkbenchDrafts)formDrafts=new window.WorkbenchDrafts.SessionDrafts({workspaceId,storageEpoch,sessionId:clientId,baseRevision:revision});
      await Promise.allSettled([...fileSessionDrafts.values()].map(d=>d.close()));pendingFileSessions=[];fileSessionDrafts=new Map();
      try{pendingFileSessions=(await formDrafts?.listSessions?.({includeOldEpoch:false})||[]).filter(x=>x.workspaceId===workspaceId&&x.storageEpoch===storageEpoch&&x.fileKind);}catch{pendingFileSessions=[];}
      queue=new window.WorkbenchPersistence.SaveQueue({revision,workspaceId,storageEpoch,read:()=>request('/api/state'),
        send:(data,rev)=>request('/api/state',{method:'PUT',body:JSON.stringify({state:data,revision:rev,workspaceId,storageEpoch})}),
        cache:{write:data=>localStorage.setItem(draftKey,JSON.stringify(data)),clear:()=>localStorage.removeItem(draftKey)},
        status:(status,error)=>{saveStatus=status;saveError=error?error.message:'';paintSaveStatus();}
      });
      saveStatus='saved';saveError='';booted=true;setupFileUI();try{inlineDrafts=(await formDrafts?.read('inline'))?.value||{};}catch{inlineDrafts={};}render();
      const drafts=[];
      try{for(const key of Object.keys(localStorage).filter(k=>k.startsWith(DRAFT_PREFIX))){try{const draft=JSON.parse(localStorage.getItem(key));if(!draft?.state||draft.workspaceId!==workspaceId||draft.storageEpoch!==storageEpoch)continue;draft.state=M.migrate(draft.state);if(JSON.stringify(draft.state)===JSON.stringify(state)){localStorage.removeItem(key);continue;}drafts.push({key,...draft});}catch{}}}catch{}
      pendingRecovery=drafts.sort((a,b)=>b.updated-a.updated)[0]||null;
      if(pendingRecovery)open('recover-draft');else if(formDrafts){try{const draft=await formDrafts.read('modal',{baseRevision:queue.revision,entityId:current()?.id||''});if(draft)open('recover-form',{stored:draft});}catch(error){toast(error.message);}}
    }catch(error){saveStatus='error';saveError=error.message;try{recoveryContext=await request('/api/recovery/status');workspaceId=recoveryContext.workspaceId;storageEpoch=recoveryContext.storageEpoch;}catch{}app.innerHTML=`<main class="startup-error"><h1>数据暂时无法打开</h1><p role="alert">${e(saveError)}</p><p>原始数据已保留，可下载原件或从备份恢复。</p>${btn('boot-retry','重新读取','refresh-cw','primary')}${btn('recovery-points','查看恢复点','history')}${recoveryContext?.canRestore?btn('download-raw','下载原始数据','download')+btn('import','从备份恢复','upload'):''}</main>`;}
  }

  function fileContext(){return {workspaceId,storageEpoch,ownerId:clientId,clientId,revision:queue?.revision,shopId:state.activeShop,planId:current()?.id,itemsFingerprint:current()?S.fingerprint(current()):''};}
  function fileDraftFor(meta){
    if(!window.WorkbenchDrafts||!meta?.sessionId||!workspaceId)return null;
    let draft=fileSessionDrafts.get(meta.sessionId);
    if(!draft){try{draft=new window.WorkbenchDrafts.SessionDrafts({workspaceId,storageEpoch,sessionId:String(meta.sessionId),ownerToken:meta.ownerToken,baseRevision:Number(meta.revision)||0});fileSessionDrafts.set(meta.sessionId,draft);}catch(error){console.error('[workbench] file session draft',error);return null;}}
    return draft;
  }
  async function rememberFileSession(meta={}){
    if(!meta?.sessionId)return meta;
    const draft=fileDraftFor(meta);if(!draft)return meta;
    try{await draft.saveSession({sessionId:String(meta.sessionId),ownerToken:String(meta.ownerToken||draft.ownerToken),revision:Number(meta.revision)||0,workspaceId,storageEpoch,filename:String(meta.filename||''),fileKind:String(meta.fileKind||meta.kind||'')});}
    catch(error){console.error('[workbench] file session draft save',error);toast('文件复核会话未能写入恢复草稿，请保持窗口打开。');}
    return meta;
  }
  async function touchFileSession(sessionId,result={},extra={}){
    const draft=fileSessionDrafts.get(sessionId);if(!draft)return result;
    try{await draft.touchSession({revision:Number(result?.revision??draft.baseRevision)||0,filename:extra.filename||draft.sessionMeta?.filename||''});}
    catch(error){console.error('[workbench] file session draft touch',error);}
    return result;
  }
  async function discardFileSession(sessionId){
    const draft=fileSessionDrafts.get(sessionId);fileSessionDrafts.delete(sessionId);pendingFileSessions=pendingFileSessions.filter(x=>x.sessionId!==sessionId);
    if(draft){try{await draft.discardSession({sessionId});}catch(error){console.error('[workbench] file session draft discard',error);}}
  }
  function trackedFileJobs(){
    const F=window.FileJobs||{};
    const jobs={...F};
    jobs.create=async(kind,target,rules)=>{const result=await F.create(kind,target,rules);await rememberFileSession({...result,fileKind:kind});return result;};
    jobs.upload=async(id,file,options={})=>{const result=await F.upload(id,file,options);await touchFileSession(id,result,{filename:file?.name||''});return result;};
    for(const name of ['status','selectSheet','rows','salesCandidate','salesReview','salesReviews','review','undo','startExport'])if(typeof F[name]==='function')jobs[name]=async(...args)=>{const result=await F[name](...args);const id=typeof args[0]==='string'?args[0]:args[0]?.sessionId;await touchFileSession(id,result);return result;};
    jobs.discard=async(id,options={})=>{const result=await F.discard(id,options);await discardFileSession(id);return result;};
    return jobs;
  }
  function setupFileUI(){
    if(!productUI&&window.ProductTransferUI&&window.FileJobs){const jobs=trackedFileJobs();productUI=window.ProductTransferUI.create({getState:()=>state,render:()=>{if(view==='product')render();},toast,request:(action,p={})=>{switch(action){case 'create':return jobs.create(p.kind,p.target,p.rules);case 'upload':return jobs.upload(p.sessionId,p.file,{ownerToken:p.ownerToken});case 'status':return jobs.status(p.sessionId);case 'selectSheet':return jobs.selectSheet(p.sessionId,p.options);case 'rows':return jobs.rows(p.sessionId,p.query);case 'review':return jobs.review(p.sessionId,p.command);case 'undo':return jobs.undo(p.sessionId,p.command);case 'startExport':return jobs.startExport(p.sessionId,p.options);case 'downloadUrl':return window.FileJobs.downloadUrl(p.sessionId,p.artifactId);case 'cancel':return jobs.cancel(p.jobId);case 'discard':return jobs.discard(p.sessionId,{ownerToken:p.ownerToken});default:throw Error('文件操作不存在');}}});}
    if(!salesUI&&window.SalesImportUI&&window.FileJobs){const jobs=trackedFileJobs();salesUI=window.SalesImportUI.create({getState:()=>state,getContext:fileContext,toast,fileJobs:jobs,flush:()=>queue.flush(),commit:commitSales,undo:async token=>{const next=S.undo(state,token);commit(next);if(!await queue.flush())throw Error('撤销尚未保存，请保留页面并重试保存');return true;}});}
  }
  function setView(next){if(view==='product'&&next!=='product')productUI?.deactivate?.();view=next;}
  async function restorePendingProductSession(){
    if(!productUI||productUI.inspect?.().session)return;
    const saved=pendingFileSessions.filter(x=>x.fileKind==='product').sort((a,b)=>Number(b.updated||0)-Number(a.updated||0))[0];
    if(!saved)return;
    try{
      const draft=fileDraftFor(saved),restored=await draft?.restoreSession(saved.sessionId,{workspaceId,storageEpoch,ownerToken:saved.ownerToken});
      if(!restored)return;
      await productUI.restoreSession(restored);toast('已恢复上次商品转表复核会话');
    }catch(error){
      if(error?.code==='WORKSPACE_EPOCH_CHANGED')pendingFileSessions=pendingFileSessions.filter(x=>x.sessionId!==saved.sessionId);
      else toast('上次商品转表会话未能恢复，请重新选择文件');
    }
  }
  async function commitSales(payload,context={}){
    if(!S?.prepare||!S?.apply)throw Error('销售保存规则未加载，请重新打开工作台');
    const targetPlanId=payload?.planId||context.planId||current()?.id||'';
    const plan=state.plans.find(p=>p.id===targetPlanId&&!p.deleted);
    if(!plan)throw Error('目标计划不存在或已删除，请重新选择计划');
    const expectedWorkspace=context.workspaceId||workspaceId;
    const expectedEpoch=context.storageEpoch??storageEpoch;
    if(payload?.workspaceId!==undefined&&payload.workspaceId!==expectedWorkspace)throw Error('销售候选所属工作区已变化，请重新复核');
    if(payload?.storageEpoch!==undefined&&payload.storageEpoch!==expectedEpoch)throw Error('销售候选所属数据版本已变化，请重新复核');
    if(context.expectedRevision!==undefined&&context.expectedRevision!==queue?.revision)throw Error('当前计划已发生变化，请重新复核销售候选');
    const fingerprint=S.fingerprint(plan);
    if(!payload?.skuFingerprint||payload.skuFingerprint!==fingerprint)throw Error('当前商品规格已发生变化，请重新复核销售候选');
    const draft=S.prepare(state,targetPlanId,payload.items||[],{
      ...payload,planId:targetPlanId,shopId:plan.shopId,skuFingerprint:fingerprint
    });
    draft.workspaceId=expectedWorkspace;
    draft.storageEpoch=expectedEpoch;
    draft.itemsFingerprint=fingerprint;
    const applied=S.apply(state,draft,{planId:targetPlanId,workspaceId:expectedWorkspace,storageEpoch:expectedEpoch});
    if(applied.duplicate)return {duplicate:true,undoToken:null};
    commit(applied.state,'save');
    return {undoToken:applied.undo||null,importId:draft.importId};
  }
  async function auxiliary(type,payload){if(!window.FileJobs)throw Error('文件服务未加载');const job=await window.FileJobs.startAuxiliary(type,payload);const result=await window.FileJobs.waitForJob(job.jobId);return {...result,jobId:job.jobId};}
  async function exportListing(){if(busy)return;busy=true;try{const result=await auxiliary('export-listing',{state,planId:current().id});downloadLink(window.FileJobs.auxiliaryDownloadUrl(result.jobId),'上架价格-'+M.today()+'.xlsx');toast('上架价格表已生成');}catch(error){fail(error.message);}finally{busy=false;}}
  function downloadLink(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
  async function restoreWorkspace(next){const target=modal;if(!target||operationPending)return;operationPending=true;target.pending=true;target.operationId??=crypto.randomUUID();target.expectedRevision??=queue?.revision??recoveryContext?.revision;try{if(queue&&!await queue.pause())return fail('请先解决当前保存问题再恢复');if(target.expectedRevision!==queue?.revision&&queue)target.expectedRevision=queue.revision;await request('/api/restore',{method:'POST',body:JSON.stringify({state:next,expectedRevision:target.expectedRevision,operationId:target.operationId})});target.committed=true;close(true);productUI?.destroy?.();productUI=null;salesUI?.reset?.();salesUI=null;await initialize();toast('工作区已恢复并保存');}catch(error){fail(error.message);}finally{operationPending=false;if(target)target.pending=false;queue?.resume();}}
  function transferRules(){
    const materials={};let weightRules=[];
    for(const m of state.materials.filter(m=>m.active)){const rules=m.weightRules||[],selected=rules.find(r=>r.default)||rules[0];materials[m.name]={weightPerSqm:Number(selected?.coefficient)||0,costPerSqm:Number(selected?.costPerSqm??m.price)};for(const r of rules)weightRules.push({material:m.name,thickness:r.thickness,variant:r.variant,coefficient:r.coefficient,default:r.default,costPerSqm:r.costPerSqm});}
    return P.normalizeRules({materials,weightRules,keywords:state.materials.map(m=>m.name)});
  }
  async function recoveryPoints(){const result=await request('/api/backups');backupItems=result.items;dataPath=result.dataDir;open('recovery-points');}
  async function downloadState(data,name){const migrated=M.migrate(data);if(!M.validateBackup(migrated))throw Error('恢复点未通过校验，请下载原件');const result=await auxiliary('export-backup',{state:migrated});downloadLink(window.FileJobs.auxiliaryDownloadUrl(result.jobId),name+'.xlsx');}
  function empty(title,note,action='new-plan',label='新建计划'){return `<div class="empty">${icon('folder-open')}<h3>${e(title)}</h3><p class="note">${e(note)}</p>${action?btn(action,label,'plus','primary'):''}</div>`;}
  function nav(){return `<aside class="sidebar">
    <a class="brand" href="#" data-action="plan-view"><span class="brand-mark"><img src="assets/app-icon.png" alt="" width="34" height="34"></span><div><div class="brand-title">地垫工作台</div><div class="brand-sub">全域投放 · 盈亏测算</div></div></a>
    <div class="shop-picker"><label for="active-shop">当前店铺</label><div class="row"><select id="active-shop" aria-label="当前店铺">${state.shops.filter(s=>!s.deleted).map(s=>option(s.id,s.name,state.activeShop)).join('')}</select>${ib('shops','管理店铺','settings-2',view==='shops'?'aria-current="page"':'')}</div></div>
    <nav class="nav-group" aria-label="主导航">${[['plan-view','投放测算','layout-dashboard','plan'],['ledger-view','总账','chart-no-axes-combined','history'],['library-view','可复用规则','library','library'],['product-view','商品转表','table-2','product']].map(([a,l,i,v])=>btn(a,l,i,'nav-item '+(view===v?'active':''),view===v?'aria-current="page"':'')).join('')}</nav>
    <div class="shop-picker plan-picker"><label for="active-plan">当前计划</label><div class="row"><select id="active-plan" aria-label="当前计划" ${activePlans().length?'':'disabled'}>${activePlans().map(p=>option(p.id,p.name,state.active)).join('')||'<option value="">暂无计划</option>'}</select>${ib('plans-view','管理计划','settings-2')}</div></div>
    <div class="sidebar-bottom">${btn('data-view','备份与迁移','file-spreadsheet','nav-item '+(view==='data'?'active':''),view==='data'?'aria-current="page"':'')}<div class="local-status"><span class="status-dot"></span>本机保存 · 手动录入</div><div class="view-label">正式版 v${APP_VERSION} · PC</div></div>
  </aside>`;}
  function topbar(){const titles={library:'可复用规则',history:'总账',plans:'计划管理',data:'备份与迁移',shops:'店铺管理',product:'商品转表'};return `<header class="topbar"><div class="crumbs"><span>${e(view==='history'?'全部经营数据':['library','data','shops','product'].includes(view)?'工作台':shopName(state.activeShop))}</span>${icon('chevron-right')}<strong>${e(titles[view]||current()?.name||'投放测算')}</strong></div><div class="topbar-right"><span class="tag">正式版 v${APP_VERSION}</span><span id="save-status" role="status">${saveStatusText()}</span><div id="update-controls" class="update-controls">${updateStatusText()}${updateAction()}</div>${ib('export','导出 Excel 备份','download')}</div></header><div id="save-banner"></div><div id="inline-draft-banner"></div>`;}
  function metric(id,r){
    if(!r.valid)return {value:'待完善',note:r.errors[0],full:r.errors.join('；')};
    const values={roi:r.roi,netRoi:r.netRoi,profit:r.profit,cost:r.cost,price:r.price,margin:r.margin,gmv:r.gmv,investment:r.investment,rate:r.rate*100};
    const notes={roi:'按退款后实收收入和类型化履约成本计算的保本线',netRoi:'扣除 1 小时内退款率后的净 ROI',profit:'已扣广告及已填费用',cost:'按退款类型分摊商品和运费，含平台费、税及其他费用，不含广告',price:'按订单占比加权',margin:'每卖一单可用于广告的钱',gmv:'广告消耗 × 支付 ROI',investment:'商品、广告和各项已填费用',rate:'每 100 元销售额，未扣广告的结余'};
    const v=values[id];return {value:id==='roi'||id==='netRoi'?(v>1e6?v.toExponential(2):roi(v)):v===null?'待填写':(id==='profit'&&v>=0?'+':'')+(id==='rate'?'':'¥')+short(v)+(id==='rate'?' 元':''),full:id==='roi'||id==='netRoi'?roi(v):money(v),note:notes[id],negative:v<0};
  }
  function metrics(r){return `<div class="metric-toolbar"><h2>当前测算</h2>${btn('display','显示设置','sliders-horizontal','ghost')}</div><div class="metric-grid" data-count="${state.prefs.ids.length}" style="--count:${state.prefs.ids.length}">${state.prefs.ids.map(id=>{const m=metric(id,r);return `<section class="metric" data-metric="${id}"><div class="metric-label">${M.metricList.find(x=>x.id===id).label}</div><div class="metric-value ${m.negative?'negative':id==='profit'?'positive':''}" title="${e(m.full)}" tabindex="0" aria-label="${e(M.metricList.find(x=>x.id===id).label+' '+m.full)}">${e(m.value)}</div><div class="metric-desc">${e(m.note)}</div></section>`;}).join('')}</div>`;}
  function paramField(key,label,unit='',params=current().params,entry=false){return `<label class="field"><span class="field-label">${label}</span><div class="input-unit"><input type="number" data-${entry?'entry-param':'param'}="${key}" aria-label="${entry?'入账 ':''}${label}" value="${e(params[key])}" min="0" ${['refund','fee','tax','recovery'].includes(key)?'max="100"':''} step="any"><span>${unit}</span></div></label>`;}
  function entryRefundFields(params){const rates=params.refundRates||{};return ['unshipped','shippedOnly','returnRefund','firstHour'].map(k=>`<label class="field"><span class="field-label">${{unshipped:'未发货仅退款率',shippedOnly:'已发货仅退款率',returnRefund:'退货退款率',firstHour:'1 小时内退款率（选填）'}[k]}</span><div class="input-unit"><input type="number" data-entry-refund-rate="${k}" value="${e(rates[k]??(k==='firstHour'?'':0))}" min="0" max="100" step="any"><span>%</span></div></label>`).join('')+`<p id="entry-refund-breakdown" class="note">${e(refundSummaryText(params))}</p>`;}
  function rail(){const p=current();return `<aside class="parameter-rail" aria-label="本计划参数">
    <section class="rail-section"><div class="section-head"><h2>投放与费用</h2><span class="tag">改动即试算</span></div><div class="fields">${paramField('spend','广告消耗','元')}${paramField('actualRoi','支付 ROI')}</div></section>
    <section class="rail-section fee-section"><div class="fields fee-fields"><label class="field"><span class="field-label">未发货仅退款率</span><div class="input-unit"><input type="number" data-param-rate="unshipped" value="${e(p.params.refundRates?.unshipped??0)}" min="0" max="100" step="any"><span>%</span></div></label><label class="field"><span class="field-label">已发货仅退款率</span><div class="input-unit"><input type="number" data-param-rate="shippedOnly" value="${e(p.params.refundRates?.shippedOnly??0)}" min="0" max="100" step="any"><span>%</span></div></label><label class="field"><span class="field-label">退货退款率</span><div class="input-unit"><input type="number" data-param-rate="returnRefund" value="${e(p.params.refundRates?.returnRefund??0)}" min="0" max="100" step="any"><span>%</span></div></label><label class="field"><span class="field-label">1 小时内退款率（选填）</span><div class="input-unit"><input type="number" data-param-rate="firstHour" value="${e(p.params.refundRates?.firstHour??'')}" min="0" max="100" step="any"><span>%</span></div></label>${paramField('fee','平台服务费','%')}${paramField('tax','税率','%')}</div><p id="refund-breakdown" class="note stack-gap">${e(refundSummaryText(p.params))}</p><p class="note">三类退款率分别参与成本测算；净 ROI 会扣除 1 小时内退款率。</p></section>
    <details class="advanced extra-costs"><summary><span>退货回收与其他费用</span>${icon('chevron-down')}</summary><div class="fields stack-gap">${paramField('recovery','退货回收比例','%')}${paramField('other','其他费用','元/单')}${paramField('returnCost','每退货单额外费用','元')}<label class="field"><span class="field-label">其他费用发生范围</span><select data-param-scope aria-label="其他费用发生范围">${option('shipped','已发货订单',p.params.otherFeeScope)}${option('all','所有订单',p.params.otherFeeScope)}</select></label></div><p class="note stack-gap">包材、运费险等填其他费用。回收比例指退货能收回的货品成本；成本不含广告。</p></details>
    <details class="advanced plan-notes"><summary><span>计划备注</span>${icon('chevron-down')}</summary><label class="field"><span class="sr-only">计划备注</span><textarea data-note aria-label="计划备注">${e(p.note)}</textarea></label></details>
  </aside>`;}
  function planPage(){const p=current();if(!p)return empty('这个店铺还没有计划','从已有材料和尺寸开始，填写一次即可反复测算。');const r=M.calculate(state,p),t=state.shippingTemplates.find(t=>t.id===p.shippingId),pm=state.materials.find(m=>m.id===p.materialId),pr=M.materialRule(pm,p);return `<div class="page-header"><div class="page-heading"><div class="row"><h1>${e(p.name)}</h1>${ib('rename-plan','重命名计划','pencil')}</div><p class="page-sub">修改参数即时测算，确认入账后计入总账。</p></div><div class="row">${btn('copy-plan','复制计划','copy')}${btn('entry','确认入账','book-check','confirm-entry')}</div></div>
    <div class="content-grid plan-overview"><section class="main-column" aria-label="测算结果"><div id="metrics">${metrics(r)}</div></section>${rail()}</div>
    <section class="plan-detail-card"><nav class="tabs" aria-label="测算视图">${[['sku','尺寸与售价'],['chart','投入与利润'],['history','历史账本']].map(([id,label])=>`<button type="button" data-action="tab" data-tab="${id}" class="tab ${tab===id?'active':''}" ${tab===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav>
    ${p.needsMaterialReview?`<div class="message-error">旧规格曾按厚度估算，请确认所选材料现在的真实报价。${btn('approve-material','已核对报价')}</div>`:''}<div id="tab-content">${tab==='sku'?skuTable(r):tab==='chart'?chartPage():historyPage(false)}</div></section>
    <footer class="page-footer"><span>手动估算 · 非结算利润</span><span>当前报价用于试算，历史按入账成本保留。</span></footer>`;}
  function skuCell(id,i){
    const key=i.id;
    if(id==='price'||id==='share')return `<td><input type="number" data-item="${e(key)}" data-key="${id}" value="${e(i[id])}" step="${id==='price'?'0.01':'any'}" min="0" ${id==='share'?'max="100"':''} aria-label="${e(sizeName(i.size)+' '+(id==='price'?'最终到手价':'订单占比'))}">${id==='price'?`<div class="price-mode">${i.priceMode==='manual'?'手动':current().strategyId?'策略价':'手动价'}${i.priceMode==='manual'&&current().strategyId?btn('restore-price','恢复策略价','','ghost',`data-id="${e(key)}"`):''}</div>`:''}</td>`;
    if(id==='weight')return `<td class="num"><button class="sku-weight" data-action="weight" data-id="${e(key)}" aria-label="编辑 ${e(sizeName(i.size))} 发货重量">${i.weight===''?'填写重量':e(weightText(i.weight))}</button></td>`;
    if(id==='sales')return `<td class="num">${i.sales===null||i.sales===undefined?'—':n(i.sales,0)}</td>`;
    const value=id==='grossMargin'?(Number.isFinite(i.grossMargin)?n(i.grossMargin)+'%':'—'):id==='roi'?(!M.positive(i.price)||!Number.isFinite(i.cost)?'待完善':roi(i.roi)):money(i[id]);
    return `<td class="num" data-row-${id}="${e(key)}">${value}</td>`;
  }
  function skuOptions(){const p=current(),m=state.materials.find(x=>x.id===p.materialId);return `<div id="sku-options" class="sku-options-body" ${skuOptionsOpen?'':'hidden'}><div class="reuse-selects"><label class="field"><span>默认材料</span><select data-plan-material aria-label="默认材料">${option('','请选择材料',p.materialId)}${materialOptions(p.materialId)}</select></label><label class="field"><span>厚度</span><select data-plan-material-rule aria-label="默认厚度">${option('','请选择厚度',p.materialRuleId)}${(m?.weightRules||[]).filter(r=>materialRuleUsable(r)&&(!r.deleted||r.id===p.materialRuleId)).map(r=>option(r.id,(r.thickness===''?'不限厚度':r.thickness+' mm')+(r.deleted?'（已删除）':''),p.materialRuleId)).join('')}</select></label><label class="field"><span>运费模板</span><select data-plan-shipping aria-label="运费模板">${option('','请选择运费模板',p.shippingId)}${shippingOptions(p.shippingId)}</select></label></div><div class="sku-options-actions"><select data-size-scheme aria-label="选用尺寸组合"><option value="">选用尺寸组合</option>${(state.sizeSchemes||[]).filter(x=>!x.deleted&&x.active!==false).map(x=>option(x.id,x.name,'')).join('')}</select>${btn('save-size-scheme','保存尺寸组合','save','ghost')}${btn('save-selected-strategy','另存定价方案','save','ghost',p.strategyId?'':'disabled')}${btn('sales-import','导入销售情况','upload','ghost')}${btn('listing-calculator','上架价格计算器','calculator','ghost')}</div></div>`;}
  function skuTable(r){
    const p=current(),columns=M.skuColumns(state),heads=columns.map(id=>M.skuColumnList.find(c=>c.id===id)).filter(Boolean);
    return `<div class="section-head review-toolbar"><div class="row"><h2>商品规格</h2><span class="tag">${r.rows.length} 个</span><button type="button" class="sku-options-toggle" data-action="sku-options" aria-expanded="${skuOptionsOpen}" aria-controls="sku-options">${skuOptionsOpen?'收起设置':'更多设置'}${icon('chevron-down')}</button></div><div class="row"><select class="strategy-select" data-plan-strategy aria-label="定价策略">${option('','定价策略 · 手动定价',p.strategyId)}${(state.pricingStrategies||[]).filter(x=>!x.deleted||x.id===p.strategyId).map(x=>option(x.id,'定价策略 · '+x.name+(x.deleted?'（已删除）':''),p.strategyId)).join('')}</select>${btn('sku-display','显示设置','sliders-horizontal','ghost','aria-label="商品规格显示设置"')}${btn('add-skus','添加规格','plus')}</div></div>${skuOptions()}${r.rows.length?`<div class="table-scroll"><table class="sku-table" style="--sku-min:${260+columns.length*98}px"><thead><tr><th>商品规格</th>${heads.map(c=>`<th data-column="${c.id}">${e(c.label)}${c.unit?`<small>/ ${e(c.unit)}</small>`:''}</th>`).join('')}<th><span class="sr-only">操作</span></th></tr></thead><tbody>${r.rows.map(i=>`<tr><td><div class="sku-title"><button type="button" data-action="sku-settings" data-id="${e(i.id)}">${e(sizeName(i.size))}</button>${i.size?.irregular?'<span class="tag">异形</span>':''}</div><div class="sku-sub">生产 ${e(production(i.size))}</div></td>${columns.map(id=>skuCell(id,i)).join('')}<td>${ib('remove-sku','移除 '+sizeName(i.size),'x',`data-id="${e(i.id)}"`)}</td></tr>`).join('')}</tbody></table></div><div class="total-row"><span>售价为最终到手价，手动改价后保留手动模式。</span><div class="row"><span id="share-total">合计 ${n(r.total,2)}%</span>${ib('normalize-share','调整占比至 100%','equal')}</div></div>`:empty('还没有商品规格','选择常用尺寸或输入自定义尺寸。','add-skus','添加规格')}<div id="validation">${errors(r)}</div>`;
  }
  function errors(r){return r.valid?'':`<div class="message-error" role="status"><span>${e(r.errors.join('；'))}</span>${['price','share','weight'].some(id=>!M.skuColumns(state).includes(id))?btn('show-sku-inputs','显示填写项','','ghost'):''}</div>`;}
  function trendDetail(index){
    const p=trendPoints[index],previous=trendPoints[index-1];if(!p)return '';
    const change=key=>{if(p[key]===null||!previous||previous[key]===null||p.partial||previous.partial)return '上期无完整可比数据';const delta=p[key]-previous[key];return `较上期 ${delta>=0?'+':'−'}${money(Math.abs(delta))}${previous[key]===0?'':`（${delta>=0?'+':'−'}${n(Math.abs(delta/previous[key]*100),1)}%）`}`;};
    return `<div class="trend-period"><strong>${e(p.label)}</strong><span>${p.count?`${p.days} 天有入账 · ${p.count} 笔${p.partial?' · 非完整周期':''}`:'未入账'}</span></div><div><span class="trend-key investment-key">总投入</span><strong>${p.investment===null?'—':money(p.investment)}</strong><small>${p.missingInvestment?'旧记录缺少成本数据':change('investment')}</small></div><div><span class="trend-key profit-key">利润</span><strong class="${p.profit<0?'negative':''}">${p.profit===null?'—':money(p.profit)}</strong><small>${change('profit')}</small></div>`;
  }
  function trendPanel(f,source=state){
    let r;try{r=H.series(source,f);}catch(error){trendPoints=[];return `<p class="message-error">${e(safeError(error,'趋势暂不可用，请检查起止日期后重试。'))}</p>`;}
    trendPoints=r.points;
    const header=`<div class="section-head trend-heading"><div><h2>投入与利润</h2><p class="note stack-gap">每期合计 · 已入账 ${r.count} 笔 · 成本按入账时保留</p></div><div class="trend-legend"><span class="trend-key investment-key">总投入</span><span class="trend-key profit-key">利润</span></div></div>`;
    if(!r.points.length)return header+empty('这个范围还没有入账数据','核对每天的投放数据并确认入账后，这里会显示两条时间曲线。试算不会计入。','trend-demo','查看图表示例');
    const values=r.points.flatMap(p=>[p.investment,p.profit]).filter(Number.isFinite),top=Math.max(1,...values),bottom=Math.min(0,...values),rawStep=(top-bottom)/5,base=10**Math.floor(Math.log10(rawStep)),step=base*[1,2,2.5,5,10].find(v=>v>=rawStep/base),max=Math.ceil(top*1.04/step)*step,min=bottom<0?Math.floor(bottom/step)*step:0;
    const x=i=>82+(r.points.length===1?326:i/(r.points.length-1)*652),y=v=>268-(v-min)/(max-min)*225;
    const line=key=>{let drawing=false;return r.points.map((p,i)=>{if(p[key]===null){drawing=false;return '';}const command=drawing?'L':'M';drawing=true;return `${command}${x(i)},${y(p[key])}`;}).join(' ');};
    const tickIds=[...new Set(Array.from({length:Math.min(6,r.points.length)},(_,i)=>Math.round(i*(r.points.length-1)/Math.max(1,Math.min(6,r.points.length)-1))))];
    const initial=r.points.findLastIndex(p=>p.count>0);
    return header+`<div class="trend-totals"><span>范围合计</span><span>总投入 <strong title="${e(money(r.investment))}">${r.investment===null?'数据待补':'¥'+short(r.investment)}</strong></span><span>利润 <strong class="${r.profit<0?'negative':'positive'}" title="${e(money(r.profit))}">¥${short(r.profit)}</strong></span></div><div class="trend-detail" id="trend-detail" aria-live="polite">${trendDetail(initial)}</div><div class="investment-chart"><svg viewBox="0 0 790 325" role="group" aria-label="总投入与利润随时间变化，横轴日期，纵轴金额；同一金额刻度，缺失日期断线"><text x="15" y="20">金额 / 元</text>${Array.from({length:Math.round((max-min)/step)+1},(_,i)=>{const value=min+step*i;return `<line x1="82" x2="734" y1="${y(value)}" y2="${y(value)}" stroke="#e6ebe7"/><text x="72" y="${y(value)+4}" text-anchor="end">${e(short(value))}</text>`;}).join('')}<line x1="82" x2="734" y1="${y(0)}" y2="${y(0)}" stroke="#9ba89e" stroke-dasharray="4 5"/>${tickIds.map(i=>`<text x="${x(i)}" y="294" text-anchor="middle">${e(f.unit==='month'?r.points[i].key.slice(0,7):r.points[i].from.slice(5))}</text>`).join('')}<text x="408" y="319" text-anchor="middle">日期 · ${{day:'每日',week:'每周（周一开始）',month:'每月'}[f.unit]}</text>${[['investment','#5572c3'],['profit','#237657']].map(([key,color])=>`<path data-series="${key}" d="${line(key)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${r.points.map((p,i)=>p[key]===null?'':`<circle cx="${x(i)}" cy="${y(p[key])}" r="${r.points.length<65?3.5:2}" fill="${color}"/>`).join('')}`).join('')}<line id="trend-guide" x1="${x(initial)}" x2="${x(initial)}" y1="35" y2="268" stroke="#b6c2b9" stroke-dasharray="3 4"/>${r.points.map((p,i)=>{const width=r.points.length===1?652:652/(r.points.length-1),left=i===0?82:x(i)-width/2,right=i===r.points.length-1?734:x(i)+width/2;return `<rect data-trend-index="${i}" data-x="${x(i)}" x="${r.points.length===1?82:left}" y="30" width="${right-left}" height="245" fill="transparent" tabindex="0" role="button" aria-label="${e(p.label+' 总投入 '+money(p.investment)+' 利润 '+money(p.profit)+(p.count?'':' 未入账'))}"/>`;}).join('')}</svg></div><p class="note">总投入含广告、材料、运费及已填费用；利润已扣退货影响。两条线使用同一刻度，按期合计，不是累计值。未入账日期留空，周/月仅合计已入账日期。</p>${r.missingInvestment?'<p class="message-error">部分旧账缺少成本数据，对应投入留空，利润仍保留。</p>':''}<details class="trend-table stack-gap"><summary>查看各期数据</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>总投入</th><th>利润</th><th>入账情况</th></tr></thead><tbody>${r.points.map(p=>`<tr><td>${e(p.label)}</td><td>${money(p.investment)}</td><td>${money(p.profit)}</td><td>${p.count?p.days+' 天 / '+p.count+' 笔':'未入账'}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function chartPage(){return `<div class="ledger-filters trend-filters"><label class="field"><span>开始日期</span><input type="date" data-chart="from" aria-label="趋势开始日期" value="${chartFilters.from}"></label><label class="field"><span>结束日期</span><input type="date" data-chart="to" aria-label="趋势结束日期" value="${chartFilters.to}"></label>${unitControl(false)}${btn('chart-recent','近 30 天','','ghost')}${btn('export-chart','导出此范围','download','ghost')}</div>${trendPanel({...chartFilters,shopId:state.activeShop,planId:current().id})}`;}
  function unitControl(all){const unit=all?ledgerUnit:chartFilters.unit;return `<label class="field"><span>查看方式</span><select data-${all?'ledger-unit':'chart="unit"'} aria-label="${all?'总账':'趋势'}查看方式">${[['day','按日'],['week','按周'],['month','按月']].map(([v,l])=>option(v,l,unit)).join('')}</select></label>`;}
  function trendDemo(){const demo=M.seed();demo.records=[];const p=demo.plans[0],breakeven=M.calculate(demo,p).roi;[600,900,1200,1500,1800,2000].forEach((spend,i)=>{const f=M.makeFrame(demo,p);Object.assign(f.plan.params,{spend,actualRoi:breakeven*(1+(i===5?50:150)/spend)});M.confirmRecord(demo,{frame:f,date:H.shift(M.today(),i-5)});});frame('图表示例 · 不计入总账',`<p class="dialog-note">这是演示数据：总投入持续增加，前五天利润保持 150 元，第六天降至 50 元。正式曲线只使用你的已入账数据。</p>${trendPanel({from:H.shift(M.today(),-5),to:M.today(),unit:'day'},demo)}`,btn('close','关闭示例'));}
  function historyPage(all){
    const f=all?filters:{...filters,shopId:state.activeShop,planId:current().id},invalid=f.from&&f.to&&f.from>f.to,result=invalid?{rows:[],count:0,profit:0,spend:0,gmv:0}:M.ledger(state,f);
    return `${all?'<div class="page-header"><div class="page-heading"><h1>总账</h1><p class="page-sub">只累计已确认的有效账目，成本按入账时保留。</p></div>'+btn('export-ledger','导出筛选账目','file-spreadsheet')+'</div><div class="wide-content">':''}<div class="ledger-filters">${all?`<label class="field"><span>店铺</span><select data-filter="shopId" aria-label="总账店铺">${option('','全部店铺',f.shopId)}${state.shops.map(s=>option(s.id,s.name,f.shopId)).join('')}</select></label><label class="field"><span>计划</span><select data-filter="planId" aria-label="总账计划">${option('','全部计划',f.planId)}${state.plans.filter(p=>!f.shopId||p.shopId===f.shopId).map(p=>option(p.id,p.name+(p.deleted?'（已删除）':''),f.planId)).join('')}</select></label>`:''}<label class="field"><span>开始日期</span><input type="date" data-filter="from" aria-label="开始日期" value="${e(f.from)}"></label><label class="field"><span>结束日期</span><input type="date" data-filter="to" aria-label="结束日期" value="${e(f.to)}"></label>${all?unitControl(true):''}${btn('clear-filters','清空筛选','','ghost')}</div><label class="show-old"><input type="checkbox" data-filter="includeOld" ${f.includeOld?'checked':''}>显示更正前、已作废及旧版试算</label>${invalid?'<p class="message-error">开始日期不能晚于结束日期</p>':''}${all?'<section class="ledger-trend">'+trendPanel({...f,unit:ledgerUnit})+'</section>':''}<div class="history-summary"><div><span>筛选范围内预估盈亏</span><strong class="${result.profit<0?'negative':'positive'}">${money(result.profit)}</strong></div><div><span>累计广告费</span><strong>${money(result.spend)}</strong></div><div><span>累计销售额</span><strong>${money(result.gmv)}</strong></div></div><div class="section-head"><h2>有效入账 ${result.count} 笔</h2>${all?'':btn('entry','确认入账','book-check','confirm-entry small')}</div>${result.rows.length?`<div class="table-scroll"><table class="history-table"><caption class="sr-only">筛选后的历史账目</caption><thead><tr>${['日期 / 店铺','计划 / 备注','入账材料价','广告费','预估盈亏','状态','操作'].map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${result.rows.map(h=>`<tr class="${h.status!=='confirmed'?'disabled-row':''}"><td>${h.date}<div class="sku-sub">${e(h.shopName)}</div></td><td>${e(h.planName)}${state.plans.find(p=>p.id===h.planId)?.deleted?'<span class="tag">已删除计划</span>':''}<div class="sku-sub">${e(h.note)}</div></td><td>${h.frame?e(frameCostLabel(h.frame)):money(h.legacy?.materialPrice)+'/㎡'}</td><td>${money(h.frame?.plan.params.spend??h.legacy?.spend)}</td><td class="${h.result.profit<0?'negative':'positive'}">${money(h.result.profit)}</td><td><span class="tag">${h.kind==='snapshot'?'旧版试算':{confirmed:'已入账',superseded:'已更正',void:'已作废'}[h.status]}</span></td><td>${btn('record-detail','查看','','ghost',`data-id="${h.id}"`)}</td></tr>`).join('')}</tbody></table></div>`:empty('这个范围还没有账目','填写当天数据并确认入账后，即可在这里查看。',state.records.length?'clear-filters':'plan-view',state.records.length?'清空筛选':'前往计划入账')}${all?'</div>':''}`;
  }
  const ruleTabs=[['materials','材料库'],['sizes','尺寸库'],['shipping','运费模板'],['pricingStrategies','定价策略'],['sizeSchemes','尺寸组合'],['promotionSchemes','活动方案']];
  function libraryPage(){const sizes=libraryTab==='sizes',shipping=libraryTab==='shipping',custom=['pricingStrategies','sizeSchemes','promotionSchemes'].includes(libraryTab);return `<div class="page-header"><div class="page-heading"><h1>可复用规则</h1><p class="page-sub">统一维护材料、尺寸、运费和可复用方案。</p></div>${btn(custom?'new-reusable':sizes?'new-size':shipping?'new-shipping':'new-material','新增'+({materials:'材料',sizes:'尺寸',shipping:'运费模板'}[libraryTab]||ruleTabs.find(x=>x[0]===libraryTab)?.[1]||'规则'),'plus','primary')}</div><div class="wide-content"><nav class="tabs" aria-label="规则分类">${ruleTabs.map(([id,name])=>`<button type="button" class="tab ${id===libraryTab?'active':''}" data-action="library-tab" data-tab="${id}">${name}</button>`).join('')}</nav><div class="rule-list-toolbar"><label><input type="checkbox" data-show-deleted ${showDeletedRules?'checked':''}>显示已删除</label></div>${custom?reusableList():sizes?`<div class="library-tools"><div class="segmented">${[['all','全部'],['rectangle','常规'],['irregular','异形']].map(([id,l])=>`<button type="button" data-action="shape-filter" data-id="${id}" class="${shape===id?'active':''}">${l}</button>`).join('')}</div><label class="search-field">${icon('search')}<input data-search aria-label="搜索规格" value="${e(query)}" placeholder="搜索规格或销售尺寸"></label></div><div id="size-list">${sizeList()}</div>`:shipping?shippingList():materialList()}</div>`;}
  function ruleSummary(x,key){if(key==='sizeSchemes')return x.sizeIds.map(id=>sizeName(state.sizes.find(s=>s.id===id))).join('、');if(key==='promotionSchemes')return x.steps.map(y=>y.type==='discount'?y.discount+' 折':'直减 '+money(y.amount)).join(' → ');if(x.type==='uniform')return '统一毛利 '+x.margin+'%';if(x.type==='rank')return '成本从低到高：'+x.tiers.join('% / ')+'%；后续 '+x.fallback+'%';return x.baseArea+'㎡ 起 '+x.baseMargin+'%，每增加 '+x.stepArea+'㎡ 上涨 '+x.stepPoints+' 个百分点，上限 '+x.cap+'%';}
  function reusableList(){const key=libraryTab,items=(state[key]||[]).filter(x=>showDeletedRules||!x.deleted);return `<div class="rule-cards">${items.map(x=>`<article class="rule-card ${x.deleted?'disabled-row':''}"><div class="row between"><h2>${e(x.name)}</h2>${x.deleted?'<span class="tag">已删除</span>':''}</div><p>${e(ruleSummary(x,key))}</p><div class="row">${x.deleted?btn('restore-rule','恢复','rotate-ccw','ghost',`data-kind="${key}" data-id="${e(x.id)}"`):btn('edit-reusable','编辑','pencil','ghost',`data-id="${e(x.id)}"`)+btn('copy-reusable','另存方案','copy','ghost',`data-id="${e(x.id)}"`)+ib('delete-rule','删除 '+x.name,'trash-2',`data-kind="${key}" data-id="${e(x.id)}"`)}</div></article>`).join('')||'<p class="note">暂无方案</p>'}</div>`;}
  function reusableForm(){const d=modal.draft,k=modal.kind;let body=field('方案名称','name',d.name,'text','maxlength="80"');if(k==='pricingStrategies'){body+=`<label class="field"><span>定价方式</span><select data-field="type" aria-label="定价方式">${[['uniform','统一毛利'],['rank','成本排名阶梯'],['area','面积递增毛利']].map(([v,t])=>option(v,t,d.type)).join('')}</select></label><div class="rule-fields stack-gap">${d.type==='uniform'?field('目标毛利率 / %','margin',d.margin):d.type==='area'?[['baseArea','基准面积 / ㎡'],['baseMargin','基准毛利率 / %'],['stepArea','递增面积 / ㎡'],['stepPoints','递增毛利 / 百分点'],['cap','毛利上限 / %']].map(([key,label])=>field(label,key,d[key])).join(''):d.tiers.map((v,i)=>`<label class="field"><span>第 ${i+1} 名毛利率 / %</span><input type="number" min="0" max="99.99" step="any" data-rank-tier="${i}" value="${e(v)}"></label>`).join('')+field('后续排名毛利率 / %','fallback',d.fallback)}</div>${d.type==='rank'?'<div class="row stack-gap">'+btn('add-rank-tier','增加档位','plus','ghost')+btn('remove-rank-tier','减少档位','minus','ghost',d.tiers.length<=1?'disabled':'')+'</div>':''}`;}
    if(k==='sizeSchemes')body+=`<div class="size-choice-grid stack-gap">${sizeChoices(d.sizeIds).replaceAll('data-select-size','data-rule-size')}</div>`;
    if(k==='promotionSchemes')body+=`<p class="note stack-gap">活动按顺序叠加，每一步基于上一步金额。</p>${d.steps.map((step,i)=>`<div class="promotion-step"><select data-activity-type="${i}" aria-label="第 ${i+1} 步活动">${option('discount','折扣',step.type)}${option('reduction','直减',step.type)}</select><input type="number" data-activity-value="${i}" step="0.01" min="0.01" value="${e(step.type==='discount'?step.discount:step.amount)}" aria-label="第 ${i+1} 步${step.type==='discount'?'折扣':'直减金额'}"><span>${step.type==='discount'?'折':'元'}</span>${ib('activity-up','上移','arrow-up',`data-index="${i}" ${i?'':'disabled'}`)}${ib('activity-down','下移','arrow-down',`data-index="${i}" ${i===d.steps.length-1?'disabled':''}`)}${ib('activity-remove','移除','x',`data-index="${i}"`)}</div>`).join('')}${btn('activity-add','添加活动','plus','ghost',d.steps.length>=10?'disabled':'')}`;
    return frame(modal.id?'编辑方案':'保存方案',body);
  }
  function listingCalculator(){const p=current(),scheme=state.promotionSchemes.find(x=>x.id===p.promotionSchemeId),rows=M.calculate(state,p).rows;return frame('上架价格计算器',`<label class="field"><span>活动方案</span><select data-promotion-scheme aria-label="活动方案">${option('','无活动',p.promotionSchemeId)}${state.promotionSchemes.filter(x=>!x.deleted||x.id===p.promotionSchemeId).map(x=>option(x.id,x.name+(x.deleted?'（已删除）':''),p.promotionSchemeId)).join('')}</select></label><p class="note stack-gap">${scheme?e(ruleSummary(scheme,'promotionSchemes')):'上架价与最终到手价相同'}</p><div class="table-scroll"><table><thead><tr><th>商品规格</th><th>目标到手价</th><th>原始上架价</th><th>预计到手价</th><th>高出目标</th></tr></thead><tbody>${rows.map(i=>{const r=i.priceError?{error:i.priceError}:A.reverse(i.price,scheme);return `<tr><td>${e(sizeName(i.size))}</td><td>${money(i.price)}</td>${r.error?`<td colspan="3" class="negative">${e(r.error)}</td>`:`<td>${money(r.listingPrice)}</td><td>${money(r.finalPrice)}</td><td>${money(r.difference)}</td>`}</tr>`;}).join('')}</tbody></table></div>`,btn('save-selected-promotion','另存活动方案','save','ghost',scheme?'':'disabled')+btn('close','关闭')+btn('export-listing','导出价格表','download','primary',rows.some(i=>i.priceError||A.reverse(i.price,scheme).error)?'disabled':''));}
  function skuSettings(){const d=modal.draft,p=current(),m=state.materials.find(x=>x.id===(d.materialId||p.materialId));return frame('商品规格设置',`<label class="field"><span>材料</span><select data-field="materialId" aria-label="SKU 材料">${option('','继承计划默认',d.materialId||'')}${materialOptions(d.materialId)}</select></label><label class="field"><span>厚度</span><select data-field="materialRuleId" aria-label="SKU 厚度" ${d.materialId?'':'disabled'}>${option('','请选择厚度',d.materialRuleId)}${(m?.weightRules||[]).filter(r=>materialRuleUsable(r)&&(!r.deleted||r.id===d.materialRuleId)).map(r=>option(r.id,(r.thickness===''?'不限厚度':r.thickness+' mm')+(r.deleted?'（已删除）':''),d.materialRuleId)).join('')}</select></label><div class="dialog-grid">${field('商品 ID','productId',d.productId||'','text','maxlength="200"')}${field('SKU ID','skuId',d.skuId||'','text','maxlength="200"')}</div>${gramField('实测发货重量 / g','weight',d.weight)}`);}
    function materialList(){
      const inactiveCount=state.materials.filter(m=>!m.active).length;
      const visible=state.materials.filter(m=>(!m.deleted||showDeletedRules)&&(m.active||showInactiveMaterials||m.deleted));
      const toggle=inactiveCount?btn('toggle-inactive-materials',showInactiveMaterials?'隐藏停用材料':`显示停用材料（${inactiveCount}）`,'eye','ghost'):'';
      return `<div class="section-head library-intro"><p class="note">每种材料只维护厚度子规则；重量系数和规则成本由子规则决定。旧版字段仅作兼容保留。</p><div class="row">${toggle}</div></div><div class="table-scroll"><table class="material-table"><thead><tr>${['材料名称','厚度规则','当前成本 / ㎡','最近报价','状态','操作'].map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${visible.map(m=>`<tr><td><strong>${e(m.name)}</strong></td><td><details><summary>${(m.weightRules||[]).filter(r=>!r.variant).length} 条规则</summary><div class="note">${(m.weightRules||[]).filter(r=>!r.variant).map(r=>`${e(r.thickness===undefined||r.thickness===''?'不限厚度':r.thickness+' mm')} · 系数 ${n(r.coefficient,2)} · 成本 ${money(r.costPerSqm)}${r.default?' · 默认':''}`).join('<br>')||'暂无厚度规则'}</div></details></td><td class="num material-unit-price">${materialDisplayCost(m)}</td><td>${e(m.history?.at(-1)?.date||'—')}</td><td>${m.active?'启用':'停用'}</td><td><div class="row">${btn('material','编辑材料规则','','ghost',`data-id="${m.id}"`)}${btn('toggle-material',m.active?'停用':'启用','','ghost',`data-id="${m.id}"`)}${m.deleted?btn('restore-rule','恢复','rotate-ccw','ghost',`data-kind="materials" data-id="${m.id}"`):ib('delete-rule','删除 '+m.name,'trash-2',`data-kind="materials" data-id="${m.id}"`)}</div></td></tr>`).join('')||'<tr><td colspan="6" class="note">暂无启用材料</td></tr>'}</tbody></table></div>`;
    }
  function sizeList(){const list=state.sizes.filter(s=>(showDeletedRules||!s.deleted)&&(shape==='all'||s.irregular===(shape==='irregular'))&&(sizeName(s)+' '+dimensions(s)).includes(query));return list.length?`<div class="table-scroll"><table class="size-table"><thead><tr>${['商品规格','销售尺寸','实际生产尺寸','生产面积 / ㎡','状态','操作'].map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${list.map(s=>`<tr><td><strong>${e(sizeName(s))}</strong><div class="sku-sub">${s.irregular?'异形':'常规'}</div></td><td>${e(dimensions(s))}</td><td>${e(production(s))}</td><td>${n(M.productionArea(s),4)}</td><td><span class="tag ${s.needsReview?'amber':''}">${s.needsReview?'待补生产尺寸':s.active?'启用':'停用'}</span></td><td>${btn('edit-size','编辑','','ghost',`data-id="${s.id}" aria-label="编辑 ${e(sizeName(s))}"`)}${s.deleted?btn('restore-rule','恢复','rotate-ccw','ghost',`data-kind="sizes" data-id="${s.id}"`):btn('toggle-size',s.active?'停用':'启用','','ghost',`data-id="${s.id}"`)+ib('delete-rule','删除 '+sizeName(s),'trash-2',`data-kind="sizes" data-id="${s.id}"`)}</td></tr>`).join('')}</tbody></table></div>`:empty('没有匹配的规格','可以新增公共规格供所有计划使用。','new-size','新增规格');}
  function shippingList(){return `<p class="note library-intro">每个计划选择一个模板。重量均为含包装的发货重量，区间包含上限。</p><div class="shipping-grid">${state.shippingTemplates.filter(t=>showDeletedRules||!t.deleted).map(t=>`<article class="shipping-card"><div class="row between"><h2>${e(t.name)}</h2><span class="tag">${shippingTypeLabels[t.type]||'未知计费方式'}</span></div><p>${e(ruleText(t))}</p><div class="row">${btn('shipping','编辑规则','pencil','',`data-id="${t.id}"`)}${btn('toggle-shipping',t.active?'停用':'启用','','ghost',`data-id="${t.id}"`)}${t.deleted?btn('restore-rule','恢复','rotate-ccw','ghost',`data-kind="shippingTemplates" data-id="${t.id}"`):ib('delete-rule','删除 '+t.name,'trash-2',`data-kind="shippingTemplates" data-id="${t.id}"`)}</div></article>`).join('')}</div>`;}
  function plansPage(){return `<div class="page-header"><div class="page-heading"><h1>${e(shopName(state.activeShop))} · 计划管理</h1><p class="page-sub">删除计划后，原有账目仍留在总账。</p></div>${btn('new-plan','新建计划','plus','primary')}</div><div class="wide-content"><div class="plans-grid">${state.plans.filter(p=>p.shopId===state.activeShop).map(p=>{const r=M.calculate(state,p);return `<article class="plan-tile ${p.deleted?'disabled-row':''}"><div class="row between"><h2>${e(p.name)}</h2>${p.deleted?'<span class="tag">已删除</span>':ib('delete-plan','删除 '+p.name,'trash-2',`data-id="${p.id}"`)}</div><div><span class="muted tiny">保本 ROI</span><div class="tile-roi">${r.valid?roi(r.roi):'待完善'}</div></div><p class="note">${e(p.note||'暂无备注')}</p>${btn(p.deleted?'restore-plan':'select-plan',p.deleted?'恢复计划':'打开计划',p.deleted?'rotate-ccw':'arrow-up-right','',`data-id="${p.id}"`)}</article>`;}).join('')||empty('还没有计划','新计划会归属当前店铺。')}</div></div>`;}
  function shopsPage(){return `<div class="page-header"><div class="page-heading"><h1>店铺管理</h1><p class="page-sub">每家店铺独立管理计划，共用可复用规则。</p></div>${btn('new-shop','新增店铺','plus','primary')}</div><div class="wide-content"><div class="plans-grid">${state.shops.map(s=>`<article class="plan-tile"><div class="row between"><h2>${e(s.name)}</h2>${ib('rename-shop','重命名 '+s.name,'pencil',`data-id="${s.id}"`)}</div><p class="note">${state.plans.filter(p=>p.shopId===s.id&&!p.deleted).length} 个使用中计划</p>${btn('select-shop','进入店铺','arrow-up-right','',`data-id="${s.id}"`)}</article>`).join('')}</div></div>`;}
  function dataPage(){const bytes=new Blob([JSON.stringify(state)]).size;return `<div class="page-header"><div class="page-heading"><h1>备份与迁移</h1><p class="page-sub">一份 Excel，运营能看，另一台电脑也能恢复。</p></div></div><div class="wide-content"><section class="data-section"><h2>导出 Excel 工作簿</h2><p>可导出完整工作区，或自选店铺、计划和账目日期。所需的材料、尺寸和运费规则会随文件保存。</p><div class="data-actions">${btn('export','选择范围并导出','file-spreadsheet','primary')}${btn('import','导入并恢复','upload')}</div><p>完整恢复请使用未修改的原始导出文件。需要分析时可另存副本；导入会检查表格与冻结账目的完整性。</p></section><section class="data-section"><h2>当前数据</h2><div class="data-stats"><span>${state.shops.length} 家店铺</span><span>${state.plans.filter(p=>!p.deleted).length} 个计划</span><span>${state.records.filter(h=>h.kind==='daily').length} 条账目版本</span><span>约 ${n(bytes/1024)} KB</span></div><p>工作区保存在本机数据库。保留最近 30 个有修改日期的恢复点和最近 10 次导入替换前的副本，更正前账目一直保留。</p><p>普通改数不会反复新增整份备份。旧版升级前的原始副本继续保留；仍建议定期导出 Excel 到其他磁盘。</p><div class="data-actions">${btn('recovery-points','查看本机恢复点','history')}</div></section><section class="data-section"><h2>换电脑</h2><p>在原电脑导出 Excel → 复制文件到新电脑 → 导入恢复。默认合并并跳过重复账目；按范围的文件不会替换整个工作区。</p><p>兼容导入旧版 JSON；新导出统一使用 Excel。完整文件可选替换全部数据，确认前先备份本机。从原型迁移时，请先在原型导出 Excel，再在这里导入。</p></section></div>`;}
  function productTransferPage(){if(productUI)return productUI.html();
    const r=productResult;
    const exceptionCount=r?.exceptions?.length||0;
    const exceptionGroups=r&&P?.exceptionGroups?P.exceptionGroups(r):{products:[],rows:[]};
    const allGroups=exceptionGroups.products||[],allRows=exceptionGroups.rows||[];
    productGroupPage=Math.max(0,Math.min(productGroupPage,Math.ceil(allGroups.length/100)-1));productRowPage=Math.max(0,Math.min(productRowPage,Math.ceil(allRows.length/100)-1));
    const productGroups=allGroups.slice(productGroupPage*100,productGroupPage*100+100),rowExceptions=allRows.slice(productRowPage*100,productRowPage*100+100);
    return `<div class="page-header"><div class="page-heading"><h1>商品转表</h1><p class="page-sub">上传 ERP 商品规格，使用固定模板识别字段后生成静态值商品表。</p></div><div class="row">${btn('product-export','导出商品表','download','primary',(!r||!r.summary?.ready||productBusy)?'disabled':'')}</div></div>
      <div class="wide-content product-transfer-page">
        <section class="product-upload-grid"><div class="product-upload product-template-fixed"><span>1. 模板文件</span><strong>已内置固定模板</strong><small>${e(productFiles.template?.name||'正在加载固定 29 列模板')}</small></div><label class="product-upload"><span>2. ERP 原始商品规格</span><input type="file" accept=".xlsx" data-product-file="source" ${productBusy?'disabled':''}><small>${e(productFiles.source?.name||'选择包含商品规格的 Excel')}</small></label></section>
        <section class="product-rules"><div class="section-head"><div><h2>材料规则来源</h2><p class="note">商品转表直接读取可复用规则中的材质、厚度、重量系数和成本价。请在材料库维护唯一规则。</p></div>${btn('library-view','打开材料库','library','ghost')}</div></section>
        ${productBusy?'<p class="message-success" role="status" aria-live="polite">正在读取并计算商品数据…</p>':''}${productError?`<div class="message-error" role="alert">${e(productError)}${btn('product-retry','重试','refresh-cw')}</div>`:''}
        ${r?`<section class="product-summary"><div><strong>${r.summary.sourceRows}</strong><span>条原始规格</span></div>${productGroups.length?`<div><strong>${productGroups.length}</strong><span>个待复核商品</span></div>`:''}<div><strong>${r.summary.exceptionRows}</strong><span>条待复核 SKU</span></div><div><strong>${r.summary.ready?'可导出':'需处理异常'}</strong><span>导出状态</span></div><p class="note">识别到表头：${e(r.sourceHeader.join('、'))} · 输出 29 列、${r.summary.sourceRows} 条数据（含表头共 ${r.summary.sourceRows+1} 行）。</p></section>`:'<div class="empty product-empty">'+icon('file-spreadsheet')+'<h3>等待上传 ERP 商品规格 Excel</h3><p class="note">模板已固定内置。文件只作为表格数据读取，单元格内容不会被执行。</p></div>'}
        ${r&&productGroups.length?`<section class="product-exceptions product-product-groups"><div class="section-head"><div><h2>按商品 ID 复核材质</h2><p class="note">同一平台商品 ID 下的不同 SKU 共用一个材质。填写一次后，会应用到该商品的全部 SKU。</p></div><span class="tag amber">${productGroups.length} 个商品</span></div><div class="table-scroll"><table><thead><tr><th>商品 ID</th><th>平台商品名称</th><th>SKU 数</th><th>规格示例</th><th>材质</th><th>异常</th><th>操作</th></tr></thead><tbody>${productGroups.map(group=>{const rowNumber=group.rowNumbers[0],specs=group.specNames.slice(0,3).join('、')+(group.specNames.length>3?'…':'');return `<tr><td>${e(group.productId)}</td><td>${e(group.productName)}</td><td>${group.skuCount}</td><td class="product-spec-preview">${e(specs)}</td><td><input data-product-group-edit="material" data-product-row="${rowNumber}" value="${e(group.material)}" aria-label="商品 ${e(group.productId)} 材质"></td><td class="negative">${e(group.issueText)}</td><td>${btn('product-review-product','应用到全部 SKU','check','ghost',`data-row="${rowNumber}"`)}</td></tr>`;}).join('')}</tbody></table></div></section>`:''}
        ${r&&rowExceptions.length?`<section class="product-exceptions"><div class="section-head"><div><h2>${productGroups.length?'逐 SKU 异常':'异常复核'}</h2><p class="note">尺寸、商品 ID、规格 ID 或售价异常需要逐行确认；材质统一在商品级区域填写。</p></div><div class="row"><span class="tag amber">${rowExceptions.length} 条</span>${btn('product-batch-review','批量应用逐行复核','check','primary')}</div></div><div class="table-scroll"><table><thead><tr><th>行</th><th>平台规格名称</th><th>材质</th><th>长</th><th>宽</th><th>商品 ID</th><th>规格 ID</th><th>售价 / 元</th><th>库存</th><th>异常</th><th>操作</th></tr></thead><tbody>${rowExceptions.map(({exception:x,row,materialEditable})=>{const v=[...(row?.values||x.output||[])];for(const [key,index] of [['material',5],['width',9],['length',10],['productId',17],['specId',18],['price',19],['inventory',21]])if(productReviews[x.rowNumber]?.[key]!==undefined)v[index]=productReviews[x.rowNumber][key];return `<tr><td>${x.rowNumber}</td><td>${e(v[4])}</td><td>${materialEditable?`<input data-product-edit="material" data-row="${x.rowNumber}" value="${e(v[5])}" aria-label="第 ${x.rowNumber} 行材质">`:`<span class="muted">${e(v[5]||'在上方按商品填写')}</span>`}</td><td><input type="number" data-product-edit="width" data-row="${x.rowNumber}" value="${e(v[9])}" aria-label="第 ${x.rowNumber} 行长度"></td><td><input type="number" data-product-edit="length" data-row="${x.rowNumber}" value="${e(v[10])}" aria-label="第 ${x.rowNumber} 行宽度"></td><td><input data-product-edit="productId" data-row="${x.rowNumber}" value="${e(v[17])}" aria-label="第 ${x.rowNumber} 行商品 ID"></td><td><input data-product-edit="specId" data-row="${x.rowNumber}" value="${e(v[18])}" aria-label="第 ${x.rowNumber} 行规格 ID"></td><td><input type="number" min="0" max="1000000000000" step="any" data-product-edit="price" data-row="${x.rowNumber}" value="${e(v[19])}" aria-label="第 ${x.rowNumber} 行售价"></td><td><input type="number" min="0" max="1000000000000" step="any" data-product-edit="inventory" data-row="${x.rowNumber}" value="${e(v[21])}" aria-label="第 ${x.rowNumber} 行库存"></td><td class="negative" id="product-error-${x.rowNumber}">${e(x.issues.map(i=>i.message).join('；'))}</td><td>${btn('product-review-row','应用复核','check','ghost',`data-row="${x.rowNumber}"`)}</td></tr>`;}).join('')}</tbody></table></div></section>`:''}
        ${productPager('group',productGroupPage,allGroups.length)}${productPager('row',productRowPage,allRows.length)}
        ${r&&r.summary.ready?'<p class="message-success">已完成字段映射、材质识别、尺寸解析及静态值计算，可以导出。</p>':''}
      </div>`;
  }
  function productPager(kind,page,count){return count<=100?'':`<nav class="review-pagination" aria-label="${kind==='group'?'商品':'SKU'}异常分页">${ib('product-page','上一页','chevron-left',`data-kind="${kind}" data-page="${page-1}" ${page===0?'disabled':''}`)}<span>${kind==='group'?'商品':'SKU'}异常 ${page+1} / ${Math.ceil(count/100)} 页 · 共 ${count} 条</span>${ib('product-page','下一页','chevron-right',`data-kind="${kind}" data-page="${page+1}" ${(page+1)*100>=count?'disabled':''}`)}</nav>`;}
  async function analyzeProductFiles(file){
    if(productBusy||!P||!file&&!productFiles.source)return;
    productBusy=true;productError='';productResult=null;productReviews={};productGroupPage=productRowPage=0;render();
    try{
      if(file){if(file.size>P.MAX_FILE_BYTES)throw Object.assign(Error('ERP file size limit'),{code:'IMPORT_LIMIT'});productFiles.source={name:file.name,arrayBuffer:await readProductFile(file)};}
      if(!productFiles.template){const response=await fetch('assets/product-template.xlsx');if(!response.ok)throw Error('Template unavailable');productFiles.template={name:'内置商品模板（固定）',arrayBuffer:await response.arrayBuffer()};}
      productResult=await P.analyze(productFiles.template.arrayBuffer,productFiles.source.arrayBuffer,{rules:transferRules()});
    }catch(error){productError=safeError(error,error.code==='IMPORT_LIMIT'?'文件超过导入上限（15 MB、5000 行、200 列），请拆分后重新上传。':'文件解析失败，请检查 Excel 格式和商品表头后重新上传或重试。');}
    finally{productBusy=false;render();}
  }
  function readProductFile(file){
    if(file.arrayBuffer)return file.arrayBuffer();
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||Error('文件读取失败'));reader.readAsArrayBuffer(file);});
  }
  async function exportProduct(){
    if(productBusy||!productResult?.summary?.ready||productResult.exceptions?.length)return toast('请先处理全部异常');
    productBusy=true;render();
    try{const bytes=await P.exportWorkbook(productFiles.template.arrayBuffer,productResult),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=`商品转表-${M.today()}-${productResult.rows.length}条.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('商品表已导出');}
    catch(error){toast(safeError(error,'文件处理失败，请检查文件格式和数据后重试。'));}
    finally{productBusy=false;render();}
  }
  function focusSnapshot(root){
    const el=document.activeElement;if(!root.contains?.(el))return null;
    return {id:el.id,tag:el.tagName,data:{...el.dataset},label:el.getAttribute('aria-label'),start:el.selectionStart,end:el.selectionEnd};
  }
  function restoreFocus(root,snapshot){
    if(!snapshot)return;
    const match=[...root.querySelectorAll('input,select,textarea,button,a,[tabindex]')].find(el=>el.tagName===snapshot.tag&&(snapshot.id?el.id===snapshot.id:Object.keys(snapshot.data).length?Object.entries(snapshot.data).every(([key,value])=>el.dataset[key]===value):snapshot.label&&el.getAttribute('aria-label')===snapshot.label));
    const target=match||root.querySelector('h1,h2,#main-content');if(!target)return;if(!match)target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
    if(match&&typeof snapshot.start==='number'&&['text','search','textarea'].includes(match.type))match.setSelectionRange(snapshot.start,snapshot.end);
  }
  function decorateTables(root){
    for(const table of root.querySelectorAll('table')){
      if(!table.caption){const caption=table.createCaption();caption.className='sr-only';caption.textContent=table.closest('section')?.querySelector('h2,h3')?.textContent||root.querySelector('h1,h2')?.textContent||'工作台数据';}
      table.querySelectorAll('thead th').forEach(th=>th.setAttribute('scope','col'));
    }
  }
  function markProductErrors(){
    let first=null;
    for(const exception of productResult?.exceptions||[]){
      const fields=exception.issues.flatMap(i=>i.field?[i.field]:i.code==='DIMENSION'?['width','length']:i.code==='ID'?['productId','specId']:i.code==='MATERIAL'?['material']:[]);
      for(const field of fields){const input=document.querySelector(`[data-product-edit="${field}"][data-row="${exception.rowNumber}"]`);if(!input)continue;input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',`product-error-${exception.rowNumber}`);first??=input;}
    }
    return first;
  }
  function render(){const focus=focusSnapshot(app);normalize();app.innerHTML=`<div class="app-shell">${nav()}<main class="workspace" id="main-content" tabindex="-1">${topbar()}${({plan:planPage,plans:plansPage,shops:shopsPage,library:libraryPage,history:()=>historyPage(true),data:dataPage,product:productTransferPage}[view]||planPage)()}</main></div>`;window.ScopePickers?.refresh();window.lucide?.createIcons();paintSaveStatus();decorateTables(app);applyInlineDrafts();restoreFocus(app,focus);markProductErrors();}
  function refreshCalculation(){const p=current();if(!p)return;const r=M.calculate(state,p),el=document.querySelector('#metrics');if(el)el.innerHTML=metrics(r);for(const i of r.rows){for(const [selector,value] of [['material',money(i.material)],['shipping',money(i.shipping)],['cost',money(i.cost)],['grossMargin',Number.isFinite(i.grossMargin)?n(i.grossMargin)+'%':'—'],['roi',!M.positive(i.price)||!Number.isFinite(i.cost)?'待完善':roi(i.roi)]]){const cell=document.querySelector(`[data-row-${selector}="${i.id}"]`);if(cell)cell.textContent=value;}}for(const i of r.rows){const priceInput=document.querySelector(`[data-item="${i.id}"][data-key="price"]`);if(priceInput&&document.activeElement!==priceInput)priceInput.value=i.price;const mode=priceInput?.parentElement?.querySelector('.price-mode');if(mode)mode.innerHTML=i.priceMode==='manual'?'手动'+(p.strategyId?btn('restore-price','恢复策略价','','ghost',`data-id="${e(i.id)}"`):''):p.strategyId?'策略价':'手动价';const cell=document.querySelector(`[data-row-cost="${i.id}"]`);if(cell)cell.title='按退款类型分摊商品和运费；含平台费、税及其他费用，未含广告';}const total=document.querySelector('#share-total');if(total)total.textContent=`合计 ${n(r.total,2)}%`;const breakdown=document.querySelector('#refund-breakdown');if(breakdown)breakdown.textContent=refundSummaryText(p.params);const error=document.querySelector('#validation');if(error)error.innerHTML=errors(r);const side=document.querySelector(`[data-sidebar="${p.id}"]`);if(side)side.textContent='保本 ROI '+(r.valid?roi(r.roi):'待完善');window.lucide?.createIcons();}
  function open(type,data={}){lastFocus=document.activeElement;modal={type,...data};paintModal();modal.baseline=modalValue();if(!dialog.open)dialog.showModal();dialog.querySelector('input,select,button')?.focus();dialog.scrollTop=0;}
  function close(force=false){if(!modal)return;if(!force&&modal.pending)return;if(!force&&!modal.committed&&modal.baseline!==modalValue()&&!window.confirm('有未保存的修改，确定放弃并关闭吗？'))return;const parent=modal?.parent;if(!['recover-form','recover-draft','recovery-points','record-detail','listing-calculator','confirm'].includes(modal.type))formDrafts?.remove('modal').catch(error=>toast(error.message));dialog.close();modal=null;if(parent){modal=parent;paintModal();dialog.showModal();}else if(lastFocus?.isConnected)lastFocus.focus();else{const action=lastFocus?.dataset?.action,id=lastFocus?.dataset?.id;const target=action?[...document.querySelectorAll('[data-action]')].find(el=>el.dataset.action===action&&(!id||el.dataset.id===id)):null;(target||document.querySelector('#main-content'))?.focus();}}
  function modalValue(){return JSON.stringify(modal?{draft:modal.draft,ids:modal.ids,frame:modal.frame,date:modal.date,note:modal.note,reason:modal.reason,scope:modal.scope,restoreMode:modal.restoreMode,restorePlans:modal.restorePlans}:null);}
  function rememberForm(){if(!modal||!formDrafts||['confirm','restore','recover-draft','recover-form','recovery-points','record-detail','listing-calculator'].includes(modal.type))return;const payload={type:modal.type,id:modal.id,kind:modal.kind,sourceId:modal.sourceId,...JSON.parse(modalValue())};formDrafts.save('modal',payload,{entityId:current()?.id||'',baseRevision:queue?.revision}).catch(error=>toast(error.message));}
  async function persistModal(next,reason,success){
    if(operationPending||modal?.pending)return;
    const target=modal;operationPending=true;target.pending=true;
    const controls=[...dialog.querySelectorAll('button,input,select,textarea')],disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);dialog.setAttribute('aria-busy','true');
    try{
      if(!target.committed){commit(next,reason);target.committed=true;}
      if(await queue.flush()){close(true);toast(success);return true;}
      fail('尚未写入数据库。请检查顶部保存提示后重试保存，或先导出备份。');return false;
    }finally{
      operationPending=false;target.pending=false;dialog.removeAttribute('aria-busy');
      controls.forEach((el,i)=>el.disabled=target.committed&&el.tagName!=='BUTTON'?true:disabled[i]);lockCommittedFields();
    }
  }
  function fail(message,selector){const el=document.querySelector('#dialog-error');if(el){el.textContent=message;const input=selector?dialog.querySelector(selector):null;if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby','dialog-error');input.closest('details')?.setAttribute('open','');input.focus();}else el.focus();}else toast(message);}
  function lockCommittedFields(){if(modal?.committed){dialog.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);dialog.querySelectorAll('[data-action="confirm-record"],[data-action="confirm-restore"],[data-action="recover-draft"]').forEach(el=>el.textContent='重试保存');}}
  function frame(title,body,footer){const focus=focusSnapshot(dialog);dialog.className=['entry','record-detail','trend-demo'].includes(modal.type)?'entry-dialog':['export','restore'].includes(modal.type)?'transfer-dialog':modal.type==='size'?'size-dialog':modal.type==='sku-display'?'sku-settings-dialog':'';dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2>${ib('close','关闭','x')}</div><div class="dialog-body">${body}<p id="dialog-error" class="dialog-error" tabindex="-1" role="alert"></p></div><div class="dialog-footer">${footer||btn('close','取消')+btn('save-modal','保存','check','primary')}</div>`;window.lucide?.createIcons();decorateTables(dialog);restoreFocus(dialog,focus);lockCommittedFields();}
  function commonSizeChoices(){const used=new Set(current().items.map(i=>i.sizeId));return state.sizes.filter(s=>s.active!==false&&!s.deleted&&!s.irregular&&!s.needsReview&&M.validSize(s)&&!used.has(s.id)).map(s=>`<label class="select-size"><input type="checkbox" data-select-size="${e(s.id)}" ${modal.ids.includes(s.id)?'checked':''}><span>${e(dimensions(s))}</span></label>`).join('')||'<p class="note">常用尺寸均已添加</p>';}
  function sizeChoices(ids=[]){return state.sizes.filter(s=>s.active||ids.includes(s.id)).map(s=>`<label class="select-size"><input type="checkbox" data-select-size="${s.id}" ${ids.includes(s.id)?'checked':''}><span class="size-mark ${s.irregular?'irregular':''}"></span><div><strong>${e(sizeName(s))}</strong><div class="note">销售 ${e(dimensions(s))} · 生产 ${e(production(s))}</div></div></label>`).join('');}
  function sizeForm(){const d=modal.draft;frame(modal.id?'编辑规格':'新增规格',`<p class="dialog-note">规格供所有计划复用。修改只更新当前试算，历史账目保持原值。</p><div class="size-form-layout"><div class="size-fields">${field('规格名称（可选）','name',d.name,'text','maxlength="80" placeholder="例如：云朵款"')}<label class="shape-toggle"><input type="checkbox" data-field="irregular" ${d.irregular?'checked':''}><span><strong>异形地垫</strong><small>开启后按实际生产尺寸计算成本</small></span></label><div class="form-group-title">${d.irregular?'销售尺寸 · 仅展示':'商品尺寸'}</div><div class="dialog-grid">${field('销售长 / cm','salesW',d.salesW)}${field('销售宽 / cm','salesH',d.salesH)}</div>${d.irregular?`<div class="form-group-title">实际生产尺寸 · 用于算成本</div><div class="dialog-grid">${field('生产长 / cm','productionW',d.productionW)}${field('生产宽 / cm','productionH',d.productionH)}</div>`:''}</div><aside class="size-preview"><div class="shape-illustration ${d.irregular?'is-irregular':''}"><span></span></div><span class="note">生产面积</span><strong id="area-preview">${n(M.productionArea({...d,needsReview:false}),4)} ㎡</strong><p class="note">材料成本 = 生产面积 × 材料单价</p></aside></div>`);}
  function shippingRuleFields(t){
    if(t.type==='regional')return `<p class="note">内置普通省份最高常规价，按重量区间计算；偏远四省需人工核价。表格中的面单费已忽略。</p>`;
    if(t.type==='fixed')return field('每单运费 / 元','fee',t.fee);
    if(t.type==='step')return `<div class="dialog-grid">${gramField('首重 / g','firstWeight',t.firstWeight)}${field('首重费用 / 元','firstFee',t.firstFee)}${gramField('续重 / g','stepWeight',t.stepWeight)}${field('每续重费用 / 元','stepFee',t.stepFee)}${gramField('最高支持重量 / g','maxWeight',t.maxWeight)}</div><p class="note stack-gap">超过首重后，不足一个续重按一个收取。</p>`;
    return `<div class="tier-rows"><div class="tier-head"><span>重量上限（含）/ g</span><span>整单运费 / 元</span></div>${t.tiers.map((r,i)=>`<div class="tier-row"><input type="number" data-tier="${i}" data-key="upTo" data-unit="g" aria-label="第 ${i+1} 档重量上限 / g" value="${e(M.toGrams(r.upTo))}" step="any"><input type="number" data-tier="${i}" data-key="fee" aria-label="第 ${i+1} 档运费" value="${e(r.fee)}" step="any">${ib('remove-tier','移除第 '+(i+1)+' 档','x',`data-index="${i}" ${t.tiers.length===1?'disabled':''}`)}</div>`).join('')}</div>${btn('add-tier','增加重量档','plus','ghost')}<p class="note">上限需从小到大填写。第一档从 0 g 起，后续档不含前一档上限，超出最后一档时提示。</p>`;
  }
  function materialRuleFields(d){return `<div class="section-head stack-gap"><h3 class="form-group-title">厚度规则</h3>${btn('add-material-rule','新增厚度规则','plus','ghost')}</div><div class="material-rule-editor">${(d.weightRules||[]).map((r,i)=>({r,i})).filter(x=>!x.r.variant&&!x.r.deleted).map(({r,i},displayIndex)=>`<div class="dialog-grid material-rule-row"><label class="field"><span>厚度 / mm</span><input type="text" data-material-rule="${i}" data-rule-key="thickness" value="${e(r.thickness??'')}" aria-label="第 ${displayIndex+1} 条材料规则厚度"></label><label class="field"><span>重量系数</span><input type="number" data-material-rule="${i}" data-rule-key="coefficient" value="${e(r.coefficient)}" min="0" step="any" aria-label="第 ${displayIndex+1} 条材料规则重量系数"></label><label class="field"><span>规则成本 / ㎡</span><input type="number" data-material-rule="${i}" data-rule-key="costPerSqm" value="${e(r.costPerSqm)}" min="0" step="any" aria-label="第 ${displayIndex+1} 条材料规则成本"></label><label class="checkbox-field"><input type="checkbox" data-material-rule="${i}" data-rule-key="default" ${r.default?'checked':''}>默认规则</label>${ib('remove-material-rule','删除第 '+(displayIndex+1)+' 条规则','trash-2',`data-index="${i}"`)}</div>`).join('')}</div>`;}
  function entryShipping(){
    const t=modal.frame.shippingTemplates[0],input=(key,label)=>{const weight=['firstWeight','stepWeight','maxWeight'].includes(key);return `<label class="field"><span>${label}</span><input type="number" data-entry-shipping-key="${key}" ${weight?'data-unit="g"':''} aria-label="本次 ${label}" value="${e(weight?M.toGrams(t[key]):t[key])}" step="any"></label>`;};
    const rules=t.type==='regional'?'<p class="note">内置区域规则，面单费不计入。</p>':t.type==='fixed'?input('fee','每单运费 / 元'):t.type==='step'?['firstWeight','firstFee','stepWeight','stepFee','maxWeight'].map((k,i)=>input(k,['首重 / g','首重费用 / 元','续重 / g','每续重费用 / 元','最高重量 / g'][i])).join(''):t.tiers.map((r,i)=>`<div class="dialog-grid"><label class="field"><span>第 ${i+1} 档上限 / g</span><input type="number" data-entry-tier="${i}" data-key="upTo" data-unit="g" aria-label="本次第 ${i+1} 档上限 / g" value="${e(M.toGrams(r.upTo))}" step="any"></label><label class="field"><span>第 ${i+1} 档运费 / 元</span><input type="number" data-entry-tier="${i}" data-key="fee" aria-label="本次第 ${i+1} 档运费" value="${e(r.fee)}" step="any"></label></div>`).join('');
    return `<label class="field"><span>本次采用的运费模板</span><select data-entry-shipping aria-label="入账运费模板">${option('frozen','保持本次规则 · '+t.name,'frozen')}${state.shippingTemplates.filter(x=>x.active).map(x=>option(x.id,'采用当前模板 · '+x.name,'frozen')).join('')}</select></label><p class="note" id="entry-shipping-description">${e(ruleText(t))}</p><details class="advanced stack-gap"><summary>核对本次运费规则</summary><div class="stack-gap">${rules}</div><p class="note">这里填写的规则随本次账目保存。</p></details>`;
  }
  function frameCostLabel(f){if(!f)return '—';if(f.calculationVersion!==4)return money(M.frameMaterialPrice(f))+'/㎡';const pairs=new Map();for(const i of f.plan.items){const m=f.materials.find(x=>x.id===(i.materialId||f.plan.materialId)),r=M.materialRule(m,i.materialId?i:f.plan);if(m)pairs.set(m.id+'|'+(r?.id||''),{m,r});}return [...pairs.values()].map(({m,r})=>m.name+(r&&r.thickness!==''?' '+r.thickness+'mm':'')+' '+money(r?.costPerSqm??m.price)+'/㎡').join('；');}
  function entryMaterialFields(f){if(f.calculationVersion!==4)return '';const pairs=new Map();for(const i of f.plan.items){const m=f.materials.find(x=>x.id===(i.materialId||f.plan.materialId)),r=M.materialRule(m,i.materialId?i:f.plan);if(m&&r)pairs.set(m.id+'|'+r.id,{m,r});}if(pairs.size===1){const {m,r}=[...pairs.values()][0];if(m.id===f.plan.materialId&&r.id===f.plan.materialRuleId)return '';}if(!pairs.size)return '';return [...pairs.values()].map(({m,r})=>`<label class="field"><span>${e(m.name)} · ${e(r.thickness===''?'标准厚度':r.thickness+' mm')} / ㎡</span><input type="number" min="0" step="any" data-entry-material="${e(m.id)}" data-entry-rule="${e(r.id)}" aria-label="${e(m.name+' '+r.thickness+' 材料单价')}" value="${e(r.costPerSqm)}"></label>`).join('');}
  function entryForm(){const f=modal.frame,p=f.plan,m=f.materials.find(x=>x.id===p.materialId)||f.materials[0],r=M.calculate(f,p),quotes=state.materials.find(x=>x.id===m.id)?.history||m.history||[];
    frame(modal.previousId?'更正已入账记录':'确认当天入账',`<div class="entry-context"><span>${e(shopName(p.shopId))}</span>${icon('chevron-right')}<strong>${e(state.plans.find(x=>x.id===p.id)?.name)}</strong><span class="tag">${modal.previousId?'保留原记录':'核对后才计入总账'}</span></div><p class="dialog-note">${modal.previousId?'以下从原记录的成本和费用开始，更改只影响这笔账。':'以下是本次入账副本。请填当天实际数据，材料价可选旧报价或实际平均价。'}</p><div class="entry-columns"><section><div class="dialog-grid">${field('入账日期','date',modal.date,'date',`max="${M.today()}"`)}${field('入账备注','note',modal.note,'text','maxlength="100"')}</div><h3 class="form-group-title">当天投放与费用</h3><div class="dialog-grid">${paramField('spend','广告消耗','元',p.params,true)}${paramField('actualRoi','支付 ROI','',p.params,true)}${entryRefundFields(p.params)}<label class="field"><span class="field-label">其他费用发生范围</span><select data-entry-param="otherFeeScope" aria-label="入账其他费用发生范围">${option('shipped','已发货订单',p.params.otherFeeScope)}${option('all','所有订单',p.params.otherFeeScope)}</select></label>${paramField('fee','平台服务费','%',p.params,true)}${paramField('tax','税率','%',p.params,true)}${paramField('recovery','退货回收比例','%',p.params,true)}${paramField('other','其他费用','元/单',p.params,true)}${paramField('returnCost','每退货单额外费用','元',p.params,true)}</div></section><aside class="entry-cost-panel"><h3>本次用料成本</h3>${entryMaterialFields(f)||`<p>${e(m.name)}</p><label class="field"><span>参考报价</span><select data-quote aria-label="选择历史材料报价"><option value="">选择报价或直接填单价</option>${quotes.slice().reverse().map(h=>`<option value="${h.price}">${e(h.date)} · ${money(h.price)}/㎡</option>`).join('')}</select></label><label class="field"><span>本次材料单价 / ㎡</span><input type="number" data-entry-price aria-label="本次材料单价" value="${e(M.frameMaterialPrice(f))}" min="0" step="any"></label>`}<p class="note">混用不同批次时，按实际耗用面积算平均价，不按调价日期自动切分。</p>${entryShipping()}<div id="entry-summary">${entrySummary(r)}</div></aside></div><details class="entry-items" ${modal.previousId?'open':''}><summary>核对当天规格、售价、占比和重量</summary><div class="table-scroll"><table><thead><tr><th scope="col">规格 / 生产尺寸</th><th scope="col">售价 / 元</th><th scope="col">订单占比 / %</th><th scope="col">重量 / g</th></tr></thead><tbody>${p.items.map(i=>{const s=f.sizes.find(s=>s.id===i.sizeId);return `<tr><td>${e(sizeName(s))}<div class="note">${e(production(s))}</div></td>${['price','share','weight'].map(k=>`<td><input type="number" data-entry-item="${i.id||i.sizeId}" data-key="${k}" ${k==='weight'?'data-unit="g"':''} aria-label="入账 ${e(sizeName(s))} ${{price:'售价',share:'占比',weight:'重量 / g'}[k]}" value="${e(k==='weight'?M.toGrams(i[k]):i[k])}" step="any"></td>`).join('')}</tr>`;}).join('')}</tbody></table></div></details>${modal.previousId?field('更正原因（必填）','reason',modal.reason,'text','maxlength="200"'):''}<p class="note stack-gap">入账按退款类型分摊商品和运费，含平台费、税及其他费用，不含广告。之后有实际数据可更正，历史成本不会跟随今天的报价变化。</p>`,btn('close','继续核对')+btn('confirm-record',modal.previousId?'确认更正并入账':'确认入账','book-check','confirm-entry'));}
  function entrySummary(r){return `<div><span>当天支付销售额</span><strong>${money(r.gmv)}</strong></div><div><span>本次预估盈亏</span><strong class="${r.profit<0?'negative':'positive'}">${money(r.profit)}</strong></div>${r.valid?'':`<p class="message-error">${e(r.errors[0])}</p>`}`;}
  function refreshEntry(){const result=M.calculate(modal.frame,modal.frame.plan),el=document.querySelector('#entry-summary');if(el)el.innerHTML=entrySummary(result);const breakdown=document.querySelector('#entry-refund-breakdown');if(breakdown)breakdown.textContent=refundSummaryText(modal.frame.plan.params);}
  function recordDetail(){const h=state.records.find(h=>h.id===modal.id),f=h.frame,fr=f?M.refundMetrics(f.plan.params):null;frame('入账记录',`<div class="entry-context"><strong>${h.date} · ${e(h.shopName)} · ${e(h.planName)}</strong><span class="tag">${h.kind==='snapshot'?'旧版试算':{confirmed:'已入账',superseded:'已更正',void:'已作废'}[h.status]}</span></div><div class="record-summary"><div><span>预估盈亏</span><strong>${money(h.result.profit)}</strong></div><div><span>材料单价 / ㎡</span><strong>${f?e(frameCostLabel(f)):money(h.legacy?.materialPrice)}</strong></div><div><span>保本 ROI</span><strong>${roi(h.result.roi)}</strong></div></div><p class="note">${e(h.note||'无备注')}${h.reason?' · 更正原因：'+e(h.reason):''}</p>${h.previousId?`<p class="note">由原记录更正，原值保留。${btn('record-detail','查看原记录','','ghost',`data-id="${h.previousId}"`)}</p>`:''}${h.replacedBy?`<p class="note">这笔旧记录已不计入合计。${btn('record-detail','查看更正后的记录','','ghost',`data-id="${h.replacedBy}"`)}</p>`:''}${f?`<div class="ledger-row"><span>广告消耗 / 支付 ROI</span><span>${money(f.plan.params.spend)} / ${n(f.plan.params.actualRoi)}</span></div><div class="ledger-row"><span>退款类型</span><span>未发货 ${n(fr.unshipped)}% · 已发货仅退款 ${n(fr.shippedOnly)}% · 退货退款 ${n(fr.returnRefund)}% · 1 小时内 ${fr.firstHour===''?'未填':n(fr.firstHour)+'%'}</span></div><div class="ledger-row"><span>其他费用发生范围</span><span>${f.plan.params.otherFeeScope==='all'?'所有订单':'已发货订单'} · 平台费 ${n(f.plan.params.fee)}% · 税率 ${n(f.plan.params.tax)}%</span></div><div class="ledger-row"><span>运费模板（当时）</span><span>${e(f.shippingTemplates[0].name)}</span></div><p class="note stack-gap">${e(ruleText(f.shippingTemplates[0]))}</p><div class="table-scroll stack-gap"><table><thead><tr><th scope="col">规格</th><th scope="col">生产尺寸</th><th scope="col">售价</th><th scope="col">占比</th><th scope="col">材料成本</th><th scope="col">每单总成本</th></tr></thead><tbody>${M.calculate(f,f.plan).rows.map(i=>`<tr><td>${e(sizeName(i.size))}</td><td>${e(production(i.size))}</td><td>${money(i.price)}</td><td>${n(i.share)}%</td><td>${money(i.material)}</td><td>${money(i.cost)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="note stack-gap">这是旧版保存的记录，原值保留。旧版试算不计入总账。</p>'}`,h.kind==='daily'&&h.status==='confirmed'?(f?btn('correct-record','更正这笔账','pencil','',`data-id="${h.id}"`):'')+btn('void-record','作废记录','archive','ghost danger',`data-id="${h.id}"`)+'<span class="grow"></span>'+btn('close','关闭'):btn('close','关闭'));}
  function displayForm(){const ids=modal.ids;frame('指标显示设置',`<p class="dialog-note">选择 1–4 项，使用箭头调整顺序。四项时分为两行，长金额自动使用万或亿，悬停可看完整金额。</p>${[...ids,...M.metricList.map(x=>x.id).filter(id=>!ids.includes(id))].map(id=>{const m=M.metricList.find(x=>x.id===id),i=ids.indexOf(id);return `<div class="metric-choice"><label><input type="checkbox" data-metric-choice="${id}" ${i>=0?'checked':''}>${m.label}</label>${i>=0?`<span>${i+1}</span>${ib('metric-up','上移 '+m.label,'arrow-up',`data-id="${id}" ${i===0?'disabled':''}`)}${ib('metric-down','下移 '+m.label,'arrow-down',`data-id="${id}" ${i===ids.length-1?'disabled':''}`)}`:''}</div>`;}).join('')}`,btn('close','取消')+btn('save-modal','保存设置','check','primary',ids.length<1?'disabled':''));}
  function skuDisplayForm(){
    const ids=modal.ids,available=M.skuColumnList;frame('商品规格显示设置',`<p class="dialog-note">勾选要看的列，使用箭头调整顺序。重量可自动计算，也可填写含包装的实际总重。</p><div class="sku-fixed-column"><span>规格名称</span><span class="tag">固定首列</span></div>${[...ids,...available.map(x=>x.id).filter(id=>!ids.includes(id))].map(id=>{const c=available.find(x=>x.id===id),i=ids.indexOf(id);return `<div class="metric-choice"><label><input type="checkbox" data-sku-column="${id}" ${i>=0?'checked':''}>${c.label}</label>${i>=0?`<span>${i+1}</span>${ib('sku-up','上移 '+c.label,'arrow-up',`data-id="${id}" ${i===0?'disabled':''}`)}${ib('sku-down','下移 '+c.label,'arrow-down',`data-id="${id}" ${i===ids.length-1?'disabled':''}`)}`:''}</div>`;}).join('')}<div class="sku-fixed-column"><span>操作</span><span class="tag">固定末列</span></div><p class="note stack-gap">已选 ${ids.length} 列。列较多时可横向滚动；此设置与上方“当前测算”独立。</p>`,btn('sku-defaults','恢复默认','','ghost')+'<span class="grow"></span>'+btn('close','取消')+btn('save-modal','保存设置','check','primary'));
  }
  function paintModal(){
    const d=modal.draft;
    if(modal.type==='recover-form')return frame('发现未完成的填写',`<p>上次关闭时还有未提交的表单输入。${modal.stored.stale?'期间工作区已经更新，恢复后请核对再保存。':''}</p>`,btn('discard-form-draft','放弃填写')+btn('recover-form-draft','继续填写','pencil','primary'));
    if(modal.type==='recover-draft')return frame('发现未保存的草稿',`<p class="dialog-note">上次有修改尚未写入数据库。恢复将用草稿替换当前工作区；${pendingRecovery.baseRevision===queue.revision?'数据库版本与草稿一致。':'数据库之后有更新，建议先分别导出并核对。'}</p>`,btn('download-draft','导出草稿 Excel','download')+btn('keep-database','保留数据库版本')+btn('recover-draft','恢复草稿','check','primary'));
    if(modal.type==='recovery-points')return frame('本机恢复点',`<p class="dialog-note">先下载 Excel 核对，再通过“导入并恢复”使用。恢复点与数据库在同一台电脑，不能代替异地备份。</p><p class="note" style="overflow-wrap:anywhere">数据位置：${e(dataPath)}</p><div class="table-scroll"><table><thead><tr><th scope="col">时间</th><th scope="col">来源</th><th scope="col">操作</th></tr></thead><tbody>${backupItems.map(x=>`<tr><td>${e(new Date(x.created).toLocaleString('zh-CN'))}</td><td>${e(({'daily-v3':'每日恢复点','before-restore-v3':'导入替换前','schema-upgrade-original':'旧版升级前','initial-import':'首次保存'})[x.reason]||'旧版恢复点')}</td><td>${btn('download-checkpoint','下载 Excel','download','ghost',`data-id="${x.id}"`)}${btn('download-checkpoint-raw','下载原件','','ghost',`data-id="${x.id}"`)}</td></tr>`).join('')||'<tr><td colspan="3">暂无恢复点</td></tr>'}</tbody></table></div>`,btn('close','关闭'));
    if(modal.type==='size')return sizeForm();
    if(modal.type==='entry')return entryForm();
    if(modal.type==='record-detail')return recordDetail();
    if(modal.type==='display')return displayForm();
    if(modal.type==='sku-display')return skuDisplayForm();
    if(modal.type==='trend-demo')return trendDemo();if(modal.type==='reusable')return reusableForm();if(modal.type==='listing-calculator')return listingCalculator();if(modal.type==='sku-settings')return skuSettings();if(modal.type==='save-rule-copy')return frame('保存方案',field('方案名称','name',d.name,'text','maxlength="80"'));
    if(modal.type==='export')return exportForm();
    if(modal.type==='restore')return restoreForm();
    if(modal.type==='material')return frame(modal.id?'编辑材料规则':'新增材料',`${field('材料名称','name',d.name,'text','maxlength="80"')}${field('报价备注','note',d.note,'text','maxlength="200"')}${materialRuleFields(d)}<p class="note stack-gap">每个厚度规则填写最终每㎡成本和重量系数；材料主单价不再单独维护。</p>`);
    if(modal.type==='shipping')return frame(modal.id?'编辑运费规则':'新增运费模板',`${field('模板名称','name',d.name,'text','maxlength="80" placeholder="例如：普通地区 0–2000 g"')}<label class="field"><span>计费方式</span><select data-field="type" aria-label="计费方式" ${d.type==='regional'?'disabled':''}>${shippingTypeOptions(d.type).map(([id,l])=>option(id,l,d.type)).join('')}</select></label><div class="stack-gap">${shippingRuleFields(d)}</div><p class="note stack-gap">模板可按快递或地区命名，计划按对应报价选用。修改只更新当前试算，历史规则保留。</p>`);
    if(modal.type==='shop')return frame(modal.id?'重命名店铺':'新增店铺',field('店铺名称','name',d.name,'text','maxlength="80"'));
    if(modal.type==='plan')return frame(modal.id?'重命名计划':'新建计划',`<p class="dialog-note">所属店铺：${e(shopName(state.activeShop))}</p>${field('计划名称','name',d.name,'text','maxlength="80"')}${modal.id?'':`<label class="field"><span>本计划材料</span><select data-field="materialId" aria-label="新计划材料">${materialOptions(d.materialId)}</select></label><label class="field"><span>运费模板</span><select data-field="shippingId" aria-label="新计划运费模板">${shippingOptions(d.shippingId)}</select></label><p class="note stack-gap">创建后从公共尺寸库添加规格，并填写本计划的售价和占比。</p>`}`);
    if(modal.type==='add-skus')return frame('添加商品规格',`<div class="size-choice-grid">${commonSizeChoices()}</div><h3 class="form-group-title stack-gap">自定义尺寸</h3><div class="dialog-grid">${field('宽 / cm','salesW',d.salesW,'number','min="0.01" max="10000"')}${field('长 / cm','salesH',d.salesH,'number','min="0.01" max="10000"')}</div>`,btn('close','取消')+btn('save-modal','添加规格','plus','primary'));
    if(modal.type==='weight'){const i=current().items.find(i=>(i.id||i.sizeId)===modal.id),t=state.shippingTemplates.find(t=>t.id===current().shippingId);return frame('发货重量',`<p class="dialog-note">${e(sizeName(state.sizes.find(s=>s.id===i.sizeId)))} · ${e(current().name)}</p>${gramField('含包装重量 / g','weight',d.weight)}<p class="note stack-gap">填写含包装的实际总重；留空使用材料重量加固定包装重量。</p><p class="note">${e(ruleText(t))}</p><p id="weight-preview" class="weight-preview">预计运费：${money(M.shippingCost(t,d.weight).value)}</p>`);}
    if(modal.type==='confirm')return frame(modal.title,`<p class="dialog-note">${e(modal.message)}</p>`,btn('close','取消')+btn('confirm-action',modal.label||'确认','check',modal.danger?'danger':'primary'));
  }
  function confirmAction(title,message,run,label='确认',danger=false){open('confirm',{title,message,run,label,danger});}
  function validateEntry(){
    const f=modal.frame,p=f.plan,r=M.calculate(f,p);
    if(!M.validDate(modal.date)||modal.date>M.today()){fail('请选择今天或过去的有效日期。','[data-field="date"]');return false;}
    if(modal.previousId&&!modal.reason.trim()){fail('请填写更正原因。','[data-field="reason"]');return false;}
    for(const key of ['spend','actualRoi','fee','tax','recovery','other','returnCost'])if(!M.nonnegative(p.params[key])||['fee','tax','recovery'].includes(key)&&p.params[key]>100){fail('请填写有效的费用和比例。',`[data-entry-param="${key}"]`);return false;}
    const materialInputs=[...document.querySelectorAll('[data-entry-material]')];
    if(materialInputs.length){
      const invalid=materialInputs.find(input=>!M.nonnegative(Number(input.value)));
      if(invalid){fail('请填写有效的非负材料单价。',`[data-entry-material="${invalid.dataset.entryMaterial}"][data-entry-rule="${invalid.dataset.entryRule}"]`);return false;}
    }else if(!M.nonnegative(M.frameMaterialPrice(f))){fail('请填写有效的非负材料单价。','[data-entry-price]');return false;}
    const rates=p.params.refundRates||{},summary=M.refundMetrics(p.params);
    for(const key of ['unshipped','shippedOnly','returnRefund','firstHour'])if(!(key==='firstHour'&&rates[key]==='')&&(!M.nonnegative(rates[key])||rates[key]>100)||summary.refundTotal>100||summary.firstHour>summary.refundTotal){fail('请核对退款率；三类合计不超过 100%，1 小时内退款率不超过合计。',`[data-entry-refund-rate="${key}"]`);return false;}
    for(const item of p.items)for(const key of ['price','share','weight'])if(key==='price'&&!M.positive(item[key])||key==='share'&&(!M.nonnegative(item[key])||item[key]>100||Math.abs(r.total-100)>1e-6)||key==='weight'&&item[key]!==''&&(!M.positive(item[key])||M.shippingCost(f.shippingTemplates[0],item[key]).error)){fail('请核对售价、占比和模板支持的含包装重量；占比合计需为 100%。',`[data-entry-item="${item.id||item.sizeId}"][data-key="${key}"]`);return false;}
    if(!r.valid){fail(r.errors.join('；'),'[data-entry-shipping]');return false;}return true;
  }
  function startEntry(record){const p=current();if(!record&&!p)return;open('entry',{frame:record?M.clone(record.frame):M.makeFrame(state,p),date:record?.date||M.today(),note:record?.note||'',reason:'',previousId:record?.id||null});}
  function startExport(f){
    const shopIds=f?(f.shopId?[f.shopId]:f.planId?state.plans.filter(p=>p.id===f.planId).map(p=>p.shopId):state.shops.map(s=>s.id)):state.shops.map(s=>s.id),planIds=state.plans.filter(p=>shopIds.includes(p.shopId)&&(!f?.planId||p.id===f.planId)).map(p=>p.id);
    open('export',{scope:{mode:f?'scoped':'all',shopIds,planIds,from:f?.from||'',to:f?.to||''},parent:modal?.type==='restore'?modal:null});
  }
  function exportForm(){
    const s=modal.scope;let selected,error='';try{selected=T.select(state,s);}catch(err){error=safeError(err,'请至少选择一家店铺，并检查开始日期不晚于结束日期。');}
    const x=selected?.exportScope,count=selected?M.ledger(selected,{from:x?.from||'',to:x?.to||''}).count:0;
    frame('选择导出范围',`<p class="dialog-note">导出的 Excel 可直接查看，也可在另一台电脑导入恢复。</p><div class="export-modes"><label><input type="radio" name="export-mode" data-scope="mode" value="all" ${s.mode==='all'?'checked':''}>完整工作区</label><label><input type="radio" name="export-mode" data-scope="mode" value="scoped" ${s.mode==='scoped'?'checked':''}>自选范围</label></div>${s.mode==='scoped'?`<div class="scope-heading"><h3>店铺与计划</h3><div class="row">${btn('scope-all','全选','','ghost')}${btn('scope-none','清空','','ghost')}</div></div><div class="scope-list">${state.shops.map(shop=>{const plans=state.plans.filter(p=>p.shopId===shop.id),checked=s.shopIds.includes(shop.id);return `<section class="scope-shop"><label><input type="checkbox" data-scope-shop="${shop.id}" ${checked?'checked':''}><strong>${e(shop.name)}</strong><span class="note">${plans.filter(p=>s.planIds.includes(p.id)).length} / ${plans.length} 个计划</span></label>${checked?`<div class="scope-plans">${plans.map(p=>`<label><input type="checkbox" data-scope-plan="${p.id}" ${s.planIds.includes(p.id)?'checked':''}>${e(p.name)}${p.deleted?'<span class="tag">已删除</span>':''}</label>`).join('')||'<span class="note">空店铺，可单独导出</span>'}</div>`:''}</section>`;}).join('')}</div><div class="scope-heading"><h3>账目日期</h3>${btn('scope-dates-all','全部日期','','ghost')}</div><div class="dialog-grid"><label class="field"><span>开始日期</span><input type="date" data-scope="from" aria-label="导出开始日期" value="${e(s.from)}"></label><label class="field"><span>结束日期</span><input type="date" data-scope="to" aria-label="导出结束日期" value="${e(s.to)}"></label></div><p class="note stack-gap">日期只筛选账目。计划参数和所用可复用规则随文件保存，均为当前值。</p>`:''}<div class="export-preview" role="status">${error?`<p class="negative">${e(error)}</p>`:`<strong>将导出 ${selected.shops.length} 家店铺 · ${selected.plans.length} 个计划</strong><p>范围内有效入账 ${count} 笔 · 账目共 ${selected.records.length} 个版本${x?.relatedIds.length?`（含范围外关联更正 ${x.relatedIds.length} 个）`:''}</p><p>${selected.materials.length} 种材料 · ${selected.sizes.length} 个尺寸 · ${selected.shippingTemplates.length} 个运费模板</p>`}</div><p class="note stack-gap">更正和作废记录会一起保留，便于核对。需要加工表格时请另存副本，恢复使用未修改的原始文件。</p>`,btn('close','取消')+btn('confirm-export','导出 Excel','download','primary',error?'disabled':''));
  }
  function restoreForm(){
    if(!booted)return frame('恢复工作区',`<p>备份含 ${modal.data.shops.length} 家店铺、${modal.data.plans.length} 个计划、${modal.data.records.length} 条账目。恢复前会保留现有原始数据。</p>`,btn('close','取消')+btn('confirm-restore','确认恢复','check','primary'));
    const data=modal.data,scope=data.exportScope,merge=modal.merge||(modal.merge=T.merge(state,data,{restorePlans:!!modal.restorePlans})),r=merge.report,replace=modal.restoreMode==='replace';
    frame('导入 Excel',`<div class="import-source"><strong>${scope?'按范围导出':'完整工作区'} · ${data.shops.length} 家店铺 · ${data.plans.length} 个计划</strong><p>${e(data.shops.map(s=>s.name).join('、'))}</p><p>${scope?`${scope.from||'不限'} 至 ${scope.to||'不限'}`:'全部日期'} · ${data.records.length} 个账目版本</p></div>${scope?'':`<div class="export-modes"><label><input type="radio" name="restore-mode" data-restore-mode value="merge" ${!replace?'checked':''}>合并到本机</label><label><input type="radio" name="restore-mode" data-restore-mode value="replace" ${replace?'checked':''}>替换整个工作区</label></div>`}${replace?'<p class="message-error">将替换本机全部店铺、计划、可复用规则和账目。请先导出当前工作区留存。</p>':`<label class="restore-plan-choice"><input type="checkbox" data-restore-plans ${modal.restorePlans?'checked':''}>同时恢复所选计划的试算参数</label><p class="note">${modal.restorePlans?'按文件恢复所选计划的材料、运费规则、售价和占比；其他计划保持原样。':'已有计划保留本机试算；新计划始终按文件恢复。'}</p><div class="export-preview"><strong>新增 ${r.shops} 家店铺 · ${r.plans} 个计划 · ${r.added} 笔账目</strong><p>更新 ${r.updated} 个账目状态 · ${r.duplicates} 笔重复记录不再导入</p><p>补充 ${r.resources} 份可复用规则${modal.restorePlans?` · 更新 ${r.plansUpdated} 个计划试算`:''}。其他计划使用的可复用规则和本机显示设置保持原样。</p></div><p class="note stack-gap">仅合并文件中的数据。其他店铺和范围外账目保留；关联的更正记录会一起更新。</p>${r.conflicts.length?`<div class="message-error import-conflicts"><strong>${r.conflicts.length} 个计划有冲突：这些计划的账目全部保留本机版本，不导入文件版本。</strong><ul>${r.conflicts.map(c=>`<li>${e(c.name)}：${e(c.reason)}</li>`).join('')}</ul></div>`:''}`}`,btn('export','先导出本机 Excel','download')+btn('close','取消')+btn('confirm-restore',replace?'替换并恢复':r.conflicts.length?'合并无冲突数据':'确认合并恢复','check',replace?'danger':'primary'));
  }
  async function exportExcel(){if(busy)return;busy=true;toast('正在生成 Excel…');try{const scope=M.clone(modal.scope),result=await auxiliary('export-backup',{state,scope});downloadLink(window.FileJobs.auxiliaryDownloadUrl(result.jobId),'地垫工作台备份-'+M.today()+'.xlsx');if(modal?.type==='export')close(true);toast('Excel 已生成');}catch(error){fail(error.message);}finally{busy=false;}}
  function saveModal(){const before=state,serial=commitSerial;state=M.clone(state);try{return saveModalCandidate();}finally{if(commitSerial===serial)state=before;}}
  function saveModalCandidate(){const d=modal.draft,p=current(),kind=modal.type;
    if(kind==='reusable'){commit(R.save(state,modal.kind,{...M.clone(d),id:modal.id||M.uid('rule')}));close(true);return;}if(kind==='save-rule-copy'){const next=modal.kind==='sizeSchemes'&&!modal.sourceId?R.saveSizeScheme(state,p.id,d.name):R.copy(state,modal.kind,modal.sourceId,d.name);commit(next);close(true);return;}if(kind==='sku-settings'){const next=M.clone(state),plan=next.plans.find(x=>x.id===p.id),i=plan.items.find(x=>x.id===modal.id);const oldProduct=i.productId,oldSku=i.skuId;for(const k of ['materialId','materialRuleId','productId','skuId','weight'])i[k]=typeof d[k]==='string'?d[k].trim():d[k];if(!i.materialId){delete i.materialId;delete i.materialRuleId;}else if(!i.materialRuleId)return fail('请选择这个材料的厚度','[data-field="materialRuleId"]');if(i.productId!==oldProduct||i.skuId!==oldSku)S.markEdited(plan,'skuId');commit(next);close(true);return;}if(kind==='display'){state.prefs.ids=[...modal.ids];commit();close(true);return;}
    if(kind==='sku-display'){state.prefs.skuColumns=[...modal.ids];commit();close(true);return;}
    if(kind==='add-skus'){if(!modal.ids.length&&d.salesW===''&&d.salesH==='')return fail('请选择尺寸或填写自定义尺寸');const custom=d.salesW!==''||d.salesH!==''?{width:d.salesW,height:d.salesH}:undefined;try{commit(R.addSizes(state,p.id,modal.ids,custom));close(true);}catch(error){fail(error.message);}return;}
    if(kind==='shop'||kind==='plan'||kind==='material'||kind==='shipping'){if(!d.name.trim())return fail('请填写名称','[data-field="name"]');d.name=d.name.trim();}
    if(kind==='shop'){
      if(state.shops.some(x=>x.name===d.name&&x.id!==modal.id))return fail('这个店铺名称已存在','[data-field="name"]');
      if(modal.id)state.shops.find(x=>x.id===modal.id).name=d.name;else{const s={id:M.uid('shop'),name:d.name,deleted:false};state.shops.push(s);state.activeShop=s.id;state.active='';setView('plans');}
    }
    if(kind==='plan'){
      if(state.plans.some(x=>!x.deleted&&x.shopId===state.activeShop&&x.name===d.name&&x.id!==modal.id))return fail('当前店铺已有同名计划','[data-field="name"]');
      if(modal.id)state.plans.find(x=>x.id===modal.id).name=d.name;else{const created={...M.newPlan(state,state.activeShop,d.name),materialId:d.materialId,shippingId:d.shippingId};state.plans.push(created);state.active=created.id;setView('plan');tab='sku';}
    }
    if(kind==='material'){
      if(state.materials.some(m=>m.id!==modal.id&&M.materialNameKey(m.name)===M.materialNameKey(d.name)))return fail('已有同名材料，请使用不同名称；空格、全半角和大小写不区分。','[data-field="name"]');
      const rules=(d.weightRules||[]).map((r,i)=>({...r,id:r.id||M.uid('rule'),thickness:r.thickness===''||r.thickness===undefined?'':Number(r.thickness),variant:r.variant||'',coefficient:r.coefficient===''?'':Number(r.coefficient),costPerSqm:r.costPerSqm===''?'':Number(r.costPerSqm),default:!!r.default,deleted:!!r.deleted}));
      if(!rules.length)return fail('请至少添加一条厚度规则');
      for(const [i,r] of rules.entries()){
        if(r.thickness!==''&&(!M.positive(r.thickness)||r.thickness>10000))return fail('厚度需为大于 0、不超过 10000 mm 的数字；不限厚度请留空。',`[data-material-rule="${i}"][data-rule-key="thickness"]`);
        for(const key of ['coefficient','costPerSqm'])if(!M.nonnegative(r[key]))return fail('请填写有效的非负重量系数和规则成本。',`[data-material-rule="${i}"][data-rule-key="${key}"]`);
      }
      if(new Set(rules.filter(r=>!r.deleted).map(r=>`${r.thickness}|${r.variant}`)).size!==rules.filter(r=>!r.deleted).length)return fail('同一材料的厚度与变体组合不能重复');
      if(!rules.some(r=>!r.deleted&&r.default)&&rules.some(r=>!r.deleted))rules.find(r=>!r.deleted).default=true;
      let m=state.materials.find(x=>x.id===modal.id);if(!m){const price=rules.find(r=>r.default)?.costPerSqm??rules[0].costPerSqm;m={id:M.uid('material'),name:d.name,price,description:'',active:true,deleted:false,history:[]};state.materials.push(m);}
      const current=rules.find(r=>!r.deleted&&r.default)||rules.find(r=>!r.deleted);if(!current)return fail('至少保留一条可用厚度规则');
      if(m.price!==current.costPerSqm||!m.history.length||d.note?.trim())m.history.push({id:M.uid('quote'),date:M.today(),price:current.costPerSqm,note:d.note||'默认厚度规则'});
      Object.assign(m,{name:d.name,price:current.costPerSqm,weightRules:rules});state=R.save(state,'materials',m);
    }
    if(kind==='size'){
      const value={id:modal.id||M.uid('size'),name:d.name.trim(),salesW:d.salesW,salesH:d.salesH,irregular:d.irregular,productionW:d.irregular?d.productionW:'',productionH:d.irregular?d.productionH:'',active:d.active??true,deleted:d.deleted??false,needsReview:false};
      if(!M.validSize(value)){const key=['salesW','salesH',...(value.irregular?['productionW','productionH']:[])].find(key=>!M.positive(value[key])||value[key]>10000)||'name';return fail('请填写大于 0、不超过 10000 cm 的销售尺寸；异形还需填写生产尺寸',`[data-field="${key}"]`);}
      const old=state.sizes.findIndex(x=>x.id===modal.id);if(old>=0)state.sizes[old]=value;else state.sizes.push(value);
      if(modal.parent&&!modal.parent.ids.includes(value.id))modal.parent.ids.push(value.id);
    }
    if(kind==='shipping'){
      const t={...M.clone(d),id:modal.id||M.uid('shipping'),active:d.active??true,deleted:d.deleted??false};
      const existing=state.shippingTemplates.find(x=>x.id===modal.id);
      if(existing?.type==='regional')Object.assign(t,{type:'regional',provider:existing.provider,rates:M.clone(existing.rates),ignoreWaybillFee:existing.ignoreWaybillFee});
      if(!M.validTemplate(t)){
        let selector='[data-field="name"]';
        if(t.type==='fixed')selector='[data-field="fee"]';
        if(t.type==='step'){const key=['firstWeight','firstFee','stepWeight','stepFee','maxWeight'].find(key=>key.endsWith('Fee')?!M.nonnegative(t[key]):!M.positive(t[key])||t[key]>1000||(key==='maxWeight'&&t[key]<t.firstWeight));selector=`[data-field="${key||'maxWeight'}"]`;}
        if(t.type==='tiers'){const index=t.tiers.findIndex((r,i)=>!M.positive(r.upTo)||r.upTo>1000||!M.nonnegative(r.fee)||i>0&&r.upTo<=t.tiers[i-1].upTo),key=!M.nonnegative(t.tiers[index]?.fee)?'fee':'upTo';selector=`[data-tier="${Math.max(0,index)}"][data-key="${key}"]`;}
        return fail('请检查计费规则：费用不能为负，重量需大于 0，分档上限需递增，最高重量不能低于首重',selector);
      }
      const i=state.shippingTemplates.findIndex(x=>x.id===modal.id);if(i>=0)state.shippingTemplates[i]=t;else state.shippingTemplates.push(t);
    }
    if(kind==='weight'){const template=state.shippingTemplates.find(t=>t.id===p.shippingId);if(d.weight!==''&&(!M.positive(d.weight)||d.weight>1000||M.shippingCost(template,d.weight).error))return fail('请填写模板支持范围内大于 0 的含包装重量，或留空恢复自动计算。','[data-field="weight"]');p.items.find(i=>(i.id||i.sizeId)===modal.id).weight=d.weight;}
    commit();close(true);toast('已保存');
  }
  const sizeDraft=()=>({name:'',salesW:'',salesH:'',irregular:shape==='irregular',productionW:'',productionH:'',active:true});
  const shippingDraft=()=>({name:'',type:'fixed',fee:1.35,firstWeight:1,firstFee:2,stepWeight:.5,stepFee:.8,maxWeight:10,tiers:[{upTo:.5,fee:1.35},{upTo:1,fee:1.8}],active:true});
  document.addEventListener('click',async event=>{
    const b=event.target.closest('[data-action]');if(!b||b.disabled||operationPending)return;event.preventDefault();const a=b.dataset.action,id=b.dataset.id,p=current();
    try{
      if(a==='boot-retry')return initialize();
      if(a==='recovery-points')return await recoveryPoints();
      if(a==='download-checkpoint'){await downloadState(await request('/api/backups/'+id),'地垫工作台-恢复点-'+id);return;}
      if(a==='download-draft'){await downloadState(pendingRecovery.state,'地垫工作台-未保存草稿-'+M.today());return;}
      if(a==='keep-database'){localStorage.removeItem(pendingRecovery.key);pendingRecovery=null;close();return;}
      if(a==='recover-draft'){
        if(!M.validateBackup(pendingRecovery.state))return fail('草稿未通过检查，请先导出留存。');
        const source=pendingRecovery;const saved=await persistModal(source.state,'restore','草稿已恢复并保存到电脑');if(saved){localStorage.removeItem(source.key);pendingRecovery=null;}return;
      }
      if(a==='close')return close();
      if(a==='discard-inline-drafts'){inlineDrafts={};rememberInline();render();return;}if(a==='save-modal')return saveModal();if(a==='discard-form-draft'){await formDrafts?.remove('modal');close(true);return;}if(a==='recover-form-draft'){const value=M.clone(modal.stored.value);close(true);if(!['shop','plan','material','size','shipping','add-skus','entry','sku-settings','reusable','save-rule-copy','display','sku-display','export'].includes(value.type))return toast('草稿类型不可恢复');if(value.id&&['sku-settings','weight'].includes(value.type)&&!p?.items.some(x=>x.id===value.id))return toast('原 SKU 已变更，请在当前计划重新填写');open(value.type,value);return;}
      if(a==='check-updates')return await checkUpdates();
      if(a==='download-update')return await downloadUpdate();
      if(a==='quit-and-install')return await quitAndInstall();
      if(a==='export')return startExport();
      if(a==='product-view'){setView('product');setupFileUI();render();await productUI?.activate(fileContext());await restorePendingProductSession();return;}if(a==='sales-import'){setupFileUI();if(!salesUI)return toast('销售导入模块尚未加载，请重新打开工作台');salesUI.open();return;}
      if(a==='product-export')return exportProduct();
      if(a==='product-retry')return analyzeProductFiles();
      if(a==='product-page'){if(b.dataset.kind==='group')productGroupPage=Number(b.dataset.page);else productRowPage=Number(b.dataset.page);render();return;}
      if(a==='product-add-weight-rule'||a==='product-delete-weight-rule')return;
      if(a==='product-review-row'){
        const row=Number(b.dataset.row), patch={};document.querySelectorAll(`[data-product-edit][data-row="${row}"]`).forEach(el=>patch[el.dataset.productEdit]=el.value);
        productResult=P.applyReviews(productResult,{[row]:patch});delete productReviews[row];render();markProductErrors()?.focus();return;
      }
      if(a==='product-review-product'){
        const row=Number(b.dataset.row), source=productResult?.rows?.find(item=>item.rowNumber===row), input=document.querySelector(`[data-product-group-edit="material"][data-product-row="${row}"]`);
        const productId=source?.values?.[17], material=input?.value?.trim();
        if(!productId)return toast('该商品缺少平台商品 ID，无法按商品批量复核');
        if(!material)return toast('请先填写该商品的材质');
        productResult=P.applyProductReview(productResult,productId,{material});render();return;
      }
      if(a==='product-batch-review'){
        const reviews=M.clone(productReviews);document.querySelectorAll('[data-product-edit]').forEach(el=>{const row=Number(el.dataset.row);reviews[row]??={};reviews[row][el.dataset.productEdit]=el.value;});
        const before=productResult?.exceptions?.length||0;productResult=P.applyBatchReviews(productResult,reviews);productReviews={};const after=productResult?.exceptions?.length||0;render();toast(after<before?'已按平台商品 ID 批量应用材质复核':'未找到可批量应用的同商品材质，请检查填写内容或组内冲突');return;
      }
      if(a==='trend-demo')return open('trend-demo');
      if(a==='confirm-export')return exportExcel();
      if(a==='export-chart')return startExport({...chartFilters,shopId:state.activeShop,planId:p.id});
      if(a==='scope-all'||a==='scope-none'){modal.scope.shopIds=a==='scope-all'?state.shops.map(s=>s.id):[];modal.scope.planIds=a==='scope-all'?state.plans.map(p=>p.id):[];paintModal();return;}
      if(a==='scope-dates-all'){modal.scope.from='';modal.scope.to='';paintModal();return;}
      if(a==='chart-recent'){chartFilters.from=H.shift(M.today(),-29);chartFilters.to=M.today();render();return;}
      if(a==='export-ledger'){if(filters.from&&filters.to&&filters.from>filters.to)return toast('开始日期不能晚于结束日期');return startExport(view==='history'?filters:{...filters,shopId:state.activeShop,planId:p?.id});}
      if(a==='download-raw'){downloadLink('/api/recovery/current/raw','workspace-original.json');return;}if(a==='download-checkpoint-raw'){downloadLink('/api/backups/'+encodeURIComponent(id)+'/raw','recovery-original.json');return;}
      if(a==='import'){document.querySelector('#backup-input').click();return;}
      if(a==='retry-save'){if(await queue.flush())toast('已保存到电脑');return;}
      if(a==='reload'){if(saveError){confirmAction('重新载入数据库版本？','本窗口尚未保存的输入会被放弃。请先导出 Excel，再重新载入。',()=>location.reload(),'重新载入');}else location.reload();return;}
      if(a==='plan-view'){setView('plan');render();return;}
      if(a==='plans-view'){setView('plans');render();return;}
      if(a==='shops'){setView('shops');render();return;}
      if(a==='ledger-view'){setView('history');render();return;}
      if(a==='data-view'){setView('data');render();return;}
      if(a==='library-view'||a==='shipping-library'){setView('library');if(a==='shipping-library')libraryTab='shipping';render();return;}
      if(a==='library-tab'){libraryTab=b.dataset.tab;render();return;}
      if(a==='toggle-inactive-materials'){showInactiveMaterials=!showInactiveMaterials;render();return;}
      if(a==='shape-filter'){shape=id;render();return;}
      if(a==='tab'){tab=b.dataset.tab;render();return;}if(a==='sku-settings')return open('sku-settings',{id,draft:M.clone(p.items.find(x=>x.id===id))});
      if(a==='new-reusable'||a==='edit-reusable'){const old=state[libraryTab]?.find(x=>x.id===id),draft=old?M.clone(old):libraryTab==='pricingStrategies'?{name:'',type:'uniform',margin:30,tiers:[10,20,30],fallback:30,baseArea:.5,baseMargin:10,stepArea:.1,stepPoints:1,cap:60}:libraryTab==='sizeSchemes'?{name:'',sizeIds:[]}:{name:'',steps:[{type:'discount',discount:9}]};return open('reusable',{kind:libraryTab,id,draft});}
      if(a==='copy-reusable')return open('save-rule-copy',{kind:libraryTab,sourceId:id,draft:{name:state[libraryTab].find(x=>x.id===id).name+' · 副本'}});
      if(a==='save-size-scheme')return open('save-rule-copy',{kind:'sizeSchemes',draft:{name:''}});
      if(a==='save-selected-strategy'||a==='save-selected-promotion'){const kind=a==='save-selected-strategy'?'pricingStrategies':'promotionSchemes',sourceId=a==='save-selected-strategy'?p.strategyId:p.promotionSchemeId;return open('save-rule-copy',{kind,sourceId,draft:{name:''}});}
      if(a==='delete-rule')return confirmAction('删除这份规则？','删除后不再出现在新选择中；已有引用和历史账目保留，可在规则库恢复。',()=>commit(R.remove(state,b.dataset.kind,id)),'删除',true);
      if(a==='restore-rule'){commit(R.restore(state,b.dataset.kind,id));return;}
      if(a==='listing-calculator')return open('listing-calculator');
      if(a==='add-rank-tier'){modal.draft.tiers.push(modal.draft.fallback);paintModal();return;}if(a==='remove-rank-tier'){if(modal.draft.tiers.length>1)modal.draft.tiers.pop();paintModal();return;}
      if(a==='activity-add'){modal.draft.steps.push({type:'discount',discount:9});paintModal();return;}if(['activity-up','activity-down','activity-remove'].includes(a)){const i=Number(b.dataset.index),steps=modal.draft.steps;if(a==='activity-remove')steps.splice(i,1);else{const j=i+(a==='activity-up'?-1:1);if(j>=0&&j<steps.length)[steps[i],steps[j]]=[steps[j],steps[i]];}paintModal();return;}
      if(a==='export-listing'){await exportListing();return;}
if(a==='sku-options'){skuOptionsOpen=!skuOptionsOpen;render();return;}if(a==='restore-price'){commit(R.resumePrice(state,p.id,id));return;}
      if(a==='select-plan'){state.active=id;state.activeShop=state.plans.find(x=>x.id===id).shopId;setView('plan');tab='sku';commit();return;}
      if(a==='select-shop'){state.activeShop=id;normalize();setView('plan');commit();return;}
      if(a==='new-shop'||a==='rename-shop')return open('shop',{id,draft:{name:id?shopName(id):''}});
      if(a==='new-plan')return open('plan',{draft:{...M.newPlan(state,state.activeShop,'')}});
      if(a==='rename-plan')return open('plan',{id:p.id,draft:{name:p.name}});
      if(a==='copy-plan'){const copied=M.clone(p);copied.id=M.uid('plan');copied.name=p.name+' · 副本';copied.salesSource=null;copied.items=copied.items.map(i=>({...i,id:M.uid('item'),sales:null}));state.plans.push(copied);state.active=copied.id;commit();toast('已复制试算参数，历史账目不复制');return;}
      if(a==='delete-plan'){const target=state.plans.find(x=>x.id===id);return confirmAction('删除计划？',`删除“${target.name}”后，它会移出使用中列表。历史账目保留，仍可在总账筛选。`,()=>{target.deleted=true;commit();},'删除计划',true);}
      if(a==='restore-plan'){state.plans.find(x=>x.id===id).deleted=false;commit();return;}
      if(a==='new-material'||a==='material'||a==='edit-current-material'){const m=state.materials.find(x=>x.id===(a==='edit-current-material'?p.materialId:id));return open('material',{id:m?.id,draft:{name:m?.name||'',description:m?.description||'',price:m?.price??'',weightRules:M.clone(m?.weightRules||[]),date:M.today(),note:''}});}
      if(a==='add-material-rule'){modal.draft.weightRules=[...(modal.draft.weightRules||[]),{id:M.uid('rule'),thickness:'',variant:'',coefficient:'',costPerSqm:'',default:false,deleted:false}];paintModal();return;}
      if(a==='remove-material-rule'){const rule=modal.draft.weightRules[Number(b.dataset.index)];rule.deleted=true;rule.default=false;paintModal();return;}
      if(a==='toggle-material'){const m=state.materials.find(x=>x.id===id);m.active=!m.active;commit();return;}
      if(a==='delete-material')return confirmAction('停用这份材料？','材料会从新计划选择中移除，现有计划、账目和历史快照继续保留。之后可通过“启用”恢复。',()=>{const m=state.materials.find(x=>x.id===id);if(m)m.active=false;commit();},'停用材料',true);
      if(a==='approve-material'){p.needsMaterialReview=false;commit();return;}
      if(a==='new-size'||a==='edit-size')return open('size',{id,draft:id?M.clone(state.sizes.find(x=>x.id===id)):sizeDraft()});
      if(a==='toggle-size'){const s=state.sizes.find(x=>x.id===id);s.active=!s.active;commit();return;}
      if(a==='nested-size'){const parent=modal;return open('size',{draft:sizeDraft(),parent});}
      if(a==='add-skus')return open('add-skus',{ids:[],draft:{salesW:'',salesH:''}});
      if(a==='remove-sku')return confirmAction('移除这个商品规格？','将移除本计划中的售价和占比；公共尺寸及历史账目保留。',()=>{p.items=p.items.filter(i=>(i.id||i.sizeId)!==id);commit();},'移除');
      if(a==='weight')return open('weight',{id,draft:{weight:p.items.find(i=>(i.id||i.sizeId)===id).weight}});
      if(a==='normalize-share'){const total=p.items.reduce((a,i)=>a+Number(i.share),0);if(!total)return toast('请先填写至少一个订单占比');let allocated=0;p.items.forEach((i,j)=>{i.share=j===p.items.length-1?Number((100-allocated).toFixed(4)):Number((Number(i.share)/total*100).toFixed(4));allocated+=i.share;});commit();return;}
      if(a==='new-shipping'||a==='shipping'){const t=state.shippingTemplates.find(x=>x.id===id);return open('shipping',{id,draft:{...shippingDraft(),...(t?M.clone(t):{})}});}
      if(a==='toggle-shipping'){const t=state.shippingTemplates.find(x=>x.id===id);t.active=!t.active;commit();return;}
      if(a==='delete-shipping')return confirmAction('删除未使用的模板？','历史账目保存的运费规则不会改变。',()=>{if(state.plans.some(p=>p.shippingId===id)||state.shippingTemplates.length<2)return toast('模板正在使用，不能删除');state.shippingTemplates=state.shippingTemplates.filter(x=>x.id!==id);commit();},'删除模板',true);
      if(a==='add-tier'){const last=modal.draft.tiers.at(-1);modal.draft.tiers.push({upTo:Number(last.upTo)+1,fee:last.fee});paintModal();return;}
      if(a==='remove-tier'){modal.draft.tiers.splice(Number(b.dataset.index),1);paintModal();return;}
      if(a==='display')return open('display',{ids:[...state.prefs.ids]});
      if(a==='sku-display')return open('sku-display',{ids:M.skuColumns(state)});
      if(a==='sku-defaults'){modal.ids=[...M.defaultSkuColumns];paintModal();return;}
      if(a==='sku-up'||a==='sku-down'){const i=modal.ids.indexOf(id),j=i+(a==='sku-up'?-1:1);if(i>=0&&j>=0&&j<modal.ids.length)[modal.ids[i],modal.ids[j]]=[modal.ids[j],modal.ids[i]];paintModal();return;}
      if(a==='show-sku-inputs'){state.prefs.skuColumns=[...new Set([...M.skuColumns(state),'price','share','weight'])];commit();return;}
      if(a==='metric-up'||a==='metric-down'){const i=modal.ids.indexOf(id),j=i+(a==='metric-up'?-1:1);[modal.ids[i],modal.ids[j]]=[modal.ids[j],modal.ids[i]];paintModal();return;}
      if(a==='entry')return startEntry();
      if(a==='record-detail')return open('record-detail',{id});
      if(a==='correct-record')return startEntry(state.records.find(h=>h.id===id));
      if(a==='void-record')return confirmAction('作废这笔账目？','原记录保留，但不再计入合计。需要修正数值时，建议使用“更正这笔账”。',()=>{const h=state.records.find(h=>h.id===id);h.status='void';h.voidedAt=new Date().toISOString();commit();},'确认作废',true);
      if(a==='confirm-record'){
        if(!modal||modal.type!=='entry')return;
        if(!modal.committed&&!validateEntry())return;
        const candidate=M.clone(state);if(!modal.committed)M.confirmRecord(candidate,modal);
        if(!M.validateBackup(candidate))return fail('入账数据未通过检查，请核对费用和规格');
        await persistModal(candidate,'save','已确认入账，历史成本已锁定');return;
      }
      if(a==='clear-filters'){filters={shopId:'',planId:'',from:'',to:'',includeOld:false};render();return;}
      if(a==='confirm-action'){const run=modal.run;close(true);await run();return;}
      if(a==='confirm-restore'){
        if(!modal||modal.type!=='restore')return;
        const replacing=!booted||modal.restoreMode==='replace'&&!modal.data.exportScope,merged=modal.committed||replacing?null:T.merge(state,modal.data,{restorePlans:!!modal.restorePlans}),next=modal.committed?state:replacing?M.clone(modal.data):merged.state;
        if(!M.validateBackup(next))return fail('恢复数据校验未通过');delete next.exportScope;
        if(replacing){await restoreWorkspace(next);return;}
        const skipped=merged?.report.conflicts.length||0;setView('plan');tab='sku';
        await persistModal(next,'save',skipped?`合并完成；${skipped} 个冲突计划保留本机版本`:'合并完成，重复账目不会累计');return;
      }
    }catch(error){fail(safeError(error,a==='confirm-record'?'入账失败，请核对日期、广告消耗和费用；同日记录请从总账更正。':a==='confirm-restore'?'恢复失败，请使用完整、未修改的备份重试。':'操作未完成，请核对输入后重试。'));}
  });
  function pruneInlineDrafts(){let changed=false;for(const key of Object.keys(inlineDrafts)){try{const [planId,kind,itemId]=JSON.parse(key),plan=state.plans.find(p=>p.id===planId&&!p.deleted);if(!plan||kind==='item'&&!plan.items.some(i=>i.id===itemId)){delete inlineDrafts[key];changed=true;}}catch{delete inlineDrafts[key];changed=true;}}if(changed)rememberInline();}
  function inlineKey(el){const p=current();if(!p)return '';if(el.dataset.item)return JSON.stringify([p.id,'item',el.dataset.item,el.dataset.key]);if(el.dataset.param)return JSON.stringify([p.id,'param',el.dataset.param]);if(el.dataset.paramRate)return JSON.stringify([p.id,'rate',el.dataset.paramRate]);return '';}
  function rememberInline(){if(formDrafts)formDrafts.save('inline',inlineDrafts,{baseRevision:queue?.revision}).catch(error=>toast(error.message));}
  function applyInlineDrafts(){for(const el of app.querySelectorAll('input[data-item],input[data-param],input[data-param-rate]')){const draft=inlineDrafts[inlineKey(el)];if(draft){el.value=draft.value;el.setAttribute('aria-invalid','true');el.title=draft.error;}}}
  function acceptInput(el,mutate){const next=M.clone(state),key=inlineKey(el);try{mutate(next,next.plans.find(x=>x.id===current()?.id));if(!M.validateBackup(next))throw Error('请输入有效数值');state=next;commitSerial++;if(key)delete inlineDrafts[key];rememberInline();el.removeAttribute?.('aria-invalid');save();refreshCalculation();paintSaveStatus();return true;}catch(error){if(key)inlineDrafts[key]={value:el.value,error:error.message};rememberInline();el.setAttribute?.('aria-invalid','true');el.title=error.message;paintSaveStatus();return false;}}
  function readInput(el){if(el.type==='checkbox')return el.checked;if(el.type==='number'||el.type==='range'){if(el.value==='')return '';const value=Number(el.value);if(!M.number(value)){el.value='';toast('数值超出支持范围，请重新填写');return '';}return el.dataset.unit==='g'?M.fromGrams(value):value;}return el.value;}
  function inspectTrend(event){const el=event.target.closest('[data-trend-index]');if(!el)return;const detail=document.querySelector('#trend-detail');if(detail)detail.innerHTML=trendDetail(Number(el.dataset.trendIndex));const guide=document.querySelector('#trend-guide');if(guide){guide.setAttribute('x1',el.dataset.x);guide.setAttribute('x2',el.dataset.x);}}
  document.addEventListener('pointerover',inspectTrend);
  document.addEventListener('focusin',inspectTrend);
  document.addEventListener('input',event=>{
    const el=event.target,p=current();if(operationPending||modal?.committed&&dialog.contains?.(el))return;const value=readInput(el);
    if(el.matches('[data-rank-tier]'))modal.draft.tiers[Number(el.dataset.rankTier)]=value;if(el.matches('[data-activity-value]')){const step=modal.draft.steps[Number(el.dataset.activityValue)];step[step.type==='discount'?'discount':'amount']=value;}if(el.matches('[data-product-edit]')){productReviews[el.dataset.row]??={};productReviews[el.dataset.row][el.dataset.productEdit]=el.value;}
    if(el.hasAttribute?.('aria-invalid')){el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');}
    if(el.matches('[data-param]'))acceptInput(el,(_,plan)=>plan.params[el.dataset.param]=value);
    if(el.matches('[data-param-rate]'))acceptInput(el,(_,plan)=>plan.params.refundRates={...plan.params.refundRates,[el.dataset.paramRate]:value});
    if(el.matches('[data-param-scope]')){p.params.otherFeeScope=value;save();refreshCalculation();}
    if(el.matches('[data-packaging-weight]')){p.packagingWeight=value;save();refreshCalculation();}
    if(el.matches('[data-item]')){acceptInput(el,(next,plan)=>{const item=plan.items.find(i=>i.id===el.dataset.item);if(el.dataset.key==='price'){if(value!==''&&(!M.nonnegative(value)||!window.PricingRules.decimal(value,2)))throw Error('售价需为非负金额，最多两位小数');item.priceMode='manual';}item[el.dataset.key]=value;S.markEdited(plan,el.dataset.key);});}
    if(el.matches('[data-note]')){p.note=value;save();}
    if(el.matches('[data-search]')){query=value;document.querySelector('#size-list').innerHTML=sizeList();window.lucide?.createIcons();}
    if(modal&&el.matches('[data-field]')&&!['checkbox','select-one'].includes(el.type)){
      if(modal.type==='entry')modal[el.dataset.field]=value;else modal.draft[el.dataset.field]=value;
      if(modal.type==='size')document.querySelector('#area-preview').textContent=n(M.productionArea({...modal.draft,needsReview:false}),4)+' ㎡';
      if(modal.type==='weight'){const t=state.shippingTemplates.find(t=>t.id===p.shippingId),r=M.shippingCost(t,modal.draft.weight);document.querySelector('#weight-preview').textContent=r.error||'预计运费：'+money(r.value);}
    }
    if(modal&&el.matches('[data-material-rule]')){const index=Number(el.dataset.materialRule),key=el.dataset.ruleKey;if(modal.draft?.weightRules?.[index]){modal.draft.weightRules[index][key]=key==='thickness'?el.value:value;if(key==='default'&&value)modal.draft.weightRules.forEach((r,i)=>{if(i!==index)r.default=false;});}}
    if(modal&&el.matches('[data-tier]'))modal.draft.tiers[Number(el.dataset.tier)][el.dataset.key]=value;
    if(modal&&el.matches('[data-entry-shipping-key]')){modal.frame.shippingTemplates[0][el.dataset.entryShippingKey]=value;document.querySelector('#entry-shipping-description').textContent=ruleText(modal.frame.shippingTemplates[0]);refreshEntry();}
    if(modal&&el.matches('[data-entry-tier]')){modal.frame.shippingTemplates[0].tiers[Number(el.dataset.entryTier)][el.dataset.key]=value;document.querySelector('#entry-shipping-description').textContent=ruleText(modal.frame.shippingTemplates[0]);refreshEntry();}
    if(modal&&el.matches('[data-entry-param]')){modal.frame.plan.params[el.dataset.entryParam]=value;refreshEntry();}
    if(modal&&el.matches('[data-entry-refund-rate]')){modal.frame.plan.params.refundRates={...(modal.frame.plan.params.refundRates||{}),[el.dataset.entryRefundRate]:value};refreshEntry();}
    if(modal&&el.matches('[data-entry-material]')){const m=modal.frame.materials.find(x=>x.id===el.dataset.entryMaterial),r=m?.weightRules.find(x=>x.id===el.dataset.entryRule);if(r){r.costPerSqm=value;if(m.id===modal.frame.plan.materialId&&r.id===modal.frame.plan.materialRuleId)m.price=value;refreshEntry();}}
    if(modal&&el.matches('[data-entry-price]')){M.setFrameMaterialPrice(modal.frame,value);const quoteSelect=document.querySelector('[data-quote]');if(quoteSelect)quoteSelect.value='';refreshEntry();}
    if(modal&&el.matches('[data-entry-item]')){modal.frame.plan.items.find(i=>(i.id||i.sizeId)===el.dataset.entryItem)[el.dataset.key]=value;refreshEntry();}
  });
  document.addEventListener('change',event=>{
    const el=event.target,p=current();if(operationPending||modal?.committed&&dialog.contains?.(el))return;const value=readInput(el);
    if(el.matches('[data-show-deleted]')){showDeletedRules=value;render();return;}if(el.matches('[data-plan-strategy]')){try{commit(R.setStrategy(state,p.id,value));}catch(error){toast(error.message);render();}return;}if(el.matches('[data-size-scheme]')&&value){try{const r=R.applySizeScheme(state,p.id,value);commit(r.state);if(r.skipped)toast('已跳过 '+r.skipped+' 个不可用尺寸');}catch(error){toast(error.message);render();}return;}if(el.matches('[data-promotion-scheme]')){const next=M.clone(state);next.plans.find(x=>x.id===p.id).promotionSchemeId=value;commit(next);paintModal();return;}if(el.matches('[data-rule-size]')){modal.draft.sizeIds=value?[...new Set([...modal.draft.sizeIds,el.dataset.ruleSize])]:modal.draft.sizeIds.filter(x=>x!==el.dataset.ruleSize);return;}if(el.matches('[data-activity-type]')){modal.draft.steps[Number(el.dataset.activityType)]=value==='discount'?{type:'discount',discount:9}:{type:'reduction',amount:5};paintModal();return;}if(modal?.type==='sku-settings'&&el.matches('[data-field="materialId"]')){modal.draft.materialId=value;modal.draft.materialRuleId='';paintModal();return;}
    if(el.id==='active-shop'){state.activeShop=value;normalize();setView('plan');commit();}if(el.id==='active-plan'){state.active=value;setView('plan');tab='sku';commit();}
    if(el.matches('[data-product-file]')){const file=el.files?.[0];if(file)analyzeProductFiles(file);return;}
    if(el.matches('[data-plan-material]')){if(!value){toast('请选择材料，原选择已保留');render();return;}p.materialId=value;p.materialRuleId=M.materialRule(state.materials.find(m=>m.id===value),{} )?.id;save();render();}
    if(el.matches('[data-plan-material-rule]')){if(!value){toast('请选择有效厚度，原选择已保留');render();return;}p.materialRuleId=value;save();refreshCalculation();render();}
    if(el.matches('[data-plan-shipping]')){if(!value){toast('请选择运费模板，原选择已保留');render();return;}p.shippingId=value;save();render();}
    if(el.matches('[data-param-scope]')){p.params.otherFeeScope=value;save();refreshCalculation();}
    if(el.matches('[data-filter]')){filters[el.dataset.filter]=value;if(el.dataset.filter==='shopId')filters.planId='';render();}
    if(el.matches('[data-chart]')){chartFilters[el.dataset.chart]=value;render();}
    if(el.matches('[data-ledger-unit]')){ledgerUnit=value;render();}
    if(modal?.type==='export'&&el.matches('[data-scope]')){modal.scope[el.dataset.scope]=value;paintModal();}
    if(modal?.type==='export'&&el.matches('[data-scope-shop]')){const id=el.dataset.scopeShop,plans=state.plans.filter(p=>p.shopId===id).map(p=>p.id);modal.scope.shopIds=value?[...new Set([...modal.scope.shopIds,id])]:modal.scope.shopIds.filter(x=>x!==id);modal.scope.planIds=value?[...new Set([...modal.scope.planIds,...plans])]:modal.scope.planIds.filter(x=>!plans.includes(x));paintModal();}
    if(modal?.type==='export'&&el.matches('[data-scope-plan]')){const id=el.dataset.scopePlan;modal.scope.planIds=value?[...new Set([...modal.scope.planIds,id])]:modal.scope.planIds.filter(x=>x!==id);paintModal();}
    if(modal?.type==='restore'&&el.matches('[data-restore-mode]')){modal.restoreMode=value;paintModal();}
    if(modal?.type==='restore'&&el.matches('[data-restore-plans]')){modal.restorePlans=value;modal.merge=null;paintModal();}
    if(el.matches('[data-material-rule]')){const index=Number(el.dataset.materialRule),key=el.dataset.ruleKey;if(modal?.draft?.weightRules?.[index]){modal.draft.weightRules[index][key]=key==='coefficient'||key==='costPerSqm'?(el.value===''?'':Number(el.value)):key==='default'?value:el.value;if(key==='default'&&value)modal.draft.weightRules.forEach((r,i)=>{if(i!==index)r.default=false;});}return;}
    if(modal&&el.matches('[data-field]')&&['checkbox','select-one'].includes(el.type)){modal.draft[el.dataset.field]=value;paintModal();}
    if(modal&&el.matches('[data-select-size]')){if(value)modal.ids.push(el.dataset.selectSize);else modal.ids=modal.ids.filter(id=>id!==el.dataset.selectSize);}
    if(modal&&el.matches('[data-metric-choice]')){const id=el.dataset.metricChoice;if(value){if(modal.ids.length===4){el.checked=false;return toast('最多显示 4 项');}modal.ids.push(id);}else modal.ids=modal.ids.filter(x=>x!==id);paintModal();}
    if(modal?.type==='sku-display'&&el.matches('[data-sku-column]')){const id=el.dataset.skuColumn;modal.ids=value?[...new Set([...modal.ids,id])]:modal.ids.filter(x=>x!==id);paintModal();}
    if(modal&&el.matches('[data-quote]')&&value!==''){M.setFrameMaterialPrice(modal.frame,Number(value));document.querySelector('[data-entry-price]').value=value;refreshEntry();}
    if(modal&&el.matches('[data-entry-shipping]')&&value!=='frozen'){const t=M.clone(state.shippingTemplates.find(t=>t.id===value));modal.frame.shippingTemplates=[t];modal.frame.plan.shippingId=t.id;paintModal();}
    if(modal?.type==='entry'&&el.matches('[data-entry-param]')){modal.frame.plan.params[el.dataset.entryParam]=value;refreshEntry();}
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.querySelector('#backup-input').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>15*1024*1024)return toast('文件超过 15 MB，请按店铺或日期分批导出后导入');
    toast('正在检查备份…');try{busy=true;const job=await window.FileJobs.inspectBackup(file),checked=await window.FileJobs.waitForJob(job.jobId),data=checked.result.state;if(M.duplicateMaterialName(data.materials||[]))return toast('备份包含同名材料，请在来源工作台为材料设置不同名称后重新导出。');if(!M.validateBackup(data))throw Error('备份未通过检查，当前数据保留');open('restore',{data,restoreMode:!booted?'replace':'merge'});}catch(error){toast(safeError(error,'文件无法恢复，请选择未修改的完整备份，并检查材料是否有同名项。'));}finally{busy=false;}
  });
  document.addEventListener('input',event=>{if(dialog.contains?.(event.target))rememberForm();});document.addEventListener('change',event=>{if(dialog.contains?.(event.target))rememberForm();});
  window.addEventListener('beforeunload',event=>{if(updateInstallBlocked()){queue?.remember();rememberForm();event.preventDefault();event.returnValue='';}});
  window.addEventListener('online',()=>queue?.flush());
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&booted)queue?.flush();});
  window.__matUpdateCanQuit=()=>!updateInstallBlocked();
  try{updates?.onUpdateStatus?.(handleUpdateStatus);}catch(error){handleUpdateStatus({state:'error',message:safeError(error)});}
  initialize();
})();
