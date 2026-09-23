(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=v=>String(v??'').trim();
  const uid=()=>root.crypto?.randomUUID?.()||'sales-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);

  async function buildCandidate(options={}){
    const c=options.getContext?.()||{},session=options.session||{},planItems=options.planItems||c.plan?.items||[];
    const meta={importId:options.importId||session.sessionId||uid(),sessionId:session.sessionId||'',ownerToken:session.ownerToken,
      workspaceId:c.workspaceId||'',storageEpoch:c.storageEpoch,shopId:c.shopId||'',planId:c.planId||'',
      filename:text(options.filename),period:text(options.period),basis:options.basis==='units'?'units':'orders',
      missingPolicy:options.missingPolicy||'keep',unitsAcknowledged:!!options.unitsAcknowledged,
      skuFingerprint:options.skuFingerprint||c.itemsFingerprint||'',items:planItems,bindings:Object.values(options.bindings||{}),
      additions:options.additions||[],matchBy:options.matchBy,sourceKey:options.sourceKey||'',expectedSessionRevision:options.revision};
    let source;
    if(options.aggregate)source=await options.aggregate(session,meta);
    else if(options.fileJobs?.salesCandidate)source=await options.fileJobs.salesCandidate(session.sessionId,meta);
    else if(options.request&&session.sessionId)source=await options.request('/api/file-sessions/'+encodeURIComponent(session.sessionId)+'/sales-candidate',{method:'POST',body:JSON.stringify(meta)});
    if(!source?.items?.length&&source?.total===undefined){
      if(options.pageComplete===true&&Array.isArray(options.rows))source={items:options.rows,total:options.rows.filter(r=>!r.excluded).reduce((n,r)=>n+Number(r.count||0),0)};
      else throw Error('销售会话尚未生成全量汇总，请等待后台识别完成。');
    }
    return {...meta,...source,itemsFingerprint:meta.skuFingerprint,items:(source.items||[]).map((r,i)=>({...r,id:r.id||r.rowId||'summary-'+i,itemId:r.itemId||'',count:r.count??r.quantity??r.sales??0,productId:r.productId||'',skuId:r.skuId||'',excluded:!!r.excluded,bind:options.matchBy==='size'?false:!!r.bind}))};
  }

  function create(options={}){
    const cfg={getState:()=>({}),getContext:()=>({}),toast:()=>{},...options};
    let dialog=null,step='upload',busy=false,session=null,sheets=[],sheetId='',mapping={},quantityColumn='',titleColumn='';
    let filename='',period='',basis='orders',unitsAcknowledged=false,missingPolicy='keep',sourceKey='',bindings={},summary=null,additions=[];
    let error='',notice='',revision=0,undoToken=null,page=0,filter='all',epoch=0,dragDepth=0,snapshot=null,listening=false;
    const jobs=()=>cfg.fileJobs||root.FileJobs;
    const state=()=>cfg.getState()||{};
    function context(){const c=cfg.getContext()||{},s=state(),plan=c.plan||s.plans?.find(p=>p.id===(c.planId||s.active));return {...c,plan,planId:c.planId||plan?.id||'',shopId:c.shopId||plan?.shopId||''};}
    function planItems(){return (context().plan?.items||[]).map(i=>{
      const s=state().sizes?.find(s=>s.id===i.sizeId),d=s&&!s.needsReview?(root.MatModel?.productionDimensions?.(s)||{width:s.irregular?s.productionW:s.salesW,height:s.irregular?s.productionH:s.salesH}):{};
      return {id:i.id,productId:i.productId||'',skuId:i.skuId||'',width:d.width||0,height:d.height||0,label:d.width&&d.height?d.width+' × '+d.height+' cm':s?.name||'尺寸待完善'};
    });}
    function reviewItems(){return [...planItems(),...additions.map(a=>({id:a.itemId,productId:'',skuId:'',width:a.width,height:a.height,label:a.width+' × '+a.height+' cm（待添加）'}))];}
    function currentSnapshot(){const c=context();return {workspaceId:c.workspaceId,storageEpoch:c.storageEpoch,shopId:c.shopId,planId:c.planId,itemsFingerprint:c.itemsFingerprint||JSON.stringify((c.plan?.items||[]).map(i=>[i.id,i.productId||'',i.skuId||'']).sort((a,b)=>a[0].localeCompare(b[0]))),items:planItems()};}
    function assertSnapshot(){if(JSON.stringify(snapshot)!==JSON.stringify(currentSnapshot()))throw Error('当前计划或商品尺寸已变化，请重新导入销售报表。');}
    const label=id=>planItems().find(i=>i.id===id)?.label||'未匹配规格';
    const message=e=>text(e?.message)||'销售导入失败，请重试。';
    function paint(){if(dialog)dialog.innerHTML=html();}
    function setError(value){error=value;notice='';paint();}
    function isOpen(){return !!dialog?.open;}
    function reset(){epoch++;step='upload';busy=false;session=null;sheets=[];sheetId='';mapping={};quantityColumn='';titleColumn='';filename='';period='';basis='orders';unitsAcknowledged=false;missingPolicy='keep';sourceKey='';bindings={};summary=null;additions=[];error='';notice='';revision=0;undoToken=null;page=0;filter='all';snapshot=null;resetDrag();}
    function show(){
      if(!dialog){
        dialog=cfg.dialog||root.document.getElementById('sales-import-dialog');
        if(!dialog){dialog=root.document.createElement('dialog');dialog.id='sales-import-dialog';root.document.body.appendChild(dialog);}
        dialog.setAttribute('aria-labelledby','sales-import-title');
        for(const [type,fn] of Object.entries(dialogEvents))dialog.addEventListener(type,fn);
      }
      if(!listening&&root.document){for(const [type,fn] of Object.entries(dragEvents))root.document.addEventListener(type,fn);listening=true;}
      if(!dialog.open){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}
      paint();
    }
    function open(initial={}){
      if(!snapshot||step==='done'||JSON.stringify(snapshot)!==JSON.stringify(currentSnapshot())){reset();snapshot=currentSnapshot();period=text(initial.period);}
      show();return api;
    }
    function close(reason='close'){
      if(busy){cfg.toast('正在处理销售文件，请稍候。');return;}
      if(session&&step!=='done')cfg.toast('销售复核尚未应用，可重新打开继续，或选择放弃本次导入后退出。');
      resetDrag();if(dialog?.close)dialog.close(reason);else dialog?.removeAttribute('open');
    }
    async function discard(){if(busy)return;const token=epoch;busy=true;paint();try{if(session&&jobs().discard)await jobs().discard(session.sessionId,{ownerToken:session.ownerToken});if(token!==epoch)return;reset();close();}catch(e){if(token===epoch)setError(message(e));}finally{if(token===epoch){busy=false;paint();}}}
    function destroy(){reset();if(listening){for(const [type,fn] of Object.entries(dragEvents))root.document.removeEventListener(type,fn);listening=false;}if(dialog){for(const [type,fn] of Object.entries(dialogEvents))dialog.removeEventListener(type,fn);dialog.close?.();dialog=null;}}
    function columns(){return (sheets.find(s=>String(s.id??s.sheetId)===String(sheetId))?.columns||[]);}
    function selectColumns(){const s=sheets.find(s=>String(s.id??s.sheetId)===String(sheetId))||sheets[0];mapping={...(s?.mapping||{})};titleColumn=Number.isInteger(mapping.specName)?String(mapping.specName):'';chooseQuantity();}
    function chooseQuantity(){const n=mapping[basis==='orders'?'orderCount':'unitCount'];quantityColumn=Number.isInteger(n)?String(n):'';}
    function columnOptions(value){return '<option value="">请选择</option>'+columns().map((c,i)=>'<option value="'+esc(c.id??i)+'" '+(String(c.id??i)===value?'selected':'')+'>'+esc(c.name??c)+'</option>').join('');}
    function periodField(){return '<label class="sales-import-field"><span>统计周期</span><input data-sales-period value="'+esc(period)+'" placeholder="从报表日期自动识别，也可手动填写"></label>';}
    function basisField(){return '<fieldset class="sales-import-field sales-import-basis"><legend>占比计算口径</legend><label><input type="radio" name="sales-basis" value="orders" '+(basis==='orders'?'checked':'')+'>成交订单数（默认）</label><label><input type="radio" name="sales-basis" value="units" '+(basis==='units'?'checked':'')+'>成交件数</label></fieldset>'+(basis==='units'?'<label class="sales-import-check"><input type="checkbox" data-sales-units-ack '+(unitsAcknowledged?'checked':'')+'>按一单一件估算订单占比</label>':'');}
    function uploadView(){return '<div class="sales-import-upload"><div class="sales-import-dropzone" data-sales-upload-trigger tabindex="0" role="button" aria-disabled="'+busy+'"><span class="sales-import-drop-icon" aria-hidden="true">↥</span><strong data-sales-drop-label>拖入销售报表，或点击选择</strong><span>支持单个 .xlsx 文件，自动合并不同图案的相同尺寸</span><input type="file" data-sales-file accept=".xlsx" aria-label="选择销售报表" hidden '+(busy?'disabled':'')+'></div><div class="sales-import-meta-grid">'+periodField()+'<div>'+basisField()+'</div></div><p class="sales-import-hint">从商品 SKU 标题提取尺寸，按同尺寸汇总成交订单数，计算后回填当前计划的订单占比。</p></div>';}
    function mappingView(){return '<div class="sales-import-mapping"><p class="sales-import-file">'+esc(filename)+'</p><label class="sales-import-field"><span>工作表</span><select data-sales-sheet>'+sheets.map(s=>'<option value="'+esc(s.id??s.sheetId)+'" '+(String(s.id??s.sheetId)===String(sheetId)?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label><label class="sales-import-field"><span>商品 SKU 标题 / 尺寸列</span><select data-sales-title-column>'+columnOptions(titleColumn)+'</select></label><div class="sales-import-meta-grid"><div>'+basisField()+'</div><label class="sales-import-field"><span>数量列</span><select data-sales-quantity-column>'+columnOptions(quantityColumn)+'</select></label></div><p class="sales-import-hint">已识别的表头会自动选中。不同图案按尺寸合并；多个店铺或商品来源会分别显示，选择一个来源后计算。</p></div>';}
    function selectedGroups(){const rows=summary?.groups||[];return filter==='unresolved'?rows.filter(r=>!r.excluded&&(!r.itemId||r.issue)):filter==='excluded'?rows.filter(r=>r.excluded):rows;}
    function reviewView(){
      const all=selectedGroups(),pages=Math.max(1,Math.ceil(all.length/100));page=Math.min(page,pages-1);const visible=all.slice(page*100,(page+1)*100);
      const itemOptions=selected=>'<option value="">请选择对应规格</option>'+reviewItems().map(i=>'<option value="'+esc(i.id)+'" '+(i.id===selected?'selected':'')+'>'+esc(i.label)+'</option>').join('');
      return '<div class="sales-import-review"><p class="sales-import-file"><strong>'+esc(filename)+'</strong> · '+(basis==='orders'?'成交订单数':'成交件数')+'</p>'+periodField()+
        ((summary?.sources?.length||0)>1?'<label class="sales-import-field"><span>选择当前计划对应的来源</span><select data-sales-source><option value="">请选择来源</option>'+summary.sources.map(s=>'<option value="'+esc(s.key)+'" '+(s.key===sourceKey?'selected':'')+'>'+esc(s.label)+' · '+s.quantity+' '+(basis==='orders'?'单':'件')+'</option>').join('')+'</select></label>':'')+
        '<div class="sales-import-review-head"><p class="sales-import-hint">已纳入 '+(summary?.total||0)+' '+(basis==='orders'?'单':'件')+'；待处理 '+(summary?.unknown||0)+' 组，已排除 '+(summary?.excluded||0)+' 组。</p><div class="sales-import-filter">'+[['all','全部'],['unresolved','待处理'],['excluded','已排除']].map(([v,n])=>'<button type="button" data-sales-filter="'+v+'" class="'+(filter===v?'active':'')+'">'+n+'</button>').join('')+'</div></div>'+
        '<div class="sales-import-table-wrap sales-import-result"><table class="sales-import-table"><caption class="sr-only">按尺寸合并销售数据</caption><thead><tr><th>报表尺寸</th><th>数量合计</th><th>当前计划规格</th><th>规格占比</th><th>处理</th></tr></thead><tbody>'+(visible.map(r=>'<tr data-sales-row="'+esc(r.rowId)+'"><td><strong>'+esc(r.size)+(r.size==='未识别尺寸'?'':' cm')+'</strong><small title="'+esc(r.example)+'">合并 '+r.sourceCount+' 条记录 · '+esc(r.example)+'</small>'+(r.issue?'<em title="'+esc(r.issue)+'">'+esc(r.issue)+'</em>':'')+'</td><td class="sales-import-num">'+r.count+'</td><td><select data-sales-bind aria-label="'+esc(r.size)+' 对应规格" '+(r.excluded?'disabled':'')+'>'+itemOptions(r.itemId)+'</select>'+(r.canAdd?'<button type="button" class="btn ghost sales-import-add-size" data-sales-add-size="'+esc(r.rowId)+'">一键添加此尺寸</button>':additions.some(a=>a.itemId===r.itemId)?'<button type="button" class="btn ghost sales-import-add-size" data-sales-remove-size="'+esc(r.itemId)+'">取消添加</button>':'')+'</td><td class="sales-import-num">'+(!r.excluded&&r.itemId&&summary.total>0?Number(summary.items.find(i=>i.itemId===r.itemId)?.share||0).toFixed(2)+'%':'—')+'</td><td><label class="sales-import-exclude"><input type="checkbox" data-sales-exclude '+(r.excluded?'checked':'')+'>排除</label></td></tr>').join('')||'<tr><td colspan="5">请选择来源或调整筛选。</td></tr>')+'</tbody></table></div>'+
        (pages>1?'<div class="sales-import-pagination"><button type="button" class="btn ghost" data-sales-prev '+(page===0?'disabled':'')+'>上一页</button><span>第 '+(page+1)+' / '+pages+' 页</span><button type="button" class="btn ghost" data-sales-next '+(page+1===pages?'disabled':'')+'>下一页</button></div>':'')+
        (summary?.missing?.length?'<div class="sales-import-missing"><span>有 '+summary.missing.length+' 个计划规格未匹配到销售记录</span><label><input type="checkbox" data-sales-missing '+(missingPolicy==='zero'?'checked':'')+'>确认这些规格本次按 0 处理</label></div>':'')+
        (additions.length?'<p class="sales-import-hint" data-sales-additions>待添加 '+additions.length+' 个尺寸，应用订单占比时一并保存；沿用计划的材料、厚度、运费和定价设置。</p>':'')+'<p class="sales-import-hint">分母为当前来源中已匹配且未排除的数量合计；同尺寸已合并所有图案'+(summary?.ready?'':'，待处理记录解决后会重新计算')+'。</p></div>';
    }
    function canApply(){return !!summary?.ready&&!!period.trim()&&(basis!=='units'||unitsAcknowledged)&&!busy;}
    function html(){
      const c=context(),titles={upload:'导入销售情况',mapping:'确认销售字段',review:'复核尺寸汇总',applying:'正在回填订单占比',done:'订单占比已更新'};
      const body=step==='upload'?uploadView():step==='mapping'?mappingView():step==='review'?reviewView():step==='applying'?'<div class="sales-import-progress" role="status">正在保存…</div>':'<div class="sales-import-success"><span aria-hidden="true">✓</span><strong>销量与订单占比已更新</strong><p>已按尺寸合并不同图案，可返回商品规格查看。</p></div>';
      const footer=step==='upload'?'<button type="button" class="btn primary" data-sales-start>选择文件</button>':step==='mapping'?'<button type="button" class="btn ghost" data-sales-back>重新选文件</button><button type="button" class="btn primary" data-sales-map>按尺寸汇总</button>':step==='review'?'<button type="button" class="btn ghost" data-sales-retry>刷新汇总</button><button type="button" class="btn ghost" data-sales-back>重新选文件</button><button type="button" class="btn primary" data-sales-apply '+(canApply()?'':'disabled')+'>应用订单占比</button>':step==='done'?(undoToken?'<button type="button" class="btn ghost" data-sales-undo>撤销本次导入</button>':'')+'<button type="button" class="btn primary" data-sales-close>完成</button>':'';
      return '<div class="sales-import-shell"><header class="sales-import-head"><div><p class="sales-import-eyebrow">'+esc(c.plan?.name||'当前计划')+' · '+planItems().length+' 个规格</p><h2 id="sales-import-title">'+titles[step]+'</h2></div><button type="button" class="sales-import-close" data-sales-close aria-label="关闭销售导入" '+(busy?'disabled':'')+'>×</button></header><nav class="sales-import-steps" aria-label="导入进度">'+[['upload','上传文件'],['mapping','确认字段'],['review','尺寸汇总'],['done','完成']].map(([s,n])=>'<span class="sales-import-step '+(step===s?'active':'')+'">'+n+'</span>').join('<span aria-hidden="true">›</span>')+'</nav><div class="sales-import-body" aria-busy="'+busy+'">'+(error?'<div class="sales-import-alert" role="alert">'+esc(error)+'</div>':'')+(notice?'<div class="sales-import-notice" role="status">'+esc(notice)+'</div>':'')+'<fieldset class="sales-import-controls" '+(busy?'disabled':'')+'>'+body+'</fieldset></div><footer class="sales-import-footer"><button type="button" class="btn ghost" data-sales-close '+(busy?'disabled':'')+'>'+(step==='done'?'关闭':'暂时关闭')+'</button>'+(session&&step!=='done'?'<button type="button" class="btn ghost" data-sales-discard '+(busy?'disabled':'')+'>放弃本次导入</button>':'')+'<fieldset class="sales-import-actions" '+(busy?'disabled':'')+'>'+footer+'</fieldset></footer></div>';
    }
    async function poll(ready,token){
      for(let i=0;i<240;i++){
        if(token!==epoch)throw Error('导入已取消。');
        const s=await jobs().status(session.sessionId);if(s.error)throw Error(s.error.message||s.error);
        if(['failed','canceled','interrupted'].includes(s.phase))throw Error('文件处理未完成，请重新导入。');
        if(ready(s))return s;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      throw Error('文件处理仍未完成，请稍后重新读取。');
    }
    async function startFile(file){
      if(busy){cfg.toast('正在处理文件，请勿重复拖入。');return;}
      if(!file)return;if(!/\.xlsx$/i.test(file.name)){setError('请选择单个 .xlsx 销售报表。');return;}
      if(file.size===0||file.size>100*1024*1024){setError('文件为空或超过 100 MiB，请重新选择。');return;}
      const token=++epoch;snapshot=currentSnapshot();filename=file.name;busy=true;error='';notice='正在读取销售报表…';summary=null;bindings={};sourceKey='';additions=[];undoToken=null;resetDrag();paint();
      try{
        const created=await jobs().create('sales',{workspaceId:snapshot.workspaceId,storageEpoch:snapshot.storageEpoch,shopId:snapshot.shopId,planId:snapshot.planId,itemsFingerprint:snapshot.itemsFingerprint});
        if(token!==epoch)return;
        session=created;
        await jobs().upload(session.sessionId,file,{ownerToken:session.ownerToken});
        const s=await poll(s=>(s.candidateSheets||s.sheets||[]).length>0,token);if(token!==epoch)return;
        sheets=s.candidateSheets||s.sheets;revision=s.revision||0;sheetId=String(sheets[0].id??sheets[0].sheetId);selectColumns();step='mapping';notice='已识别销售字段，请核对后按尺寸汇总。';
      }catch(e){if(token===epoch)setError(message(e));}finally{if(token===epoch){busy=false;paint();}}
    }
    async function selectSheet(){
      if(busy)return;
      if(titleColumn===''||quantityColumn===''){setError('请选择商品 SKU 标题列和数量列。');return;}
      if(basis==='units'&&!unitsAcknowledged){setError('请确认按成交件数估算订单占比。');return;}
      const token=epoch;busy=true;error='';notice='正在按尺寸汇总所有图案…';paint();
      try{
        assertSnapshot();await jobs().selectSheet(session.sessionId,{ownerToken:session.ownerToken,sheetId,mapping:{...mapping,specName:Number(titleColumn),sales:Number(quantityColumn)},basis,matchBy:'size',expectedSessionRevision:revision});
        const s=await poll(s=>['reviewing','ready','completed'].includes(s.phase),token);if(token!==epoch)return;revision=s.revision||0;step='review';await refreshSummary(false);notice='';
      }catch(e){if(token===epoch)setError(message(e));}finally{if(token===epoch){busy=false;paint();}}
    }
    async function candidate(){assertSnapshot();return buildCandidate({getContext:()=>snapshot,planItems:[...snapshot.items,...additions.map(a=>({id:a.itemId,width:a.width,height:a.height}))],additions,skuFingerprint:snapshot.itemsFingerprint,fileJobs:jobs(),session,filename,period,basis,missingPolicy,unitsAcknowledged,matchBy:'size',sourceKey,bindings,revision});}
    async function refreshSummary(render=true){
      const token=epoch;if(render){if(busy)return;busy=true;error='';paint();}
      try{const result=await candidate();if(token!==epoch)return;summary=result;sourceKey=result.sourceKey||'';if(!period&&result.periods?.length===1)period=result.periods[0];revision=result.revision??revision;}
      catch(e){if(token===epoch){summary=null;setError(message(e));}}
      finally{if(render&&token===epoch){busy=false;paint();}}
    }
    function removeAddition(itemId){
      additions=additions.filter(a=>a.itemId!==itemId);
      for(const [key,binding] of Object.entries(bindings))if(binding.itemId===itemId)delete bindings[key];
    }
    async function addSize(rowId){
      if(busy||step!=='review')return;
      try{
        assertSnapshot();const row=summary?.groups.find(r=>String(r.rowId)===String(rowId));
        if(!row?.canAdd||!row.width||!row.height)return;
        const itemId='item-'+uid(),sizeId='size-'+uid();
        additions.push({itemId,sizeId,width:row.width,height:row.height});
        bindings[rowId]={rowId,itemId,excluded:false};await refreshSummary();
      }catch(e){setError(message(e));}
    }
    async function apply(){
      if(!canApply())return;const token=epoch;busy=true;step='applying';error='';paint();
      try{
        if(cfg.flush&&await cfg.flush()===false)throw Error('当前修改尚未保存，请稍后重试。');
        if(token!==epoch)return;const payload=await candidate();if(token!==epoch)return;if(!payload.ready)throw Error('请处理所有未匹配尺寸，并确认未出现的规格。');
        assertSnapshot();const c=context();if(!cfg.commit)throw Error('销售保存接口未接入。');
        const result=await cfg.commit(payload,{...c,expectedRevision:c.revision,sessionId:session.sessionId});
        if(token!==epoch)return;undoToken=result?.undoToken||result?.undo||undoToken;snapshot=currentSnapshot();additions=[];
        if(cfg.flush&&await cfg.flush()===false)throw Error('订单占比已更新，但尚未保存成功，请重试保存。');
        if(token!==epoch)return;step='done';cfg.toast('已按尺寸回填销量与订单占比');
      }catch(e){if(token===epoch){step='review';error=message(e);}}finally{if(token===epoch){busy=false;paint();}}
    }
    async function undoImport(){if(busy||!undoToken)return;const token=epoch;busy=true;paint();try{if(!cfg.undo)throw Error('当前窗口没有撤销接口。');await cfg.undo(undoToken,context());if(token!==epoch)return;undoToken=null;snapshot=currentSnapshot();additions=[];const ids=new Set(snapshot.items.map(i=>i.id));for(const [key,binding] of Object.entries(bindings))if(!binding.excluded&&!ids.has(binding.itemId))delete bindings[key];step='review';await refreshSummary(false);if(token!==epoch)return;notice='本次导入已撤销。';}catch(e){if(token===epoch)error=message(e);}finally{if(token===epoch){busy=false;paint();}}}
    function pickFile(){if(!busy)dialog?.querySelector('[data-sales-file]')?.click();}
    function onClick(e){
      if(e.target.matches?.('[data-sales-file]'))return;
      const t=e.target.closest?.('[data-sales-upload-trigger],[data-sales-start],[data-sales-map],[data-sales-apply],[data-sales-close],[data-sales-back],[data-sales-filter],[data-sales-prev],[data-sales-next],[data-sales-undo],[data-sales-retry],[data-sales-discard],[data-sales-add-size],[data-sales-remove-size]');if(!t||busy)return;
      if(t.matches('[data-sales-upload-trigger],[data-sales-start]'))pickFile();
      else if(t.matches('[data-sales-add-size]'))return addSize(t.dataset.salesAddSize);
      else if(t.matches('[data-sales-remove-size]')){removeAddition(t.dataset.salesRemoveSize);return refreshSummary();}
      else if(t.matches('[data-sales-map]'))return selectSheet();
      else if(t.matches('[data-sales-apply]'))return apply();
      else if(t.matches('[data-sales-close]'))close();
      else if(t.matches('[data-sales-discard]'))return discard();
      else if(t.matches('[data-sales-back]')){reset();snapshot=currentSnapshot();paint();}
      else if(t.matches('[data-sales-filter]')){filter=t.dataset.salesFilter;page=0;paint();}
      else if(t.matches('[data-sales-prev],[data-sales-next]')){page+=t.matches('[data-sales-prev]')?-1:1;paint();}
      else if(t.matches('[data-sales-retry]'))return refreshSummary();
      else if(t.matches('[data-sales-undo]'))return undoImport();
    }
    function onChange(e){
      const t=e.target;if(busy)return;
      if(t.matches('[data-sales-file]')){const files=Array.from(t.files||[]);if(files.length>1)setError('请每次只选择一个 .xlsx 文件。');else return startFile(files[0]);}
      else if(t.matches('[data-sales-period]'))onInput(e);
      else if(t.matches('[name=sales-basis]')){basis=t.value;unitsAcknowledged=false;chooseQuantity();paint();}
      else if(t.matches('[data-sales-units-ack]')){unitsAcknowledged=t.checked;paint();}
      else if(t.matches('[data-sales-sheet]')){sheetId=t.value;selectColumns();paint();}
      else if(t.matches('[data-sales-title-column]'))titleColumn=t.value;
      else if(t.matches('[data-sales-quantity-column]'))quantityColumn=t.value;
      else if(t.matches('[data-sales-source]')){sourceKey=t.value;page=0;additions=[];bindings={};return refreshSummary();}
      else if(t.matches('[data-sales-missing]')){missingPolicy=t.checked?'zero':'keep';return refreshSummary();}
      else if(t.matches('[data-sales-bind],[data-sales-exclude]')){
        const id=t.closest('[data-sales-row]')?.dataset.salesRow,row=summary?.groups.find(r=>String(r.rowId)===String(id));if(!row)return;
        if(additions.some(a=>a.itemId===row.itemId)&&(t.matches('[data-sales-exclude]')&&t.checked||t.matches('[data-sales-bind]')&&t.value!==row.itemId))removeAddition(row.itemId);
        bindings[id]={rowId:id,itemId:t.matches('[data-sales-bind]')?t.value:row.itemId,excluded:t.matches('[data-sales-exclude]')?t.checked:row.excluded};return refreshSummary();
      }
    }
    function onInput(e){if(!busy&&e.target.matches('[data-sales-period]')){period=e.target.value;const button=dialog?.querySelector('[data-sales-apply]');if(button)button.disabled=!canApply();}}
    function onKeyDown(e){if(e.target.matches?.('[data-sales-upload-trigger]')&&['Enter',' '].includes(e.key)){e.preventDefault();pickFile();}}
    function onCancel(e){e.preventDefault();close();}
    function fileDrag(e){return Array.from(e.dataTransfer?.types||[]).includes('Files')||e.dataTransfer?.files?.length;}
    function zoneFor(e){const z=e.target.closest?.('[data-sales-upload-trigger]');return z&&dialog?.contains(z)?z:null;}
    function resetDrag(){dragDepth=0;const zone=dialog?.querySelector('[data-sales-upload-trigger]');zone?.removeAttribute('data-dragging');const label=dialog?.querySelector('[data-sales-drop-label]');if(label)label.textContent='拖入销售报表，或点击选择';}
    function onDrag(e){if(!isOpen()||!fileDrag(e))return;e.preventDefault();const zone=zoneFor(e);if(e.dataTransfer)e.dataTransfer.dropEffect=zone&&!busy?'copy':'none';if(zone&&!busy){if(e.type==='dragenter')dragDepth++;zone.setAttribute('data-dragging','true');const label=dialog.querySelector('[data-sales-drop-label]');if(label)label.textContent='松开即可读取销售报表';}else resetDrag();}
    function onDragLeave(e){if(!isOpen()||!zoneFor(e))return;if(zoneFor(e).contains(e.relatedTarget))return;if(--dragDepth<=0)resetDrag();}
    async function onDrop(e){if(!isOpen()||!fileDrag(e))return;e.preventDefault();const zone=zoneFor(e);resetDrag();if(!zone)return;if(busy){cfg.toast('正在处理文件，请勿重复拖入。');return;}const files=Array.from(e.dataTransfer.files||[]),items=Array.from(e.dataTransfer.items||[]);if(items.some(i=>i.webkitGetAsEntry?.()?.isDirectory)){setError('不支持文件夹，请拖入一个 .xlsx 文件。');return;}if(files.length!==1){setError('请每次只拖入一个 .xlsx 文件。');return;}return startFile(files[0]);}
    const dialogEvents={click:onClick,change:onChange,input:onInput,keydown:onKeyDown,cancel:onCancel};
    const dragEvents={dragenter:onDrag,dragover:onDrag,dragleave:onDragLeave,drop:onDrop,dragend:resetDrag};
    const api={open,close,reset,destroy,html,paint,startFile,selectSheet,addSize,loadRows:refreshSummary,apply,undo:undoImport,buildCandidate:candidate,getSession:()=>session,getDraft:()=>({additions:additions.map(a=>({...a})),filename,period,basis,missingPolicy,unitsAcknowledged,bindings:{...bindings},rows:summary?.groups||[],summary}),isOpen,hasUnpersistedDraft:()=>!!session&&step!=='done',canQuit:()=>!busy&&!isOpen()&&(!session||step==='done')};
    return api;
  }
  root.SalesImportUI={create,buildCandidate};
  if(typeof module==='object')module.exports={create,buildCandidate};
})(typeof window==='object'?window:globalThis);
