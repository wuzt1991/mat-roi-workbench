/* Desktop workbench. Confirmed records and database persistence are independent of the forecast. */
(() => {
  'use strict';
  const M=window.MatModel,T=window.MatTransfer,R=window.ReusableRules,A=window.PromotionRules,S=window.SalesImport,O=window.OperatingRecords;
  const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
  const APP_VERSION=window.WorkbenchConfig?.version||'未知',updates=window.matUpdates;
  const updatesSupported=!!updates&&window.WorkbenchConfig?.updatesSupported===true;
  let operationPending=false,skuOptionsOpen=false,showDeletedRules=false,inlineDrafts={};
  let state=M.initialState(),view='plan',tab='sku',libraryTab='materials',query='',showInactiveMaterials=false,modal=null,lastFocus=null,saveError='',toastTimer,busy=false;
  let formDrafts=null,recoveryContext=null,productUI=null,salesUI=null,commitSerial=0;
  let pendingFileSessions=[],fileSessionDrafts=new Map();
  let queue,saveStatus='loading',booted=false,pendingRecovery=null,backupItems=[],dataPath='';
  let updateStatus={state:'idle',version:null,percent:null,message:''};
  const DRAFT_PREFIX='mat-roi-workbench-draft-';
  let clientId;
  try{clientId=sessionStorage.getItem('mat-roi-client')||crypto.randomUUID();sessionStorage.setItem('mat-roi-client',clientId);}catch{clientId=crypto.randomUUID();}
  let draftKey=DRAFT_PREFIX+clientId,workspaceId='',storageEpoch=0;
  const operating=window.OperatingController.create();

  const {e,n,money,short,roi,icon,btn,ib,sizeName,dimensions,production,field,gramField,weightText,option,empty}=window.WorkbenchFormat;

  const current=()=>state.plans.find(p=>p.id===state.active&&!p.deleted&&p.shopId===state.activeShop);
  const activePlans=()=>state.plans.filter(p=>!p.deleted&&p.shopId===state.activeShop).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
  const shopName=id=>state.shops.find(s=>s.id===id)?.name||'店铺';

  const materialOptions=id=>state.materials.filter(m=>((m.active&&!m.deleted&&(m.weightRules||[]).some(r=>M.selectable(r)&&materialRuleUsable(r)))||m.id===id)).map(m=>option(m.id,`${m.name}${m.deleted?'（已删除）':m.active?'':'（停用）'}`,id)).join('');

  const shippingOptions=id=>state.shippingTemplates.filter(t=>t.active&&!t.deleted||t.id===id).map(t=>option(t.id,t.name+(t.deleted?'（已删除）':t.active?'':'（停用）'),id)).join('');

  function normalize(){
    if(!state.shops.some(s=>s.id===state.activeShop&&!s.deleted))state.activeShop=state.shops.find(s=>!s.deleted)?.id||'';
    if(!current())state.active=activePlans()[0]?.id||'';
  }
  const refundSummaryText=window.WorkbenchFormat.refundSummaryText;
  function safeError(error,message='操作未完成，请核对输入后重试；持续失败时请导出备份并联系维护人员。'){
    console.error('[workbench]',error);return message;
  }
  function toast(message){clearTimeout(toastTimer);const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');toastTimer=setTimeout(()=>t.classList.remove('show'),5000);}
  function save(reason='save'){queue?.enqueue(state,reason);}
  function saveStatusText(){return {loading:'正在读取数据',pending:'有修改待保存',saving:'正在保存…',saved:'已保存到电脑',error:'保存失败',conflict:'其他窗口已更新'}[saveStatus];}
  function updateInstallBlocked(){return !booted||!!modal||Object.keys(inlineDrafts).length>0||operationPending||busy||!shell.canQuit()||formDrafts?.status().pending>0||!!formDrafts?.status().error||!!queue?.pending||!!queue?.sending||!!queue?.failedSent||!!saveError||saveStatus!=='saved';}
  function updateStatusText(){if(!updatesSupported)return '仅 Windows x64 支持自动更新';const s=updateStatus;return s.state==='checking'?'正在检查更新…':s.state==='available'?`发现新版本 v${e(s.version||'')}`:s.state==='downloading'?`正在后台下载 ${e(s.percent??0)}%`:s.state==='downloaded'?'已下载，重启安装':s.state==='uptodate'?'当前已是最新版':s.state==='error'?'更新失败，继续使用当前版本':'检查更新';}
  function updateAction(){
    if(!updatesSupported)return btn('check-updates','检查更新','refresh-cw','ghost','disabled');
    if(updateStatus.state==='available')return btn('download-update','下载更新','download','primary');
    if(updateStatus.state==='downloaded')return btn('quit-and-install','重启安装','power','primary',updateInstallBlocked()?'disabled':'');
    return btn('check-updates','检查更新','refresh-cw','ghost',updateStatus.state==='checking'||updateStatus.state==='downloading'?'disabled':'');
  }
  function paintUpdateStatus(){const el=document.querySelector('#update-controls');if(el){el.innerHTML=`<span id="update-status" class="update-status" role="status" aria-live="polite" title="${e(updateStatus.message||updateStatusText())}">${updateStatusText()}</span>${updateAction()}`;window.lucide?.createIcons();}}
  function handleUpdateStatus(status){if(!status||typeof status!=='object')return;updateStatus={state:String(status.state||'error'),version:status.version||null,percent:status.percent??null,message:String(status.message||'')};paintUpdateStatus();if(updateStatus.state==='error'&&updateStatus.message)toast(updateStatus.message);}
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
    try{await draft.saveSession({sessionId:String(meta.sessionId),ownerToken:String(meta.ownerToken||draft.ownerToken),revision:Number(meta.revision)||0,workspaceId,storageEpoch,filename:String(meta.filename||''),fileKind:String(meta.fileKind||meta.kind||''),accepted:meta.accepted!==false});}
    catch(error){console.error('[workbench] file session draft save',error);toast('文件复核会话未能写入恢复草稿，请保持窗口打开。');if(meta.accepted===true&&meta.fileKind==='product')throw error;}
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
    jobs.create=async(kind,target,rules)=>{const result=await F.create(kind,target,rules);await rememberFileSession({...result,fileKind:kind,accepted:kind!=='product'});return result;};
    jobs.upload=async(id,file,options={})=>{const result=await F.upload(id,file,options);await touchFileSession(id,result,{filename:file?.name||''});return result;};
    for(const name of ['status','selectSheet','rows','salesCandidate','salesReview','salesReviews','review','undo','startExport'])if(typeof F[name]==='function')jobs[name]=async(...args)=>{const result=await F[name](...args);const id=typeof args[0]==='string'?args[0]:args[0]?.sessionId;await touchFileSession(id,result);return result;};
    jobs.discard=async(id,options={})=>{const result=await F.discard(id,options);await discardFileSession(id);return result;};
    return jobs;
  }
  function setupFileUI(){
    if(!productUI&&window.ProductTransferUI&&window.FileJobs){const jobs=trackedFileJobs();productUI=window.ProductTransferUI.create({getState:()=>state,render:()=>{if(view==='product')render();},toast,request:(action,p={})=>{switch(action){case 'create':return jobs.create(p.kind,p.target,p.rules);case 'upload':return jobs.upload(p.sessionId,p.file,{ownerToken:p.ownerToken});case 'status':return jobs.status(p.sessionId);case 'selectSheet':return jobs.selectSheet(p.sessionId,p.options);case 'rows':return jobs.rows(p.sessionId,p.query);case 'review':return jobs.review(p.sessionId,p.command);case 'mutationStatus':return jobs.mutationStatus(p.sessionId,p.kind,p.command);case 'accept':return rememberFileSession({...p,accepted:true});case 'recompute':return jobs.recompute(p.sessionId,p.options);case 'undo':return jobs.undo(p.sessionId,p.command);case 'startExport':return jobs.startExport(p.sessionId,p.options);case 'downloadUrl':return window.FileJobs.downloadUrl(p.sessionId,p.artifactId);case 'cancel':return jobs.cancel(p.jobId);case 'discard':return jobs.discard(p.sessionId,{ownerToken:p.ownerToken});default:throw Error('文件操作不存在');}}});}
    if(!salesUI&&window.SalesImportUI&&window.FileJobs){const jobs=trackedFileJobs();salesUI=window.SalesImportUI.create({getState:()=>state,getContext:fileContext,toast,fileJobs:jobs,flush:()=>queue.flush(),commit:commitSales,undo:async token=>{const next=S.undo(state,token);commit(next);if(!await queue.flush())throw Error('撤销尚未保存，请保留页面并重试保存');return true;}});}
  }
  const shell=window.WorkbenchShell.create({product:()=>productUI,sales:()=>salesUI,context:fileContext});
  function setView(next){view=shell.navigate(next);}
  async function restorePendingProductSession(){
    if(!productUI||productUI.inspect?.().session)return;
    const saved=pendingFileSessions.filter(x=>x.fileKind==='product'&&x.accepted!==false).sort((a,b)=>Number(b.updated||0)-Number(a.updated||0))[0];
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
  async function commitSales(payload,context={}){const applied=window.SalesImportModel.prepareCommit(state,payload,context,{workspaceId,storageEpoch,revision:queue?.revision,planId:current()?.id});if(applied.duplicate)return applied;commit(applied.state,'save');return {undoToken:applied.undoToken,importId:applied.importId};}
  async function auxiliary(type,payload){if(!window.FileJobs)throw Error('文件服务未加载');const job=await window.FileJobs.startAuxiliary(type,payload);const result=await window.FileJobs.waitForJob(job.jobId);return {...result,jobId:job.jobId};}
  async function exportListing(){if(busy)return;busy=true;try{const result=await auxiliary('export-listing',{state,planId:current().id});downloadLink(window.FileJobs.auxiliaryDownloadUrl(result.jobId),'上架价格-'+M.today()+'.xlsx');toast('上架价格表已生成');}catch(error){fail(error.message);}finally{busy=false;}}
  function downloadLink(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
  async function restoreWorkspace(next){const target=modal;if(!target||operationPending)return;operationPending=true;target.pending=true;target.operationId??=crypto.randomUUID();target.expectedRevision??=queue?.revision??recoveryContext?.revision;try{if(queue&&!await queue.pause())return fail('请先解决当前保存问题再恢复');if(target.expectedRevision!==queue?.revision&&queue)target.expectedRevision=queue.revision;await request('/api/restore',{method:'POST',body:JSON.stringify({state:next,expectedRevision:target.expectedRevision,operationId:target.operationId})});target.committed=true;close(true);shell.destroy();productUI=null;salesUI=null;await initialize();toast('工作区已恢复并保存');}catch(error){fail(error.message);}finally{operationPending=false;if(target)target.pending=false;queue?.resume();}}

  async function recoveryPoints(){const result=await request('/api/backups');backupItems=result.items;dataPath=result.dataDir;open('recovery-points');}
  async function downloadState(data,name){const migrated=M.migrate(data);if(!M.validateBackup(migrated))throw Error('恢复点未通过校验，请下载原件');const result=await auxiliary('export-backup',{state:migrated});downloadLink(window.FileJobs.auxiliaryDownloadUrl(result.jobId),name+'.xlsx');}

  function nav(){return window.ShellViews.nav({state,view,version:APP_VERSION,plans:activePlans()});}
  function topbar(){return window.ShellViews.topbar({view,shopName:shopName(state.activeShop),planName:current()?.name,version:APP_VERSION,saveText:saveStatusText(),updateText:updateStatusText(),updateButton:updateAction()});}
  function metric(id,r){
    if(!r.valid)return {value:'待完善',note:r.errors[0],full:r.errors.join('；')};
    const values={roi:r.roi,netRoi:r.netRoi,profit:r.profit,cost:r.cost,price:r.price,margin:r.margin,gmv:r.gmv,receivedSales:r.receivedSales,investment:r.investment,rate:r.rate*100};
    const notes={roi:'按退款后实收收入和类型化履约成本计算的保本线',netRoi:'扣除 1 小时内退款率后的净 ROI',profit:'已扣广告及已填费用',cost:'按退款类型分摊商品和运费，含平台费、税及其他费用，不含广告',price:'按订单占比加权',margin:'每卖一单可用于广告的钱',gmv:'广告消耗 × 支付 ROI',receivedSales:'整体成交金额扣除三类退款，未扣费用',investment:'商品、广告和各项已填费用',rate:'每 100 元销售额，未扣广告的结余'};
    const v=values[id];return {value:id==='roi'||id==='netRoi'?(v>1e6?v.toExponential(2):roi(v)):v===null?'待填写':(id==='profit'&&v>=0?'+':'')+(id==='rate'?'':'¥')+short(v)+(id==='rate'?' 元':''),full:id==='roi'||id==='netRoi'?roi(v):money(v),note:notes[id],negative:v<0};
  }
  function metrics(r){return `<div class="metric-toolbar"><h2>当前测算</h2>${btn('display','显示设置','sliders-horizontal','ghost')}</div><div class="metric-grid" data-count="${state.prefs.ids.length}" style="--count:${state.prefs.ids.length}">${state.prefs.ids.map(id=>{const m=metric(id,r);return `<section class="metric" data-metric="${id}"><div class="metric-label">${M.metricList.find(x=>x.id===id).label}</div><div class="metric-value ${m.negative?'negative':id==='profit'?'positive':''}" title="${e(m.full)}" tabindex="0" aria-label="${e(M.metricList.find(x=>x.id===id).label+' '+m.full)}">${e(m.value)}</div><div class="metric-desc">${e(m.note)}</div></section>`;}).join('')}</div>`;}
  function paramField(key,label,unit='',params=current().params,entry=false){return window.WorkbenchFormat.paramField(key,label,unit,params,entry);}

  function rail(){const p=current();return `<aside class="parameter-rail" aria-label="本计划参数">
    <section class="rail-section"><div class="section-head"><h2>投放与费用</h2><span class="tag">改动即试算</span></div><div class="fields">${paramField('spend','广告消耗','元')}${paramField('actualRoi','支付 ROI')}</div></section>
    <section class="rail-section fee-section"><div class="fields fee-fields"><label class="field"><span class="field-label">未发货仅退款率</span><div class="input-unit"><input type="number" data-param-rate="unshipped" value="${e(p.params.refundRates?.unshipped??0)}" min="0" max="100" step="any"><span>%</span></div></label><label class="field"><span class="field-label">已发货仅退款率</span><div class="input-unit"><input type="number" data-param-rate="shippedOnly" value="${e(p.params.refundRates?.shippedOnly??0)}" min="0" max="100" step="any"><span>%</span></div></label><label class="field"><span class="field-label">退货退款率</span><div class="input-unit"><input type="number" data-param-rate="returnRefund" value="${e(p.params.refundRates?.returnRefund??0)}" min="0" max="100" step="any"><span>%</span></div></label><label class="field"><span class="field-label">1 小时内退款率（选填）</span><div class="input-unit"><input type="number" data-param-rate="firstHour" value="${e(p.params.refundRates?.firstHour??'')}" min="0" max="100" step="any"><span>%</span></div></label>${paramField('fee','平台服务费','%')}${paramField('tax','税率','%')}</div><p id="refund-breakdown" class="note stack-gap">${e(refundSummaryText(p.params))}</p><p class="note">三类退款率分别参与成本测算；净 ROI 会扣除 1 小时内退款率。</p></section>
    <details class="advanced extra-costs"><summary><span>退货回收与其他费用</span>${icon('chevron-down')}</summary><div class="fields stack-gap">${paramField('recovery','退货回收比例','%')}${paramField('other','其他费用','元/单')}${paramField('returnCost','每退货单额外费用','元')}<label class="field"><span class="field-label">其他费用发生范围</span><select data-param-scope aria-label="其他费用发生范围">${option('shipped','已发货订单',p.params.otherFeeScope)}${option('all','所有订单',p.params.otherFeeScope)}</select></label></div><p class="note stack-gap">包材、运费险等填其他费用。回收比例指退货能收回的货品成本；成本不含广告。</p></details>
    <details class="advanced plan-notes"><summary><span>计划备注</span>${icon('chevron-down')}</summary><label class="field"><span class="sr-only">计划备注</span><textarea data-note aria-label="计划备注">${e(p.note)}</textarea></label></details>
  </aside>`;}
  function planPage(){const p=current();if(!p)return empty('这个店铺还没有计划','从已有材料和尺寸开始，填写一次即可反复测算。');const r=M.calculate(state,p),records=tab!=='sku';return `<div class="page-header"><div class="page-heading"><div class="row"><h1>${e(p.name)}</h1>${ib('rename-plan','重命名计划','pencil')}</div><p class="page-sub">${records?'单计划经营复盘 · 只汇总已确认记录':'修改参数即时测算，确认记录后计入总账。'}</p></div><div class="row">${records?'':btn('copy-plan','复制计划','copy')}${btn('entry','记录当天经营','book-check','confirm-entry')}</div></div>
    ${records?'':`<div class="content-grid plan-overview"><section class="main-column" aria-label="测算结果"><div id="metrics">${metrics(r)}</div></section>${rail()}</div>`}
    <section class="plan-detail-card"><nav class="tabs" aria-label="测算视图">${[['sku','尺寸与售价'],['history','经营记录']].map(([id,label])=>`<button type="button" data-action="tab" data-tab="${id}" class="tab ${(id==='sku'?!records:records)?'active':''}" ${(id==='sku'?!records:records)?'aria-current="page"':''}>${label}</button>`).join('')}</nav>
    ${!records&&p.needsMaterialReview?`<div class="message-error">旧规格曾按厚度估算，请确认所选材料现在的真实报价。${btn('approve-material','已核对报价')}</div>`:''}<div id="tab-content">${records?historyPage(false):skuTable(r)}</div></section><footer class="page-footer"><span>预估经营利润 · 非结算利润</span><span>当前报价用于试算，历史按记录时成本保留。</span></footer>`;}

  function skuCell(id,i){
    const key=i.id;
    if(id==='price'||id==='share')return `<td><input type="number" data-item="${e(key)}" data-key="${id}" value="${e(i[id])}" step="${id==='price'?'0.01':'any'}" min="0" ${id==='share'?'max="100"':''} aria-label="${e(sizeName(i.size)+' '+(id==='price'?'最终到手价':'订单占比'))}">${id==='price'?`<div class="price-mode">${i.priceMode==='manual'?'手动':current().strategyId?'策略价':'手动价'}${i.priceMode==='manual'&&current().strategyId?btn('restore-price','恢复策略价','','ghost',`data-id="${e(key)}"`):''}</div>`:''}</td>`;
    if(id==='weight')return `<td class="num"><button class="sku-weight" data-action="weight" data-id="${e(key)}" aria-label="编辑 ${e(sizeName(i.size))} 发货重量">${i.weight===''?'填写重量':e(weightText(i.weight))}</button></td>`;
    if(id==='sales')return `<td class="num">${i.sales===null||i.sales===undefined?'—':n(i.sales,0)}</td>`;
    const value=id==='grossMargin'?(Number.isFinite(i.grossMargin)?n(i.grossMargin)+'%':'—'):id==='roi'?(!M.positive(i.price)||!Number.isFinite(i.cost)?'待完善':roi(i.roi)):money(i[id]);
    return `<td class="num" data-row-${id}="${e(key)}">${value}</td>`;
  }
  function skuOptions(){const p=current(),m=state.materials.find(x=>x.id===p.materialId);return `<div id="sku-options" class="sku-options-body" ${skuOptionsOpen?'':'hidden'}><div class="reuse-selects"><label class="field"><span>默认材料</span><select data-plan-material aria-label="默认材料">${option('','请选择材料',p.materialId)}${materialOptions(p.materialId)}</select></label><label class="field"><span>厚度</span><select data-plan-material-rule aria-label="默认厚度">${option('','请选择厚度',p.materialRuleId)}${(m?.weightRules||[]).filter(r=>materialRuleUsable(r)&&(!r.deleted||r.id===p.materialRuleId)).map(r=>option(r.id,(r.thickness===''?'不限厚度':r.thickness+' mm')+(r.deleted?'（已删除）':''),p.materialRuleId)).join('')}</select></label><label class="field"><span>运费模板</span><select data-plan-shipping aria-label="运费模板">${option('','请选择运费模板',p.shippingId)}${shippingOptions(p.shippingId)}</select></label></div><div class="sku-options-actions"><select data-size-scheme aria-label="选用尺寸组合"><option value="">选用尺寸组合</option>${(state.sizeSchemes||[]).filter(x=>!x.deleted&&x.active!==false).map(x=>option(x.id,x.name,'')).join('')}</select>${btn('save-size-scheme','保存尺寸组合','save','ghost')}${btn('sales-import','导入销售情况','upload','ghost')}${btn('listing-calculator','上架价格计算器','calculator','ghost')}</div></div>`;}
  function skuTable(r){
    const p=current(),columns=M.skuColumns(state),heads=columns.map(id=>M.skuColumnList.find(c=>c.id===id)).filter(Boolean);
    return `<div class="section-head review-toolbar"><div class="row"><h2>商品规格</h2><span class="tag">${r.rows.length} 个</span><button type="button" class="sku-options-toggle" data-action="sku-options" aria-expanded="${skuOptionsOpen}" aria-controls="sku-options">${skuOptionsOpen?'收起设置':'更多设置'}${icon('chevron-down')}</button></div><div class="row"><select class="strategy-select" data-plan-strategy aria-label="定价策略">${option('','定价策略 · 手动定价',p.strategyId)}${(state.pricingStrategies||[]).filter(x=>!x.deleted||x.id===p.strategyId).map(x=>option(x.id,'定价策略 · '+x.name+(x.deleted?'（已删除）':''),p.strategyId)).join('')}</select>${btn('sku-display','显示设置','sliders-horizontal','ghost','aria-label="商品规格显示设置"')}${btn('add-skus','添加规格','plus')}</div></div>${skuOptions()}${r.rows.length?`<div class="table-scroll"><table class="sku-table" style="--sku-min:${260+columns.length*98}px"><thead><tr><th>商品规格</th>${heads.map(c=>`<th data-column="${c.id}">${e(c.label)}${c.unit?`<small>/ ${e(c.unit)}</small>`:''}</th>`).join('')}<th><span class="sr-only">操作</span></th></tr></thead><tbody>${r.rows.map(i=>`<tr><td><div class="sku-title"><button type="button" data-action="sku-settings" data-id="${e(i.id)}">${e(sizeName(i.size))}</button></div>${i.size?.name||i.size?.needsReview?`<div class="sku-sub">实际生产 ${e(production(i.size))}</div>`:''}</td>${columns.map(id=>skuCell(id,i)).join('')}<td>${ib('remove-sku','移除 '+sizeName(i.size),'x',`data-id="${e(i.id)}"`)}</td></tr>`).join('')}</tbody></table></div><div class="total-row"><span>售价为最终到手价，手动改价后保留手动模式。</span><div class="row"><span id="share-total">合计 ${n(r.total,2)}%</span>${ib('normalize-share','调整占比至 100%','equal')}</div></div>`:empty('还没有商品规格','选择常用尺寸或输入自定义尺寸。','add-skus','添加规格')}<div id="validation">${errors(r)}</div>`;
  }
  function errors(r){return r.valid?'':`<div class="message-error" role="status"><span>${e(r.errors.join('；'))}</span>${['price','share','weight'].some(id=>!M.skuColumns(state).includes(id))?btn('show-sku-inputs','显示填写项','','ghost'):''}</div>`;}

  function historyPage(all){const f=all?operating.state.ledger:{...operating.state.operating,shopId:state.activeShop,planId:current().id};return `${all?'<div class="page-header"><div class="page-heading"><h1>总账</h1><p class="page-sub">汇总有效经营记录，比较店铺与计划表现。</p></div>'+btn('export-ledger','导出筛选账目','file-spreadsheet')+'</div><div class="wide-content">':''}${O.page(state,f,{all,group:operating.state.group,sort:operating.state.sort,page:operating.state.page,metric:operating.state.metric})}${all?'</div>':''}`;}
  const {materialRuleUsable,ruleText}=window.RulesViews;
  function rulesViews(){return window.RulesViews.create({state,modal,libraryTab,query,showDeletedRules,showInactiveMaterials});}

  function libraryPage(){return rulesViews().libraryPage();}
  function ruleSummary(x,key){return rulesViews().ruleSummary(x,key);}

  function reusableForm(){return frame(...rulesViews().reusableForm());}
  function listingCalculator(){const p=current(),scheme=state.promotionSchemes.find(x=>x.id===p.promotionSchemeId),rows=M.calculate(state,p).rows;return frame('上架价格计算器',`<label class="field"><span>活动方案</span><select data-promotion-scheme aria-label="活动方案">${option('','无活动',p.promotionSchemeId)}${state.promotionSchemes.filter(x=>!x.deleted||x.id===p.promotionSchemeId).map(x=>option(x.id,x.name+(x.deleted?'（已删除）':''),p.promotionSchemeId)).join('')}</select></label><p class="note stack-gap">${scheme?e(ruleSummary(scheme,'promotionSchemes')):'上架价与最终到手价相同'}</p><div class="table-scroll"><table><thead><tr><th>商品规格</th><th>目标到手价</th><th>原始上架价</th><th>预计到手价</th><th>高出目标</th></tr></thead><tbody>${rows.map(i=>{const r=i.priceError?{error:i.priceError}:A.reverse(i.price,scheme);return `<tr><td>${e(sizeName(i.size))}</td><td>${money(i.price)}</td>${r.error?`<td colspan="3" class="negative">${e(r.error)}</td>`:`<td>${money(r.listingPrice)}</td><td>${money(r.finalPrice)}</td><td>${money(r.difference)}</td>`}</tr>`;}).join('')}</tbody></table></div>`,btn('save-selected-promotion','另存活动方案','save','ghost',scheme?'':'disabled')+btn('close','关闭')+btn('export-listing','导出价格表','download','primary',rows.some(i=>i.priceError||A.reverse(i.price,scheme).error)?'disabled':''));}
  function skuSettings(){const d=modal.draft,p=current(),m=state.materials.find(x=>x.id===(d.materialId||p.materialId));return frame('商品规格设置',`<label class="field"><span>材料</span><select data-field="materialId" aria-label="SKU 材料">${option('','继承计划默认',d.materialId||'')}${materialOptions(d.materialId)}</select></label><label class="field"><span>厚度</span><select data-field="materialRuleId" aria-label="SKU 厚度" ${d.materialId?'':'disabled'}>${option('','请选择厚度',d.materialRuleId)}${(m?.weightRules||[]).filter(r=>materialRuleUsable(r)&&(!r.deleted||r.id===d.materialRuleId)).map(r=>option(r.id,(r.thickness===''?'不限厚度':r.thickness+' mm')+(r.deleted?'（已删除）':''),d.materialRuleId)).join('')}</select></label><div class="dialog-grid">${field('商品 ID','productId',d.productId||'','text','maxlength="200"')}${field('SKU ID','skuId',d.skuId||'','text','maxlength="200"')}</div>${gramField('实测发货重量 / g','weight',d.weight)}`);}

  function sizeList(){return rulesViews().sizeList();}

  function plansPage(){return `<div class="page-header"><div class="page-heading"><h1>${e(shopName(state.activeShop))} · 计划管理</h1><p class="page-sub">删除计划后，原有账目仍留在总账。</p></div>${btn('new-plan','新建计划','plus','primary')}</div><div class="wide-content"><div class="plans-grid">${state.plans.filter(p=>p.shopId===state.activeShop).map(p=>{const r=M.calculate(state,p);return `<article class="plan-tile ${p.deleted?'disabled-row':''}"><div class="row between"><h2>${e(p.name)}</h2>${p.deleted?'<span class="tag">已删除</span>':ib('delete-plan','删除 '+p.name,'trash-2',`data-id="${p.id}"`)}</div><div><span class="muted tiny">保本 ROI</span><div class="tile-roi">${r.valid?roi(r.roi):'待完善'}</div></div><p class="note">${e(p.note||'暂无备注')}</p>${btn(p.deleted?'restore-plan':'select-plan',p.deleted?'恢复计划':'打开计划',p.deleted?'rotate-ccw':'arrow-up-right','',`data-id="${p.id}"`)}</article>`;}).join('')||empty('还没有计划','新计划会归属当前店铺。')}</div></div>`;}
  function shopsPage(){return `<div class="page-header"><div class="page-heading"><h1>店铺管理</h1><p class="page-sub">每家店铺独立管理计划，共用可复用规则。</p></div>${btn('new-shop','新增店铺','plus','primary')}</div><div class="wide-content"><div class="plans-grid">${state.shops.map(s=>`<article class="plan-tile"><div class="row between"><h2>${e(s.name)}</h2>${ib('rename-shop','重命名 '+s.name,'pencil',`data-id="${s.id}"`)}</div><p class="note">${state.plans.filter(p=>p.shopId===s.id&&!p.deleted).length} 个使用中计划</p>${btn('select-shop','进入店铺','arrow-up-right','',`data-id="${s.id}"`)}</article>`).join('')}</div></div>`;}
  function dataPage(){const bytes=new Blob([JSON.stringify(state)]).size;return `<div class="page-header"><div class="page-heading"><h1>备份与迁移</h1><p class="page-sub">一份 Excel，运营能看，另一台电脑也能恢复。</p></div></div><div class="wide-content"><section class="data-section"><h2>导出 Excel 工作簿</h2><p>可导出完整工作区，或自选店铺、计划和账目日期。所需的材料、尺寸和运费规则会随文件保存。</p><div class="data-actions">${btn('export','选择范围并导出','file-spreadsheet','primary')}${btn('import','导入并恢复','upload')}</div><p>完整恢复请使用未修改的原始导出文件。需要分析时可另存副本；导入会检查表格与冻结账目的完整性。</p></section><section class="data-section"><h2>当前数据</h2><div class="data-stats"><span>${state.shops.length} 家店铺</span><span>${state.plans.filter(p=>!p.deleted).length} 个计划</span><span>${state.records.filter(h=>h.kind==='daily').length} 条账目版本</span><span>约 ${n(bytes/1024)} KB</span></div><p>工作区保存在本机数据库。保留最近 30 个有修改日期的恢复点和最近 10 次导入替换前的副本，更正前账目一直保留。</p><p>普通改数不会反复新增整份备份。旧版升级前的原始副本继续保留；仍建议定期导出 Excel 到其他磁盘。</p><div class="data-actions">${btn('recovery-points','查看本机恢复点','history')}</div></section><section class="data-section"><h2>换电脑</h2><p>在原电脑导出 Excel → 复制文件到新电脑 → 导入恢复。默认合并并跳过重复账目；按范围的文件不会替换整个工作区。</p><p>兼容导入旧版 JSON；新导出统一使用 Excel。完整文件可选替换全部数据，确认前先备份本机。从原型迁移时，请先在原型导出 Excel，再在这里导入。</p></section></div>`;}
  function productTransferPage(){
    if(productUI)return productUI.html();
    return '<div class="page-header"><div class="page-heading"><h1>商品转表</h1></div></div><section class="wide-content product-module-error" aria-labelledby="product-module-error-title"><h2 id="product-module-error-title">商品转表暂时无法加载</h2><p role="alert">请重新加载后再试。已保存的数据不会丢失。</p><div class="data-actions">'+btn('reload-product-module','重新加载','refresh-cw','primary')+btn('data-view','备份与迁移','database','ghost')+'</div></section>';
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

  function render(){const focus=focusSnapshot(app),listScroll=document.querySelector('.plan-list-scroll')?.scrollTop||0;normalize();app.innerHTML=`<div class="app-shell">${nav()}<main class="workspace" id="main-content" tabindex="-1">${topbar()}${({plan:planPage,plans:plansPage,shops:shopsPage,library:libraryPage,history:()=>historyPage(true),data:dataPage,product:productTransferPage}[view]||planPage)()}</main></div>`;window.ScopePickers?.refresh();window.lucide?.createIcons();paintSaveStatus();decorateTables(app);applyInlineDrafts();restoreFocus(app,focus);const list=document.querySelector('.plan-list-scroll');if(list)list.scrollTop=listScroll;O.drawCharts(app);shell.mount();}
  function refreshCalculation(){const p=current();if(!p)return;const r=M.calculate(state,p),el=document.querySelector('#metrics');if(el)el.innerHTML=metrics(r);for(const i of r.rows){for(const [selector,value] of [['material',money(i.material)],['shipping',money(i.shipping)],['cost',money(i.cost)],['grossMargin',Number.isFinite(i.grossMargin)?n(i.grossMargin)+'%':'—'],['roi',!M.positive(i.price)||!Number.isFinite(i.cost)?'待完善':roi(i.roi)]]){const cell=document.querySelector(`[data-row-${selector}="${i.id}"]`);if(cell)cell.textContent=value;}}for(const i of r.rows){const priceInput=document.querySelector(`[data-item="${i.id}"][data-key="price"]`);if(priceInput&&document.activeElement!==priceInput)priceInput.value=i.price;const mode=priceInput?.parentElement?.querySelector('.price-mode');if(mode)mode.innerHTML=i.priceMode==='manual'?'手动'+(p.strategyId?btn('restore-price','恢复策略价','','ghost',`data-id="${e(i.id)}"`):''):p.strategyId?'策略价':'手动价';const cell=document.querySelector(`[data-row-cost="${i.id}"]`);if(cell)cell.title='按退款类型分摊商品和运费；含平台费、税及其他费用，未含广告';}const total=document.querySelector('#share-total');if(total)total.textContent=`合计 ${n(r.total,2)}%`;const breakdown=document.querySelector('#refund-breakdown');if(breakdown)breakdown.textContent=refundSummaryText(p.params);const error=document.querySelector('#validation');if(error)error.innerHTML=errors(r);const side=document.querySelector(`[data-sidebar="${p.id}"]`);if(side)side.textContent='保本 ROI '+(r.valid?roi(r.roi):'待完善');window.lucide?.createIcons();}
  function open(type,data={}){lastFocus=document.activeElement;modal={type,...data};paintModal();modal.baseline=modalValue();if(!dialog.open)dialog.showModal();dialog.querySelector('input,select,button')?.focus();dialog.scrollTop=0;}
  function close(force=false){if(!modal)return;if(!force&&modal.pending)return;if(!force&&!modal.committed&&modal.baseline!==modalValue()&&!window.confirm('有未保存的修改，确定放弃并关闭吗？'))return;const parent=modal?.parent;if(!['recover-form','recover-draft','recovery-points','record-detail','listing-calculator','confirm'].includes(modal.type))formDrafts?.remove('modal').catch(error=>toast(error.message));dialog.close();modal=null;if(parent){modal=parent;paintModal();dialog.showModal();}else if(lastFocus?.isConnected)lastFocus.focus();else{const action=lastFocus?.dataset?.action,id=lastFocus?.dataset?.id;const target=action?[...document.querySelectorAll('[data-action]')].find(el=>el.dataset.action===action&&(!id||el.dataset.id===id)):null;(target||document.querySelector('#main-content'))?.focus();}}
  function modalValue(){return JSON.stringify(modal?{draft:modal.draft,ids:modal.ids,frame:modal.frame,date:modal.date,note:modal.note,reason:modal.reason,previousId:modal.previousId,scope:modal.scope,restoreMode:modal.restoreMode,restorePlans:modal.restorePlans}:null);}
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
  function fail(message,selector){const el=document.querySelector('#dialog-error');if(el){el.textContent=message;const input=selector?dialog.querySelector(selector):null;if(input){let parent=input.parentElement;while(parent&&parent!==dialog){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby','dialog-error');input.closest('details')?.setAttribute('open','');input.focus();}else el.focus();}else toast(message);}
  function lockCommittedFields(){if(modal?.committed){dialog.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);dialog.querySelectorAll('[data-action="confirm-record"],[data-action="confirm-restore"],[data-action="recover-draft"]').forEach(el=>el.textContent='重试保存');}}
  function frame(title,body,footer){const focus=focusSnapshot(dialog);dialog.className=['entry','record-detail'].includes(modal.type)?'entry-dialog':['export','restore'].includes(modal.type)?'transfer-dialog':modal.type==='size'?'size-dialog':modal.type==='sku-display'?'sku-settings-dialog':'';if(modal.type==='entry')dialog.className+=' operating-entry-dialog';dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2>${ib('close','关闭','x')}</div><div class="dialog-body">${body}<p id="dialog-error" class="dialog-error" tabindex="-1" role="alert"></p></div><div class="dialog-footer">${footer||btn('close','取消')+btn('save-modal','保存','check','primary')}</div>`;window.lucide?.createIcons();decorateTables(dialog);restoreFocus(dialog,focus);lockCommittedFields();}
  function commonSizeChoices(){const used=new Set(current().items.map(i=>i.sizeId));return state.sizes.filter(s=>s.active!==false&&!s.deleted&&!s.needsReview&&M.validSize(s)&&!used.has(s.id)).map(s=>`<label class="select-size"><input type="checkbox" data-select-size="${e(s.id)}" ${modal.ids.includes(s.id)?'checked':''}><span>${e(dimensions(s))}</span></label>`).join('')||'<p class="note">常用尺寸均已添加</p>';}

  function sizeForm(){return frame(...rulesViews().sizeForm());}

  function entryForm(){return frame(...window.OperatingEntryViews.create({state,modal}).entryForm());}

  function entrySummary(r){return window.OperatingEntryViews.create({state,modal}).entrySummary(r);}

  function refreshEntry(){const p=modal.frame.plan.params,result=M.calculate(modal.frame,modal.frame.plan),el=document.querySelector('#entry-summary');if(el)el.innerHTML=entrySummary(result);const derived=document.querySelector('#entry-revenue-derived');if(derived)derived.textContent=p.revenueInput==='amount'?n(p.spend>0&&result.gmv!==null?result.gmv/p.spend:null):money(result.gmv);const breakdown=document.querySelector('#entry-refund-breakdown');if(breakdown)breakdown.textContent=refundSummaryText(p);}

  function recordDetail(){return frame(...window.OperatingEntryViews.create({state,modal}).recordDetail());}
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
    if(modal.type==='reusable')return reusableForm();if(modal.type==='listing-calculator')return listingCalculator();if(modal.type==='sku-settings')return skuSettings();if(modal.type==='save-rule-copy')return frame('保存方案',field('方案名称','name',d.name,'text','maxlength="80"'));
    if(modal.type==='export')return exportForm();
    if(modal.type==='restore')return restoreForm();
    if(modal.type==='material')return frame(...rulesViews().materialForm());
    if(modal.type==='shipping')return frame(...rulesViews().shippingForm());
    if(modal.type==='shop')return frame(modal.id?'重命名店铺':'新增店铺',field('店铺名称','name',d.name,'text','maxlength="80"'));
    if(modal.type==='plan')return frame(modal.id?'重命名计划':'新建计划',`<p class="dialog-note">所属店铺：${e(shopName(state.activeShop))}</p>${field('计划名称','name',d.name,'text','maxlength="80"')}${modal.id?'':`<label class="field"><span>本计划材料</span><select data-field="materialId" aria-label="新计划材料">${materialOptions(d.materialId)}</select></label><label class="field"><span>厚度</span><select data-field="materialRuleId" aria-label="新计划厚度">${(state.materials.find(m=>m.id===d.materialId)?.weightRules||[]).filter(r=>M.selectable(r)&&materialRuleUsable(r)).map(r=>option(r.id,r.thickness===''?'不限厚度':r.thickness+' mm',d.materialRuleId)).join('')}</select></label><label class="field"><span>定价策略</span><select data-field="strategyId" aria-label="新计划定价策略">${option('','手动定价',d.strategyId)}${state.pricingStrategies.filter(M.selectable).map(x=>option(x.id,x.name,d.strategyId)).join('')}</select></label><label class="field"><span>运费模板</span><select data-field="shippingId" aria-label="新计划运费模板">${shippingOptions(d.shippingId)}</select></label><p class="note stack-gap">创建后从公共尺寸库添加规格，并填写本计划的售价和占比。</p>`}`);
    if(modal.type==='add-skus')return frame('添加商品规格',`<div class="size-choice-grid">${commonSizeChoices()}</div><h3 class="form-group-title stack-gap">自定义尺寸</h3><div class="dialog-grid">${field('生产长 / cm','salesW',d.salesW,'number','min="0.01" max="10000"')}${field('生产宽 / cm','salesH',d.salesH,'number','min="0.01" max="10000"')}</div>`,btn('close','取消')+btn('save-modal','添加规格','plus','primary'));
    if(modal.type==='weight'){const i=current().items.find(i=>(i.id||i.sizeId)===modal.id),t=state.shippingTemplates.find(t=>t.id===current().shippingId);return frame('发货重量',`<p class="dialog-note">${e(sizeName(state.sizes.find(s=>s.id===i.sizeId)))} · ${e(current().name)}</p>${gramField('含包装重量 / g','weight',d.weight)}<p class="note stack-gap">填写含包装的实际总重；留空使用材料重量加固定包装重量。</p><p class="note">${e(ruleText(t))}</p><p id="weight-preview" class="weight-preview">预计运费：${money(M.shippingCost(t,d.weight).value)}</p>`);}
    if(modal.type==='confirm')return frame(modal.title,`<p class="dialog-note">${e(modal.message)}</p>`,btn('close','取消')+btn('confirm-action',modal.label||'确认','check',modal.danger?'danger':'primary'));
  }
  function confirmAction(title,message,run,label='确认',danger=false){open('confirm',{title,message,run,label,danger});}
  function validateEntry(){try{return window.OperatingEntries.validate(modal);}catch(error){fail(error.message,error.selector);return false;}}
  function startEntry(record,date=M.today()){try{const draft=window.OperatingEntries.start(state,current(),record,date);if(draft){const {type,...values}=draft;open(type,values);}}catch(error){toast(error.message);}}
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
    if(['reusable','save-rule-copy','material','size','shipping'].includes(kind)){
      try{const result=window.RulesEditor.save(state,modal,p?.id);commit(result.state);if(result.addedSizeId&&modal.parent&&!modal.parent.ids.includes(result.addedSizeId))modal.parent.ids.push(result.addedSizeId);close(true);if(!['reusable','save-rule-copy'].includes(kind))toast('已保存');}catch(error){if(!error.ruleValidation)throw error;fail(error.message,error.selector);}return;
    }if(kind==='sku-settings'){const next=M.clone(state),plan=next.plans.find(x=>x.id===p.id),i=plan.items.find(x=>x.id===modal.id);const oldProduct=i.productId,oldSku=i.skuId;for(const k of ['materialId','materialRuleId','productId','skuId','weight'])i[k]=typeof d[k]==='string'?d[k].trim():d[k];if(!i.materialId){delete i.materialId;delete i.materialRuleId;}else if(!i.materialRuleId)return fail('请选择这个材料的厚度','[data-field="materialRuleId"]');if(i.productId!==oldProduct||i.skuId!==oldSku)S.markEdited(plan,'skuId');commit(next);close(true);return;}if(kind==='display'){state.prefs.ids=[...modal.ids];commit();close(true);return;}
    if(kind==='sku-display'){state.prefs.skuColumns=[...modal.ids];commit();close(true);return;}
    if(kind==='add-skus'){if(!modal.ids.length&&d.salesW===''&&d.salesH==='')return fail('请选择尺寸或填写自定义尺寸');const custom=d.salesW!==''||d.salesH!==''?{width:d.salesW,height:d.salesH}:undefined;try{commit(R.addSizes(state,p.id,modal.ids,custom));close(true);}catch(error){fail(error.message);}return;}
    if(kind==='shop'||kind==='plan'||kind==='material'||kind==='shipping'){if(!d.name.trim())return fail('请填写名称','[data-field="name"]');d.name=d.name.trim();}
    if(kind==='shop'){
      if(state.shops.some(x=>x.name===d.name&&x.id!==modal.id))return fail('这个店铺名称已存在','[data-field="name"]');
      if(modal.id)state.shops.find(x=>x.id===modal.id).name=d.name;else{const s={id:M.uid('shop'),name:d.name,deleted:false};state.shops.push(s);state.activeShop=s.id;state.active='';setView('plans');}
    }
    if(kind==='plan'){
      if(state.plans.some(x=>!x.deleted&&x.shopId===state.activeShop&&x.name===d.name&&x.id!==modal.id))return fail('当前店铺已有同名计划','[data-field="name"]');
      if(modal.id)state.plans.find(x=>x.id===modal.id).name=d.name;else{const material=state.materials.find(x=>x.id===d.materialId),rule=material?.weightRules.find(x=>x.id===d.materialRuleId);if(!M.selectable(material)||!M.selectable(rule)||!materialRuleUsable(rule))return fail('请选择可用的材料和厚度','[data-field="materialRuleId"]');if(!state.shippingTemplates.some(x=>x.id===d.shippingId&&M.selectable(x)))return fail('请选择可用的运费模板','[data-field="shippingId"]');if(d.strategyId&&!state.pricingStrategies.some(x=>x.id===d.strategyId&&M.selectable(x)))return fail('请选择可用的定价策略','[data-field="strategyId"]');const created={...M.newPlan(state,state.activeShop,d.name),materialId:d.materialId,materialRuleId:d.materialRuleId,shippingId:d.shippingId,strategyId:d.strategyId||''};state.plans.push(created);state.active=created.id;setView('plan');tab='sku';}
    }

    if(kind==='weight'){const template=state.shippingTemplates.find(t=>t.id===p.shippingId);if(d.weight!==''&&(!M.positive(d.weight)||d.weight>1000||M.shippingCost(template,d.weight).error))return fail('请填写模板支持范围内大于 0 的含包装重量，或留空恢复自动计算。','[data-field="weight"]');p.items.find(i=>(i.id||i.sizeId)===modal.id).weight=d.weight;}
    commit();if(kind==='plan'&&!modal.id)document.querySelector('.plan-nav[aria-current]')?.scrollIntoView?.({block:'nearest'});close(true);toast('已保存');
  }
  const sizeDraft=()=>({name:'',salesW:'',salesH:'',irregular:false,productionW:'',productionH:'',active:true});
  const shippingDraft=()=>({name:'',type:'fixed',fee:1.35,firstWeight:1,firstFee:2,stepWeight:.5,stepFee:.8,maxWeight:10,tiers:[{upTo:.5,fee:1.35},{upTo:1,fee:1.8}],active:true});
  document.addEventListener('click',async event=>{
    const b=event.target.closest('[data-action]');if(!b||b.disabled||operationPending)return;event.preventDefault();const a=b.dataset.action,id=b.dataset.id,p=current();
    try{
      if(a==='boot-retry')return initialize();
      if(a==='reload-product-module'){
        if(queue&&!await queue.flush())return toast('请先完成保存后再重新加载');
        if(updateInstallBlocked())return toast('请先完成或关闭当前编辑后再重新加载');
        location.reload();return;
      }
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
      if(a==='product-view'){setView('product');setupFileUI();render();await restorePendingProductSession();return;}if(a==='sales-import'){setupFileUI();if(!salesUI)return toast('销售导入模块尚未加载，请重新打开工作台');salesUI.open();return;}

      if(a==='operating-range'){operating.range(view==='history',Number(b.dataset.days));render();return;}
      if(a==='operating-all'){operating.range(view==='history',0);render();return;}
      if(a==='operating-page'){operating.state.page=Math.max(0,Number(b.dataset.page)||0);render();return;}
      if(a==='operating-group'){operating.group(b.dataset.group);render();return;}
      if(a==='operating-shop'){operating.shop(id);render();return;}
      if(a==='operating-plan'){const target=state.plans.find(p=>p.id===id);if(target&&!target.deleted&&!state.shops.find(s=>s.id===target.shopId)?.deleted){state.active=target.id;state.activeShop=target.shopId;operating.drillPlan(id,true);setView('plan');tab='history';operating.state.page=0;commit();}else{operating.drillPlan(id,false);render();}return;}

      if(a==='confirm-export')return exportExcel();

      if(a==='scope-all'||a==='scope-none'){modal.scope.shopIds=a==='scope-all'?state.shops.map(s=>s.id):[];modal.scope.planIds=a==='scope-all'?state.plans.map(p=>p.id):[];paintModal();return;}
      if(a==='scope-dates-all'){modal.scope.from='';modal.scope.to='';paintModal();return;}

      if(a==='export-ledger'){if(operating.state.ledger.from&&operating.state.ledger.to&&operating.state.ledger.from>operating.state.ledger.to)return toast('开始日期不能晚于结束日期');return startExport(view==='history'?operating.state.ledger:{...operating.state.operating,shopId:state.activeShop,planId:p?.id});}
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
      if(a==='tab'){tab=b.dataset.tab;operating.state.page=0;render();return;}if(a==='sku-settings')return open('sku-settings',{id,draft:M.clone(p.items.find(x=>x.id===id))});
      if(a==='new-reusable'||a==='edit-reusable'){const old=state[libraryTab]?.find(x=>x.id===id),draft=old?M.clone(old):libraryTab==='pricingStrategies'?{name:'',type:'uniform',margin:30,tiers:[10,20,30],fallback:30,baseArea:.5,baseMargin:10,stepArea:.1,stepPoints:1,cap:60}:libraryTab==='sizeSchemes'?{name:'',sizeIds:[]}:{name:'',steps:[{type:'discount',discount:9}]};return open('reusable',{kind:libraryTab,id,draft});}
      if(a==='copy-reusable')return open('save-rule-copy',{kind:libraryTab,sourceId:id,draft:{name:state[libraryTab].find(x=>x.id===id).name+' · 副本'}});
      if(a==='save-size-scheme')return open('save-rule-copy',{kind:'sizeSchemes',draft:{name:''}});
      if(a==='save-selected-promotion')return open('save-rule-copy',{kind:'promotionSchemes',sourceId:p.promotionSchemeId,draft:{name:''}});
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
      if(a==='pin-plan'){const target=state.plans.find(x=>x.id===id&&!x.deleted);if(target){target.pinned=!target.pinned;commit();if(target.pinned){const list=document.querySelector('.plan-list-scroll');if(list)list.scrollTop=0;}}return;}
      if(a==='new-plan')return open('plan',{draft:{...M.newPlan(state,state.activeShop,'新计划'),name:''}});
      if(a==='rename-plan')return open('plan',{id:p.id,draft:{name:p.name}});
      if(a==='copy-plan'){const copied=M.clone(p);copied.id=M.uid('plan');copied.name=p.name+' · 副本';copied.salesSource=null;copied.pinned=false;copied.items=copied.items.map(i=>({...i,id:M.uid('item'),sales:null}));state.plans.push(copied);state.active=copied.id;commit();toast('已复制试算参数，历史账目不复制');return;}
      if(a==='delete-plan'){const target=state.plans.find(x=>x.id===id);return confirmAction('删除计划？',`删除“${target.name}”后，它会移出使用中列表。历史账目保留，仍可在总账筛选。`,()=>{target.deleted=true;commit();},'删除计划',true);}
      if(a==='restore-plan'){state.plans.find(x=>x.id===id).deleted=false;commit();return;}
      if(a==='new-material'||a==='material'||a==='edit-current-material'){const m=state.materials.find(x=>x.id===(a==='edit-current-material'?p.materialId:id));return open('material',{id:m?.id,draft:{name:m?.name||'',description:m?.description||'',price:m?.price??'',weightRules:M.clone(m?.weightRules||[]),date:M.today(),note:''}});}
      if(a==='add-material-rule'){modal.draft.weightRules=[...(modal.draft.weightRules||[]),{id:M.uid('rule'),thickness:'',variant:'',coefficient:'',costPerSqm:'',default:false,deleted:false}];paintModal();return;}
      if(a==='remove-material-rule'){const rule=modal.draft.weightRules[Number(b.dataset.index)];rule.deleted=true;rule.default=false;paintModal();return;}
      if(a==='toggle-material'){const m=state.materials.find(x=>x.id===id);m.active=!m.active;commit();return;}
      if(a==='delete-material')return confirmAction('停用这份材料？','材料会从新计划选择中移除，现有计划、账目和历史快照继续保留。之后可通过“启用”恢复。',()=>{const m=state.materials.find(x=>x.id===id);if(m)m.active=false;commit();},'停用材料',true);
      if(a==='approve-material'){p.needsMaterialReview=false;commit();return;}
      if(a==='new-size'||a==='edit-size')return open('size',{id,draft:id?(()=>{const size=state.sizes.find(x=>x.id===id),d=M.productionDimensions(size);return {...M.clone(size),salesW:d.width,salesH:d.height,irregular:false,productionW:'',productionH:''};})():sizeDraft()});
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
      if(a==='entry')return startEntry();if(a==='entry-date')return startEntry(null,b.dataset.date);
      if(a==='record-detail')return open('record-detail',{id});
      if(a==='correct-record')return startEntry(state.records.find(h=>h.id===id));
      if(a==='void-record')return confirmAction('作废这笔账目？','原记录保留，但不再计入合计。需要修正数值时，建议使用“更正这笔账”。',()=>{commit(window.OperatingEntries.voidRecord(state,id));},'确认作废',true);
      if(a==='confirm-record'){
        if(!modal||modal.type!=='entry')return;
        if(!modal.committed&&!validateEntry())return;
        const candidate=window.OperatingEntries.confirm(state,modal);
        const entryPlanId=modal.frame.plan.id,entryDate=modal.date;if(view==='plan'&&current()?.id===entryPlanId){tab='history';operating.entryDate(entryDate);}await persistModal(candidate,'save','已确认入账，历史成本已锁定');return;
      }
      if(a==='clear-filters'){operating.clear();render();return;}
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

  document.addEventListener('input',event=>{
    const el=event.target,p=current();if(operationPending||modal?.committed&&dialog.contains?.(el))return;const value=readInput(el);
    if(el.matches('[data-rank-tier]'))modal.draft.tiers[Number(el.dataset.rankTier)]=value;if(el.matches('[data-activity-value]')){const step=modal.draft.steps[Number(el.dataset.activityValue)];step[step.type==='discount'?'discount':'amount']=value;}
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
    if(modal?.type==='plan'&&!modal.id&&el.matches('[data-field="materialId"]')){modal.draft.materialId=value;const rules=(state.materials.find(m=>m.id===value)?.weightRules||[]).filter(r=>M.selectable(r)&&materialRuleUsable(r));modal.draft.materialRuleId=(rules.find(r=>r.default)||rules[0])?.id||'';paintModal();return;}
    if(el.id==='active-shop'){state.activeShop=value;normalize();setView('plan');commit();}

    if(el.matches('[data-plan-material]')){if(!value){toast('请选择材料，原选择已保留');render();return;}p.materialId=value;p.materialRuleId=M.materialRule(state.materials.find(m=>m.id===value),{} )?.id;save();render();}
    if(el.matches('[data-plan-material-rule]')){if(!value){toast('请选择有效厚度，原选择已保留');render();return;}p.materialRuleId=value;save();refreshCalculation();render();}
    if(el.matches('[data-plan-shipping]')){if(!value){toast('请选择运费模板，原选择已保留');render();return;}p.shippingId=value;save();render();}
    if(el.matches('[data-param-scope]')){p.params.otherFeeScope=value;save();refreshCalculation();}
    if(modal?.type==='entry'&&el.matches('[data-entry-revenue-mode]')){const params=modal.frame.plan.params,result=M.calculate(modal.frame,modal.frame.plan);if(value==='roi'&&params.spend===0&&result.gmv>0){el.value='amount';toast('零广告且有成交时，请使用成交金额录入。');return;}if(value==='amount')params.actualGmv=result.gmv??'';else params.actualRoi=params.spend>0&&result.gmv!==null?result.gmv/params.spend:result.gmv===0?0:'';params.revenueInput=value;paintModal();rememberForm();return;}
    if(el.matches('[data-operating]')){operating.setFilter(false,el.dataset.operating,value);render();return;}
    if(el.matches('[data-operating-metric]')){operating.state.metric=value;render();return;}
    if(el.matches('[data-operating-sort]')){operating.state.sort=value;render();return;}
    if(el.matches('[data-filter]')){operating.setFilter(true,el.dataset.filter,value);render();}

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
