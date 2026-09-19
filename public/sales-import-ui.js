(function(root){
  'use strict';

  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=v=>String(v==null?'':v).trim();
  const uid=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'sales-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const number=v=>Number.isFinite(Number(v))?Number(v):null;
  const noop=()=>{};

  /* Build the small, bounded candidate that the business Store accepts.
     The UI never reconstructs a 27万行 source from its current page. A file
     service should return `items` after aggregation; the page fallback is
     allowed only when the caller explicitly marks the page complete. */
  async function buildCandidate(options={}){
    const c=options.getContext?options.getContext()||{}:{};
    const session=options.session||{};
    const planItems=options.planItems||c.plan?.items||[];
    const meta={importId:options.importId||options.status?.importId||session.sessionId||uid(),sessionId:session.sessionId||'',workspaceId:c.workspaceId||'',storageEpoch:c.storageEpoch,filename:text(options.filename),period:text(options.period),basis:options.basis==='units'?'units':'orders',missingPolicy:options.missingPolicy||'keep',unitsAcknowledged:!!options.unitsAcknowledged,shopId:c.shopId||'',planId:c.planId||'',skuFingerprint:options.skuFingerprint||c.itemsFingerprint||'',items:planItems.map(i=>({id:i.id,productId:i.productId||'',skuId:i.skuId||''})),bindings:Object.values(options.bindings||{}),platform:c.platform||'',sourceShop:c.sourceShop||''};
    let source=null;
    if(typeof options.aggregate==='function')source=await options.aggregate(session,meta);
    else if(options.fileJobs&&typeof options.fileJobs.salesCandidate==='function')source=await options.fileJobs.salesCandidate(session.sessionId||session,{...meta,ownerToken:meta.ownerToken||session.ownerToken});
    else if(options.request&&session.sessionId)source=await options.request(`/api/file-sessions/${encodeURIComponent(session.sessionId)}/sales-candidate`,{method:'POST',body:JSON.stringify(meta)});
    if(!source?.items?.length&&source?.total===undefined){
      if(options.pageComplete===true&&Array.isArray(options.rows))source={items:options.rows,total:options.rows.filter(r=>!r.excluded).reduce((n,r)=>n+Number(r.count||0),0),excluded:options.rows.filter(r=>r.excluded).length};
      else throw Error('销售会话尚未生成全量汇总，请等待后台识别完成。');
    }
    return {...meta,itemsFingerprint:meta.skuFingerprint,total:Number(source.total||0),excluded:Number(source.excluded||0),unknown:Number(source.unknown||0),missing:source.missing||[],items:(source.items||[]).map((r,i)=>({id:r.id||r.rowId||`summary-${i}`,itemId:r.itemId||'',count:r.count??r.quantity??r.sales??0,productId:r.productId||'',skuId:r.skuId||'',excluded:!!r.excluded,bind:!!r.itemId}))};
  }

  function create(options={}){
    const cfg={
      getState:options.getState||(()=>({})),
      getContext:options.getContext||(()=>({})),
      commit:options.commit||null,
      undo:options.undo||null,
      flush:options.flush||null,
      toast:options.toast||noop,
      request:options.request||null,
      fileJobs:options.fileJobs||root.FileJobs,
      dialog:options.dialog||null,
      pageSize:Math.min(100,Math.max(1,Number(options.pageSize)||100))
    };
    let dialog=null,step='upload',session=null,status=null,rows=[],nextCursor=null,revision=0;
    let filename='',period='',basis='orders',unitsAcknowledged=false,missingPolicy='keep',quantityColumn='';
    let sheetId='',sheets=[],mapping={},filter='all',busy=false,errorMessage='',notice='',undoToken=null;
    let currentPage=0,pageCursors=[null],bindingOverrides={},started=false,closedReason='';

    const state=()=>cfg.getState()||{};
    function context(){
      const c=cfg.getContext()||{};
      const plan=c.plan||state().plans?.find(p=>p.id===c.planId)||state().plans?.find(p=>p.id===state().active);
      return {...c,planId:c.planId||plan?.id||'',shopId:c.shopId||plan?.shopId||'',plan};
    }
    function planItems(){return context().plan?.items||[];}
    function itemLabel(item){
      const s=state().sizes?.find(x=>x.id===item.sizeId),size=s?(s.name||`${s.salesW||'—'} × ${s.salesH||'—'} cm`):'';
      return [size,item.skuId||item.id].filter(Boolean).join(' · ')||'未命名规格';
    }
    function selectedPlanFingerprint(){
      const items=planItems();
      return context().itemsFingerprint||JSON.stringify(items.map(i=>[i.id,i.productId||'',i.skuId||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    }
    function fileApi(){
      const api=cfg.fileJobs||root.FileJobs;
      if(!api)throw Error('文件任务服务未加载');
      return api;
    }
    function invoke(name,...args){
      const api=fileApi(),sessionId=x=>typeof x==='string'?x:x?.sessionId;
      if(name==='create')return api.create(...args);
      if(name==='upload'){
        const [s,file]=args;return api.upload(sessionId(s),file,{ownerToken:s?.ownerToken});
      }
      if(name==='status')return api.status(sessionId(args[0]));
      if(name==='selectSheet'){
        const [s,input]=args;return api.selectSheet(sessionId(s),{...input,ownerToken:input?.ownerToken||s?.ownerToken});
      }
      if(name==='rows'){
        const [s,input={}] = args;const query={page:currentPage+1,pageSize:input.limit||cfg.pageSize};return s?.kind==='sales'&&typeof api.salesAggregates==='function'?api.salesAggregates(sessionId(s),query):api.rows(sessionId(s),query);
      }
      if(name==='salesCandidate'){
        const [s,input={}] = args;return api.salesCandidate(sessionId(s),{...input,ownerToken:input.ownerToken||s?.ownerToken});
      }
      if(name==='salesReview'){
        const [s,input={}] = args;const fn=api.salesReview||api.salesReviews;if(typeof fn!=='function')throw Error('文件任务接口缺少 salesReview');return fn(sessionId(s),{...input,ownerToken:input.ownerToken||s?.ownerToken});
      }
      if(name==='reviews'||name==='review'){
        const [s,input={}] = args;const fn=api.review||api.reviews;if(typeof fn!=='function')throw Error('文件任务接口缺少 review');return fn(sessionId(s),{...input,ownerToken:input.ownerToken||s?.ownerToken});
      }
      if(typeof api[name]!=='function')throw Error(`文件任务接口缺少 ${name}`);
      return api[name](...args);
    }
    function describeError(err,fallback='销售文件尚未完成，请核对输入后重试。'){
      if(err?.status===409)return '文件会话已发生变化，请重新读取当前复核页后再提交。';
      return text(err?.message||err?.detail?.message)||fallback;
    }
    function setError(message){errorMessage=message||'';busy=false;paint();}
    function showDialog(){
      if(!dialog){
        dialog=cfg.dialog||document.getElementById('sales-import-dialog');
        if(!dialog){dialog=document.createElement('dialog');dialog.id='sales-import-dialog';dialog.setAttribute('aria-labelledby','sales-import-title');document.body.appendChild(dialog);}
        dialog.addEventListener('click',onClick);
        dialog.addEventListener('change',onChange);
        dialog.addEventListener('input',onInput);
        dialog.addEventListener('cancel',()=>close('cancel'));
      }
      if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
      else dialog.setAttribute('open','');
    }
    function close(reason='close'){
      closedReason=reason;
      if(dialog){if(typeof dialog.close==='function'&&dialog.open)dialog.close(reason);else dialog.removeAttribute('open');}
      if(reason==='cancel'||reason==='close')cfg.toast('销售导入已保留为当前草稿');
    }
    function reset(){
      step='upload';session=null;status=null;rows=[];nextCursor=null;revision=0;filename='';period='';basis='orders';unitsAcknowledged=false;missingPolicy='keep';quantityColumn='';sheetId='';sheets=[];mapping={};filter='all';busy=false;errorMessage='';notice='';undoToken=null;currentPage=0;pageCursors=[null];bindingOverrides={};started=false;closedReason='';
    }
    function open(initial={}){reset();period=text(initial.period);filename=text(initial.filename);if(initial.basis==='units'||initial.basis==='items')basis='units';showDialog();paint();return api;}
    function title(){return step==='upload'?'导入销售情况':step==='mapping'?'选择销售口径':step==='review'?'复核销售导入':step==='applying'?'正在写入销售数据':'销售导入完成';}
    function stepLabel(id,label){return `<span class="sales-import-step ${step===id?'active':''} ${['review','applying','done'].includes(step)&&id!=='upload'?'visited':''}">${esc(label)}</span>`;}
    function planSummary(){const c=context(),p=c.plan;return p?`${esc(p.name||'当前计划')} · ${esc(p.skuCount??planItems().length)} 个 SKU`:'未选择计划';}
    function uploadView(){
      return `<div class="sales-import-upload">
        <div class="sales-import-dropzone" tabindex="0" role="button" data-sales-upload-trigger>
          <span class="sales-import-drop-icon" aria-hidden="true">↥</span><strong>选择销售报表</strong><span>仅上传到本机会话，原文件不会写入正式数据</span>
          <input type="file" name="sales-file" data-sales-file accept=".xlsx" aria-label="选择销售报表" hidden>
        </div>
        <div class="sales-import-meta-grid">
          <label class="sales-import-field"><span>统计周期</span><input name="sales-period" data-sales-period value="${esc(period)}" placeholder="例如 2026-09-01 至 2026-09-18"></label>
          <fieldset class="sales-import-field sales-import-basis"><legend>数量口径</legend><label><input type="radio" name="sales-basis" value="orders" ${basis==='orders'?'checked':''}>支付订单数</label><label><input type="radio" name="sales-basis" value="units" ${basis==='units'?'checked':''}>销售件数</label></fieldset>
        </div>
        ${basis==='units'?`<label class="sales-import-check"><input type="checkbox" name="sales-units-ack" data-sales-units-ack ${unitsAcknowledged?'checked':''}>我确认按一单一件估算订单占比</label>`:''}
        <p class="sales-import-hint">销售文件支持多店铺或平台；识别到多个来源时，下一步会要求选择当前计划对应的来源，不会自动合并。</p>
        ${filename?`<p class="sales-import-file">已选择：<strong>${esc(filename)}</strong></p>`:''}
      </div>`;
    }
    function mappingView(){
      const sheetOptions=sheets.map((s,i)=>{const id=text(s.id||s.sheetId||s.name||i);return `<option value="${esc(id)}" ${id===sheetId?'selected':''}>${esc(s.name||s.title||id)}</option>`;}).join('');
      const selectedSheet=sheets.find(s=>text(s.id||s.sheetId||s.name)===sheetId)||sheets[0]||{};
      const columns=(selectedSheet.columns||selectedSheet.headers||status?.columns||status?.headers||[]).map((x,i)=>{const value=x&&typeof x==='object'?(x.id??x.key??x.name??i):i,label=x&&typeof x==='object'?(x.name??x.label??value):x;return `<option value="${esc(value)}" ${text(value)===quantityColumn?'selected':''}>${esc(label)}</option>`;}).join('');
      return `<div class="sales-import-mapping">
        <div class="sales-import-summary"><span>文件</span><strong>${esc(filename||status?.filename||'销售报表')}</strong></div>
        ${sheets.length?`<label class="sales-import-field"><span>工作表</span><select name="sales-sheet" data-sales-sheet aria-label="选择工作表">${sheetOptions}</select></label>`:''}
        <label class="sales-import-field"><span>数量列</span><select name="sales-quantity-column" data-sales-quantity-column aria-label="选择数量列"><option value="">请选择数量列</option>${columns}</select></label>
        <div class="sales-import-meta-grid"><label class="sales-import-field"><span>统计周期</span><input name="sales-period" data-sales-period value="${esc(period)}"></label><div class="sales-import-basis-readonly"><span>统计口径</span><strong>${basis==='orders'?'支付订单数':'销售件数'}</strong></div></div>
        <p class="sales-import-hint">平台、店铺、商品 ID 和 SKU ID 会优先用于精确匹配；无法唯一确认的记录必须手动绑定或排除。</p>
      </div>`;
    }
    function rowStatus(row){return row.error||row.issue?'待处理':row.excluded?'已排除':row.itemId?'已匹配':'待绑定';}
    function rowOptions(selected){
      return `<option value="">待绑定</option>${planItems().map(item=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(itemLabel(item))}</option>`).join('')}`;
    }
    function visibleRows(){
      if(filter==='unresolved')return rows.filter(r=>!r.excluded&&(!r.itemId||r.error||r.issue));
      if(filter==='excluded')return rows.filter(r=>r.excluded);
      return rows;
    }
    function reviewView(){
      const visible=visibleRows(),matched=rows.filter(r=>r.itemId&&!r.error&&!r.excluded).length,unresolved=rows.filter(r=>!r.excluded&&(!r.itemId||r.error||r.issue)).length;
      return `<div class="sales-import-review">
        <div class="sales-import-review-head"><div><p class="sales-import-file"><strong>${esc(filename||status?.filename||'销售报表')}</strong> · ${esc(period||'未填写统计周期')}</p><p class="sales-import-hint">${matched} 条已匹配，${unresolved} 条待处理；销量只读，绑定和排除可修改。</p></div><div class="sales-import-filter" role="tablist" aria-label="销售记录筛选"><button type="button" data-sales-filter="all" class="${filter==='all'?'active':''}" role="tab" aria-selected="${filter==='all'}">全部 ${rows.length}</button><button type="button" data-sales-filter="unresolved" class="${filter==='unresolved'?'active':''}" role="tab" aria-selected="${filter==='unresolved'}">待处理 ${unresolved}</button><button type="button" data-sales-filter="excluded" class="${filter==='excluded'?'active':''}" role="tab" aria-selected="${filter==='excluded'}">已排除 ${rows.filter(r=>r.excluded).length}</button></div></div>
        <div class="sales-import-table-wrap"><table class="sales-import-table"><caption class="sr-only">销售明细绑定复核</caption><thead><tr><th scope="col">来源记录</th><th scope="col">数量</th><th scope="col">当前计划规格</th><th scope="col">处理</th></tr></thead><tbody>${visible.length?visible.map(row=>`<tr data-sales-row="${esc(row.rowId||row.id)}"><td><strong>${esc(row.skuId||row.sku||row.spec||row.sourceSku||'未提供 SKU')}</strong><small>${esc([row.productId,row.shop,row.platform,row.period].filter(Boolean).join(' · '))}</small>${row.error||row.issue?`<em>${esc(row.error||row.issue)}</em>`:''}</td><td class="sales-import-num">${esc(row.count??row.quantity??row.sales??'—')}</td><td><select name="sales-bind-${esc(row.rowId||row.id)}" data-sales-bind aria-label="绑定 ${esc(row.skuId||row.sku||row.spec||'销售记录')}" ${row.excluded?'disabled':''}>${rowOptions(row.itemId)}</select></td><td><label class="sales-import-exclude"><input type="checkbox" name="sales-exclude-${esc(row.rowId||row.id)}" data-sales-exclude ${row.excluded?'checked':''}>排除</label></td></tr>`).join(''):`<tr><td colspan="4" class="sales-import-empty">当前筛选没有记录</td></tr>`}</tbody></table></div><div class="sales-import-pagination"><button type="button" class="btn ghost" data-sales-prev ${currentPage===0||busy?'disabled':''}>上一页</button><span>第 ${currentPage+1} 页</span><button type="button" class="btn ghost" data-sales-next ${!nextCursor||busy?'disabled':''}>下一页</button></div>
        <div class="sales-import-missing"><span>报表未出现的 SKU</span><label><input type="radio" name="sales-missing" value="keep" ${missingPolicy==='keep'?'checked':''}>待确认，暂不应用</label><label><input type="radio" name="sales-missing" value="zero" ${missingPolicy==='zero'?'checked':''}>本次按 0 处理</label></div>
      </div>`;
    }
    function footer(){
      if(step==='upload')return `<button type="button" class="btn ghost" data-sales-cancel>取消</button><button type="button" class="btn primary" data-sales-start ${busy?'disabled':''}>读取文件</button>`;
      if(step==='mapping')return `<button type="button" class="btn ghost" data-sales-back>返回</button><button type="button" class="btn primary" data-sales-map ${busy?'disabled':''}>开始识别</button>`;
      if(step==='review')return `<button type="button" class="btn ghost" data-sales-cancel>稍后处理</button>${undoToken?'<button type="button" class="btn ghost" data-sales-undo>撤销本次导入</button>':''}<button type="button" class="btn primary" data-sales-apply ${busy||!canApply()?'disabled':''}>应用销量与占比</button>`;
      if(step==='applying')return `<button type="button" class="btn ghost" data-sales-cancel disabled>处理中…</button>`;
      return `${undoToken?'<button type="button" class="btn ghost" data-sales-undo>撤销本次导入</button>':''}<button type="button" class="btn primary" data-sales-close>完成</button>`;
    }
    function canApply(){
      if(!period.trim()||!rows.length||rows.some(r=>!r.excluded&&(!r.itemId||r.error||r.issue)))return false;
      if(missingPolicy!=='zero'&&planItems().some(i=>!rows.some(r=>!r.excluded&&r.itemId===i.id)))return false;
      if(basis==='units'&&!unitsAcknowledged)return false;
      return true;
    }
    function html(){
      const body=step==='upload'?uploadView():step==='mapping'?mappingView():step==='review'?reviewView():step==='applying'?`<div class="sales-import-progress" role="status" aria-live="polite"><span class="sales-import-spinner" aria-hidden="true"></span><strong>正在写入当前计划</strong><p>候选数据正在校验，期间改价会保留，不会覆盖售价。</p></div>`:`<div class="sales-import-success" role="status"><span aria-hidden="true">✓</span><strong>销售数据已写入当前计划</strong><p>销量与订单占比已更新，售价和其他计划参数保持不变。</p></div>`;
      return `<div class="sales-import-shell"><header class="sales-import-head"><div><p class="sales-import-eyebrow">${planSummary()}</p><h2 id="sales-import-title">${title()}</h2></div><button type="button" class="sales-import-close" data-sales-cancel aria-label="关闭销售导入">×</button></header><nav class="sales-import-steps" aria-label="导入进度">${stepLabel('upload','上传文件')}<span aria-hidden="true">›</span>${stepLabel('mapping','选择口径')}<span aria-hidden="true">›</span>${stepLabel('review','复核绑定')}<span aria-hidden="true">›</span>${stepLabel('done','完成')}</nav><div class="sales-import-body">${errorMessage?`<div class="sales-import-alert" role="alert">${esc(errorMessage)}</div>`:''}${notice?`<div class="sales-import-notice" role="status">${esc(notice)}</div>`:''}${body}</div><footer class="sales-import-footer">${footer()}</footer></div>`;
    }
    function paint(){if(!dialog)return;dialog.innerHTML=html();if(root.lucide?.createIcons)root.lucide.createIcons({attrs:{'stroke-width':1.7}});}
    async function startFile(file){
      if(!file)return;
      if(!/\.xlsx$/i.test(file.name)){setError('请选择 .xlsx 格式的销售报表。');return;}
      if(file.size>100*1024*1024){setError('文件超过 100 MiB 上限，请拆分后重试。');return;}
      filename=file.name;busy=true;errorMessage='';notice='正在创建文件会话…';paint();
      try{
        const c=context();session=await invoke('create','sales',{workspaceId:c.workspaceId,storageEpoch:c.storageEpoch,shopId:c.shopId,planId:c.planId,itemsFingerprint:selectedPlanFingerprint()});session.kind='sales';
        await invoke('upload',session,file);status=await invoke('status',session);for(let i=0;i<120&&!((status.candidateSheets||status.sheets||status.sheetCandidates||[]).length||status.error);i++){await new Promise(resolve=>setTimeout(resolve,250));status=await invoke('status',session);}if(status.error)throw Error(status.error.message||status.error);revision=status.revision||0;sheets=status.sheets||status.candidateSheets||status.sheetCandidates||[];if(!sheets.length&&status.sheetId)sheets=[{id:status.sheetId,name:status.sheetName||status.sheetId}];sheetId=sheets[0]?.id??sheets[0]?.sheetId??sheets[0]?.name??'';mapping={...(sheets[0]?.mapping||{})};step='mapping';busy=false;notice='文件已上传，选择工作表和数量列。';paint();
      }catch(err){setError(describeError(err,'文件上传失败，原文件已保留在本机，请检查格式后重试。'));}
    }
    async function selectSheet(){
      if(!session){setError('文件会话已失效，请重新选择文件。');return;}
      if(!quantityColumn){setError('请选择数量列。');return;}
      if(!period.trim()){setError('请填写统计周期。');return;}
      if(basis==='units'&&!unitsAcknowledged){setError('请确认按销售件数估算订单占比。');return;}
      busy=true;errorMessage='';notice='正在后台识别并汇总销售明细…';paint();
      try{
        const result=await invoke('selectSheet',session,{sheetId,mapping:{...mapping,sales:quantityColumn,quantity:quantityColumn},basis,period,expectedSessionRevision:revision});
        status={...status,...result};revision=result.revision??revision;await waitForRows();
      }catch(err){setError(describeError(err,'销售文件识别失败，请检查工作表和数量列。'));}
    }
    async function waitForRows(){
      let current=status;
      for(let i=0;i<180;i++){
        if(current?.phase==='error'||current?.error)throw Error(current.error||'销售文件识别失败');
        if(['reviewing','ready','completed'].includes(current?.phase)||current?.rowCount>0)break;
        await new Promise(resolve=>setTimeout(resolve,250));
        current=await invoke('status',session);status=current;revision=current.revision??revision;
      }
      status=current;step='review';busy=false;notice='';currentPage=0;pageCursors=[null];await loadRows();
    }
    async function loadRows(cursor){
      busy=true;paint();
      try{const result=await invoke('rows',session,{limit:cfg.pageSize,...(cursor?{cursor}:{})});const sourceRows=result.rows||result.items||[];rows=sourceRows.map((r,i)=>{const review=r.review||{};return {...r,rowId:r.rowId||r.id||`row-${currentPage*cfg.pageSize+i}`,count:r.count??r.quantity??r.sales??0,itemId:r.itemId||r.match||review.itemId||'',excluded:!!(r.excluded||review.excluded)};});nextCursor=result.nextCursor||((result.hasNext||Number(result.totalPages||0)>currentPage+1)?String(currentPage+1):null);revision=result.revision??revision;busy=false;paint();}
      catch(err){setError(describeError(err,'销售复核页读取失败，请重试。'));}
    }
    async function changePage(direction){
      if(busy)return;
      if(direction>0&&nextCursor){pageCursors[currentPage+1]=nextCursor;currentPage++;await loadRows(nextCursor);return;}
      if(direction<0&&currentPage>0){currentPage--;await loadRows(pageCursors[currentPage]);}
    }
    async function persistRow(row){
      if(!session||typeof (cfg.fileJobs||root.FileJobs)?.salesReview!=='function'&&typeof (cfg.fileJobs||root.FileJobs)?.salesReviews!=='function')return;
      try{const result=await invoke('salesReview',session,{rowIds:[row.rowId||row.id],patch:{itemId:row.itemId||'',excluded:!!row.excluded},mutationId:uid(),expectedSessionRevision:revision});revision=result?.revision??revision;}
      catch(err){errorMessage=err?.status===409?'复核版本已变化，请刷新当前页后继续。':describeError(err,'复核内容尚未保存到文件会话。');paint();}
    }
    async function apply(){
      if(!canApply()){setError('请完成统计周期、未匹配记录和未出现 SKU 的处理后再应用。');return;}
      busy=true;step='applying';errorMessage='';notice='正在提交销售候选…';paint();
      try{
        if(cfg.flush)await cfg.flush();
        const c=context();
        const payload=await buildCandidate({getContext:context,request:cfg.request,fileJobs:cfg.fileJobs||root.FileJobs,session,status,filename,period,basis,missingPolicy,unitsAcknowledged,skuFingerprint:selectedPlanFingerprint(),planItems:planItems(),bindings:bindingOverrides,rows,pageComplete:!nextCursor});
        payload.expectedSessionRevision=revision;
        let result;
        if(cfg.commit)result=await cfg.commit(payload,{...c,expectedRevision:c.revision,sessionId:session?.sessionId,storageEpoch:c.storageEpoch});
        else if(root.SalesImport?.prepare&&root.SalesImport?.apply){const s=state(),draft=root.SalesImport.prepare(s,c.planId,payload.items,payload);result=root.SalesImport.apply(s,draft,c);}
        else throw Error('销售保存接口未接入');
        undoToken=result?.undoToken||result?.undo||null;step='done';busy=false;notice='';cfg.toast('销售数据已应用到当前计划');paint();
      }catch(err){step='review';busy=false;errorMessage=err?.status===409?'当前计划已发生变化，候选数据仍保留，请重新检查后再提交。':describeError(err,'销售数据未写入，候选数据已保留。');paint();}
    }
    async function undoImport(){
      if(!undoToken)return;
      busy=true;errorMessage='';paint();
      try{if(cfg.undo)await cfg.undo(undoToken,{...context(),sessionId:session?.sessionId});else throw Error('当前窗口没有撤销接口');undoToken=null;step='review';notice='本次销售导入已撤销。';cfg.toast('已撤销本次销售导入');paint();}
      catch(err){setError(describeError(err,'计划已有后续编辑，本次导入不能撤销。'));}
    }
    function fieldValue(target){return target?.value??'';}
    function onClick(event){
      const target=event.target.closest('[data-sales-upload-trigger],[data-sales-start],[data-sales-map],[data-sales-apply],[data-sales-cancel],[data-sales-close],[data-sales-back],[data-sales-filter],[data-sales-undo],[data-sales-prev],[data-sales-next]');if(!target)return;
      if(target.matches('[data-sales-upload-trigger]')){dialog.querySelector('[data-sales-file]')?.click();return;}
      if(target.matches('[data-sales-start]')){dialog.querySelector('[data-sales-file]')?.click();return;}
      if(target.matches('[data-sales-map]')){selectSheet();return;}
      if(target.matches('[data-sales-apply]')){apply();return;}
      if(target.matches('[data-sales-undo]')){undoImport();return;}
      if(target.matches('[data-sales-back]')){step='mapping';errorMessage='';paint();return;}
      if(target.matches('[data-sales-filter]')){filter=target.dataset.salesFilter||'all';paint();return;}
      if(target.matches('[data-sales-prev]')){changePage(-1);return;}
      if(target.matches('[data-sales-next]')){changePage(1);return;}
      if(target.matches('[data-sales-close]')){close('done');return;}
      if(target.matches('[data-sales-cancel]')){close('cancel');}
    }
    function onChange(event){
      const t=event.target;
      if(t.matches('[data-sales-file]')){startFile(t.files?.[0]);return;}
      if(t.matches('[data-sales-period]')){period=fieldValue(t);return;}
      if(t.matches('[name=sales-basis]')){basis=t.value==='units'?'units':'orders';paint();return;}
      if(t.matches('[data-sales-units-ack]')){unitsAcknowledged=t.checked;return;}
      if(t.matches('[data-sales-sheet]')){sheetId=t.value;const selected=sheets.find(sheet=>text(sheet.id??sheet.sheetId??sheet.name)===sheetId);mapping={...(selected?.mapping||{})};quantityColumn='';paint();return;}
      if(t.matches('[data-sales-quantity-column]')){quantityColumn=t.value;return;}
      if(t.matches('[name=sales-missing]')){missingPolicy=t.value;return;}
      const row=t.closest('[data-sales-row]');if(row&&t.matches('[data-sales-bind]')){const itemId=t.value||'';const id=row.dataset.salesRow;const r=rows.find(x=>String(x.rowId||x.id)===String(id));if(r){r.itemId=itemId;r.issue='';bindingOverrides[id]={rowId:id,itemId,excluded:!!r.excluded};persistRow(r);}paint();return;}
      if(row&&t.matches('[data-sales-exclude]')){const r=rows.find(x=>String(x.rowId||x.id)===String(row.dataset.salesRow));if(r){r.excluded=t.checked;r.issue='';const id=r.rowId||r.id;bindingOverrides[id]={rowId:id,itemId:r.itemId||'',excluded:r.excluded};persistRow(r);}paint();}
    }
    function onInput(event){if(event.target.matches('[data-sales-period]'))period=fieldValue(event.target);}
    const api={open,close,reset,html,paint,startFile,loadRows,apply,undo:undoImport,buildCandidate:()=>buildCandidate({getContext:context,request:cfg.request,fileJobs:cfg.fileJobs||root.FileJobs,session,status,filename,period,basis,missingPolicy,unitsAcknowledged,skuFingerprint:selectedPlanFingerprint(),planItems:planItems(),bindings:bindingOverrides,rows,pageComplete:!nextCursor}),getSession:()=>session,getDraft:()=>({filename,period,basis,missingPolicy,unitsAcknowledged,bindings:{...bindingOverrides},rows:[...rows]}),isOpen:()=>!!dialog?.open,hasUnpersistedDraft:()=>!!session&&step!=='done',canQuit:()=>!busy&&!dialog?.open&&!api.hasUnpersistedDraft()};
    return api;
  }
  root.SalesImportUI={create,buildCandidate};
  if(typeof module==='object')module.exports={create,buildCandidate};
})(typeof window==='object'?window:globalThis);
