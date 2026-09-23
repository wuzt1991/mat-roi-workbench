(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductTransferViews=api;})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const Model=typeof module==='object'&&module.exports?require('./model.js'):root.ProductTransferModel;
  const {BLANK,CUSTOM,KEEP,CHOOSE,INLINE_OPTION_LIMIT,REQUIRED_PRODUCT_FIELDS,htmlEscape,text,number,array,active,icon,materialId,thicknessId,money,countValue,thicknessLabel}=Model;
  function create({state:local,getState,selectors,waitingHtml}){
    const {materials,materialById,thicknessSetup,summary,setupMaterials,candidateSheets,sheetIssues,candidateReady,needsSheet}=selectors;
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
    function statusLabel(row){
      const value=text(row?.status||row?.derived?.status).toLowerCase();
      if(value==='confirmed'||value==='ready'||value==='value')return ['已确认','confirmed'];
      if(value==='error'||array(row?.derived?.errors).length)return ['有错误','error'];
      return ['待复核','pending'];
    }
    function progressHtml(status){
      const progressState=status?.job?.progress||status?.progress||{};
      const completed=number(progressState.bytesRead??progressState.rowsCommitted??progressState.rowsRead);
      const total=number(progressState.bytesTotal??progressState.rowsTotal);
      const rawPercent=progressState.percent??status?.percent;
      const percent=rawPercent!==undefined?number(rawPercent):completed!==null&&total>0?completed/total*100:null;
      const progress=percent===null?'':`${Math.max(0,Math.min(100,percent)).toFixed(0)}%`;
      const label=local.waitLabel||'正在处理商品表';
      return `<div class="pv4-progress pv4-lattice-wait">${waitingHtml({label,startedAt:local.waitStartedAt})}${progress?`<span class="pv4-wait-percent">${progress}</span>`:''}${local.jobId?`<button type="button" class="btn ghost" data-pv4-cancel>${icon('x')}取消</button>`:''}</div>`;
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
    function fileInput(label='选择 Excel',primary=false){return `<label class="btn ${primary?'primary':''} pv4-file-button">${icon('file-up')}${label}<input type="file" name="product-file" accept=".xlsx" aria-label="选择商品 Excel 文件" data-pv4-file ${local.busy?'disabled':''}></label>`;}
    function unknownHtml(){
      const s=summary();if(!s.unknown)return '';
      const example=array(s.unknownGroups).slice(0,3).map(g=>g.productName).join('、');
      const options=materialOptions([CUSTOM,KEEP].includes(local.unknownMaterial)?'':local.unknownMaterial,{allowBlank:false,compact:false}).replace('请选择材质','请选择这些商品的材质');
      const groups=local.unknownMaterial===CUSTOM?`<div class="pv5-unknown-list">${array(s.unknownGroups).map(g=>`<label class="pv5-unknown-row"><span><strong>${htmlEscape(g.productName)}</strong><small>${htmlEscape(g.examples.join(' / '))} · ${g.count} 条规格</small></span><select name="group-material" aria-label="${htmlEscape(g.productName)}的材质" data-pv5-assign="${htmlEscape(g.groupId)}" ${local.busy?'disabled':''}>${materialOptions(local.materialAssignments[g.groupId]===KEEP?'':local.materialAssignments[g.groupId]||'',{allowBlank:false,compact:false})}<option value="${KEEP}" ${local.materialAssignments[g.groupId]===KEEP?'selected':''}>复杂情况，稍后处理</option></select></label>`).join('')}</div>${s.totalPages>1?`<div class="pv5-material-pager"><button type="button" class="btn ghost" data-pv5-material-page="${s.page-1}" ${s.page<=1||local.busy?'disabled':''}>上一页</button><span>${s.page} / ${s.totalPages} 页</span><button type="button" class="btn ghost" data-pv5-material-page="${s.page+1}" ${s.page>=s.totalPages||local.busy?'disabled':''}>下一页</button></div>`:''}`:'';
      return `<section class="pv5-unknown"><div><h3>先确认 ${s.unknown} 条规格的材质</h3><p>原文未标明材质，或同时出现多个材质。${htmlEscape(example)}${s.groupCount>3?'等':''}。</p></div><label class="pv5-unknown-choice"><span>这些商品的材质</span><select name="unknown-material" data-pv5-unknown ${local.busy?'disabled':''}>${options}<option value="${CUSTOM}" ${local.unknownMaterial===CUSTOM?'selected':''}>材质不同，分别指定</option><option value="${KEEP}" ${local.unknownMaterial===KEEP?'selected':''}>复杂情况，稍后手动处理</option></select></label>${groups}</section>`;
    }
    function setupHtml(){
      const entries=setupMaterials();
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
      const step=!local.session?1:thicknessSetup()?2:3;
      return `<div class="product-v4 product-v5" data-product-v4><div class="page-header"><div class="page-heading"><h1>商品转表</h1><p class="page-sub">导入商品表，统一厚度，确认导出。</p></div></div><div class="pv5-content"><ol class="pv5-steps" role="list">${['导入表格','材质与厚度','确认导出'].map((label,i)=>`<li ${step===i+1?'aria-current="step"':''} data-complete="${step>i+1}"><span>${i+1}</span>${label}</li>`).join('')}</ol>${local.session?`<section class="pv5-file" data-pv4-dropzone aria-label="商品 Excel 上传区域">${icon('file-spreadsheet')}<div><strong class="pv4-current-file">${htmlEscape(local.session.filename||'当前商品表')}</strong><p>${countValue(local.page,'total')} 条规格</p></div>${fileInput('换一份表')}</section>`:!local.busy&&!local.candidate?`<section class="pv5-upload" data-pv4-dropzone aria-label="商品 Excel 上传区域"><div class="pv4-drop-hint"><h2>把商品 Excel 拖到这里</h2><p>支持 .xlsx，导入后只需按材质统一一次厚度。</p><strong>松开即可导入 Excel</strong></div>${fileInput('选择 Excel',true)}</section>`:`<section class="pv5-file" data-pv4-dropzone aria-label="商品 Excel 上传区域"><strong>正在读取商品表</strong>${fileInput('选择 Excel')}</section>`}${local.busy?progressHtml(local.waitStatus||local.candidateStatus):''}${candidateHtml()}${local.pageStale?'<p class="pv5-note" role="status">列表尚未刷新，当前显示上次读取的结果。<button type="button" class="btn" data-pv7-refresh>刷新列表</button></p>':''}${local.pendingOutcome?'<p class="pv5-note" role="status">有一项修改结果待核对。<button type="button" class="btn" data-pv7-reconcile>核对上次结果</button></p>':''}${local.error?`<div class="pv4-error" role="alert">${htmlEscape(local.error)}<button type="button" class="icon-btn" data-pv4-dismiss aria-label="关闭提示">${icon('x')}</button></div>`:''}${local.session&&!local.candidate?(thicknessSetup()?setupHtml():local.manual?manualHtml():local.busy?'':resultHtml()):''}</div></div>`;
    }
    function dialogShell(title,body,submitLabel='应用修改'){
      return `<form method="dialog" data-pv4-dialog-form><div class="pv4-dialog-head"><h2 id="pv4-dialog-title">${htmlEscape(title)}</h2><button type="button" class="icon-btn" data-pv4-dialog-close aria-label="关闭">${icon('x')}</button></div><div class="pv4-dialog-body">${body}<p class="pv4-dialog-error" role="alert" data-pv4-dialog-error></p></div><div class="pv4-dialog-foot"><button type="button" class="btn ghost" data-pv4-dialog-close>取消</button><button type="submit" class="btn primary">${htmlEscape(submitLabel)}</button></div></form>`;
    }
    return {html,materialOptions,thicknessOptions,dialogShell};
  }
  return {create};
});
