(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductTransferUI=api;})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const Model=typeof module==='object'&&module.exports?require('./product-transfer/model.js'):root.ProductTransferModel;
  const Controller=typeof module==='object'&&module.exports?require('./product-transfer/controller.js'):root.ProductTransferController;
  const Views=typeof module==='object'&&module.exports?require('./product-transfer/views.js'):root.ProductTransferViews;
  const Loader=typeof module==='object'&&module.exports?require('./lattice-loader.js'):root.LatticeLoader;
  const {Recognition,PAGE_SIZE,KEEP,REQUIRED_PRODUCT_FIELDS,htmlEscape,text,number,array,active,truncateId,fieldObject,materialId,thicknessId,countValue,canonicalRules}=Model;
  function create(options={}){
    const getState=options.getState||(()=>({})),notify=options.toast||(()=>{}),waitingLoader=Loader.create();
    const controller=Controller.create({...options,ports:{
      now:Loader.now,readPreference:key=>root.localStorage?.getItem(key),writePreference:(key,value)=>root.localStorage?.setItem(key,value),
      replace:showReplacement,openMapping,closeDialog,
      download(url){const link=root.document.createElement('a');link.href=url;link.download='';link.rel='noopener';root.document.body.append(link);link.click();link.remove();},
      activate(){bind();ensureDialog();waitingLoader.activate(root.document?.querySelector('[data-product-v4]'));root.lucide?.createIcons?.();},
      deactivate(){waitingLoader.stop();resetDrop();closeDialog();}
    }});
    const local=controller.state;
    const {checkPending,target,scheduleRender,refreshPage,resetGroup,startImport,candidateSheets,sheetMapping,sheetIssues,chooseSheet,useCandidate,discardCandidate,cancelJob,applyReview,undo,exportFile,download,materialById,summary,submitUniform,searchProducts,recompute,refreshContext,restoreSession,isBusy,canQuit,inspect}=controller;
    const views=Views.create({state:local,getState,selectors:controller,waitingHtml:options=>waitingLoader.html(options)});
    const {materialOptions,thicknessOptions,dialogShell}=views;
    function showReplacement(file){local.dialog={type:'replace',file,revision:local.session.revision};const dialog=ensureDialog();dialog.innerHTML=dialogShell('替换当前文件？',`<p>当前 ${htmlEscape(local.session.filename||'文件')} 还有 ${countValue(local.page,'pending')} 条待处理。新文件读取成功后将替换当前会话；失败或取消会保留当前文件。</p>`,'继续导入');dialog.showModal();}
    function ensureDialog(){
      if(!root.document)return null;
      let dialog=root.document.getElementById('product-v4-dialog');
      if(!dialog){dialog=root.document.createElement('dialog');dialog.id='product-v4-dialog';dialog.className='pv4-dialog';dialog.setAttribute('aria-labelledby','pv4-dialog-title');root.document.body.append(dialog);dialog.addEventListener('cancel',event=>{if(local.busy)event.preventDefault();});dialog.addEventListener('click',dialogClick);dialog.addEventListener('change',dialogChange);dialog.addEventListener('input',dialogInput);dialog.addEventListener('close',()=>{if(dialog.open)return;local.dialog=null;local.lastFocus?.focus?.({preventScroll:true});local.lastFocus=null;});}
      return dialog;
    }
    function closeDialog(force=false){if(!force&&local.busy)return;const dialog=ensureDialog();local.dialog=null;if(dialog?.open)dialog.close();}
    function openRow(rowId){
      if(local.busy)return;if(local.pageStale){notify('请先刷新列表，再修改规格。');return;}const row=array(local.groupRows?.rows).find(r=>String(r.rowId)===String(rowId));if(!row)return;
      local.lastFocus=root.document.activeElement;local.dialog={type:'row',row,revision:local.session.revision};
      const material=materialId(row),size=fieldObject(row,'size'),dialog=ensureDialog();
      dialog.innerHTML=dialogShell('调整这条规格',`<div class="pv5-edit-source"><h3>${htmlEscape(row.derived.productName)}</h3><p>${htmlEscape(row.derived.specName)}</p><small>SKU ${htmlEscape(row.derived.skuId)} · 原表第 ${row.sourceRow} 行</small></div><div class="pv5-edit-grid"><label>材质<select name="edit-material">${materialOptions(material,{allowBlank:false,compact:false})}</select></label><label>厚度<select name="edit-thickness" ${material?'':'disabled'}>${thicknessOptions(material,thicknessId(row))}</select></label><label>宽 / cm<input name="edit-width" type="number" min="0" max="10000" step="any" value="${size.status==='value'?size.width:''}"></label><label>长 / cm<input name="edit-length" type="number" min="0" max="10000" step="any" value="${size.status==='value'?size.length:''}"></label></div>${row.derived.issues?.some(i=>['MISSING_FIELD','INVALID_RULE'].includes(i.code))?`<p class="pv5-note">${htmlEscape(row.derived.issues.filter(i=>['MISSING_FIELD','INVALID_RULE'].includes(i.code)).map(i=>i.message).join('；'))}。原表缺失信息请补齐后重新导入；规则成本和重量请在可复用规则中补齐。</p>`:''}<p class="pv5-note">只修改这一条规格，其余商品保持不变。</p>`,'保存修改');dialog.showModal();dialog.querySelector('select')?.focus();
    }
    async function submitRow(form,error){
      const snapshot=local.dialog,row=snapshot.row;let patch;
      try{patch=Model.rowPatch(row,{material:form.elements['edit-material'].value,rule:form.elements['edit-thickness'].value,width:form.elements['edit-width'].value,length:form.elements['edit-length'].value});}catch(failure){error.textContent=failure.message;return;}
      if(!Object.keys(patch).length){closeDialog();return;}
      const controls=[...form.querySelectorAll('input,select,button')];controls.forEach(e=>e.disabled=true);const result=await applyReview({type:'row-edit',rowIds:[row.rowId],patch});if(local.dialog!==snapshot)return;
      if(result)closeDialog();else{controls.forEach(e=>e.disabled=false);error.textContent=local.error||'修改未保存，请重试。';}
    }
    function openGroup(groupId){
      if(local.pageStale){notify('请先刷新列表，再统一修改。');return;}const group=array(local.page?.groups).find(g=>g.groupId===groupId);if(!group||local.busy)return;
      local.lastFocus=root.document.activeElement;local.dialog={type:'group',group,revision:local.session.revision};
      const material=materialById(group.materialState),dialog=ensureDialog();
      dialog.innerHTML=dialogShell('统一修改此商品',`<div class="pv5-edit-source"><h3>${htmlEscape(group.productName)}</h3><p>${htmlEscape(group.platform)} · ${htmlEscape(group.shop)} · 商品 ${htmlEscape(group.productId||'ID 未提供')}</p><small>将应用到此商品全部 ${group.total} 条 SKU，包含未展开及未匹配搜索的规格。</small></div><div class="pv5-edit-grid"><label>材质<select name="group-material"><option value="${KEEP}">保留各 SKU 原材质</option>${materialOptions('',{allowBlank:false,placeholder:false,compact:false})}</select></label><label>厚度<select name="group-thickness" ${material?'':'disabled'}><option value="${KEEP}">保留各 SKU 原厚度</option>${material?thicknessOptions(material.id,'',{placeholder:false}):''}</select></label></div><p class="pv5-note" data-pv6-group-note>${material?'只覆盖你选择修改的字段，个别 SKU 的厚度例外也会被所选厚度覆盖。':'此商品包含多种或未确认材质，请先选择统一材质，再选择对应厚度。'}</p>`,'应用到全部 SKU');dialog.showModal();dialog.querySelector('select')?.focus();
    }
    async function submitGroup(form,error){
      const snapshot=local.dialog,group=snapshot.group;let patch;
      try{patch=Model.groupPatch(group,{material:form.elements['group-material'].value,thickness:form.elements['group-thickness'].value});}catch(failure){error.textContent=failure.message;return;}
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
      if(button.matches('[data-pv7-refresh]')){await refreshPage();return;}
      if(button.matches('[data-pv7-reconcile]')){await checkPending();return;}
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
    function destroy(){
      waitingLoader.stop();resetDrop();controller.destroy();
      if(local.listeners&&root.document){for(const [type,handler] of Object.entries({click:documentClick,change:documentChange,submit:dialogSubmit,dragenter:documentDragOver,dragover:documentDragOver,dragleave:documentDragLeave,drop:documentDrop,dragend:resetDrop}))root.document.removeEventListener(type,handler);}
      local.dialog=null;root.document?.getElementById('product-v4-dialog')?.remove();
    }
    const api={html:views.html,activate(context){controller.activate(context);return api;},deactivate:controller.deactivate,refreshContext(context,settings){controller.refreshContext(context,settings);return api;},async restoreSession(session){await controller.restoreSession(session);return api;},refresh:controller.refreshPage,isBusy:controller.isBusy,canQuit:controller.canQuit,destroy,inspect:controller.inspect};
    return api;
  }
  return {create,truncateId,canonicalRules,PAGE_SIZE};

});
