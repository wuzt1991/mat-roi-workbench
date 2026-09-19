/* Anchored sidebar pickers; the original select remains the single value source. */
(function(root){
  'use strict';
  let active=null;
  const icon=(name)=>{const node=document.createElement('i');node.dataset.lucide=name;node.className='icon';node.setAttribute('aria-hidden','true');return node;};
  function close(returnFocus=false){
    if(!active)return;
    const {trigger,panel}=active;active=null;
    trigger.setAttribute('aria-expanded','false');
    if(panel.matches(':popover-open'))panel.hidePopover();panel.remove();
    if(returnFocus&&trigger.isConnected)trigger.focus({preventScroll:true});
  }
  function position(){
    if(!active)return;
    const {trigger,panel}=active,rect=trigger.getBoundingClientRect(),edge=8,gap=6;
    if(rect.bottom<=edge||rect.top>=innerHeight-edge||rect.width===0){close();return;}
    const width=Math.min(rect.width,innerWidth-2*edge),left=Math.max(edge,Math.min(rect.left,innerWidth-width-edge));
    panel.style.width=width+'px';
    const wanted=Math.min(panel.scrollHeight,260),below=innerHeight-rect.bottom-gap-edge,above=rect.top-gap-edge;
    const up=below<wanted&&above>below,available=Math.max(0,up?above:below);
    panel.style.maxHeight=Math.min(260,available)+'px';panel.style.left=left+'px';
    const height=Math.min(wanted,available);panel.style.top=(up?rect.top-gap-height:rect.bottom+gap)+'px';panel.dataset.placement=up?'above':'below';
  }
  function open(select,trigger,focusLast=false){
    if(active?.trigger===trigger){close(true);return;}
    close();if(select.disabled)return;
    const panel=document.createElement('div');panel.id=select.id+'-listbox';panel.className='sidebar-picker-menu';panel.setAttribute('role','listbox');panel.setAttribute('aria-label',trigger.dataset.label);panel.setAttribute('popover','manual');
    const options=[...select.options].filter(x=>!x.disabled&&!x.hidden);
    for(const option of options){const item=document.createElement('button');item.type='button';item.className='sidebar-picker-option';item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.tabIndex=-1;item.dataset.value=option.value;item.title=option.textContent;
      const text=document.createElement('span');text.textContent=option.textContent;item.append(text,icon('check'));panel.append(item);
      item.addEventListener('click',()=>{const value=option.value;close();if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('#'+select.id+'-trigger')?.focus({preventScroll:true});});
    }
    document.body.append(panel);active={select,trigger,panel};trigger.setAttribute('aria-expanded','true');if(panel.showPopover)panel.showPopover();position();root.lucide?.createIcons();
    const items=[...panel.children],selected=items.find(x=>x.getAttribute('aria-selected')==='true');(focusLast?items.at(-1):selected||items[0])?.focus({preventScroll:true});
    (focusLast?items.at(-1):selected||items[0])?.scrollIntoView({block:'nearest'});
    panel.addEventListener('keydown',event=>{
      const index=items.indexOf(document.activeElement);let next;
      if(event.key==='ArrowDown')next=(index+1)%items.length;
      if(event.key==='ArrowUp')next=(index-1+items.length)%items.length;
      if(event.key==='Home')next=0;if(event.key==='End')next=items.length-1;
      if(next!==undefined){event.preventDefault();items[next]?.focus({preventScroll:true});items[next]?.scrollIntoView({block:'nearest'});}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      else if(event.key==='Tab'){close(true);}
      else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&event.key!==' '){const match=[...items.slice(index+1),...items.slice(0,index+1)].find(x=>x.textContent.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));if(match){event.preventDefault();match.focus({preventScroll:true});match.scrollIntoView({block:'nearest'});}}
    });
  }
  function refresh(){
    close();
    for(const id of ['active-shop','active-plan']){
      const select=document.getElementById(id);if(!select||document.getElementById(id+'-trigger'))continue;
      const label=document.querySelector(`label[for="${id}"]`),trigger=document.createElement('button');trigger.type='button';trigger.id=id+'-trigger';trigger.className='sidebar-picker-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id+'-listbox');trigger.disabled=select.disabled;trigger.dataset.label=label?.textContent||'';trigger.setAttribute('aria-label',trigger.dataset.label+'：'+(select.selectedOptions[0]?.textContent||''));
      const text=document.createElement('span');text.textContent=select.selectedOptions[0]?.textContent||'暂无计划';trigger.title=text.textContent;trigger.append(text,icon('chevron-down'));
      select.hidden=true;select.setAttribute('aria-hidden','true');select.tabIndex=-1;select.insertAdjacentElement('afterend',trigger);if(label)label.htmlFor=trigger.id;
      trigger.addEventListener('click',()=>open(select,trigger));trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(select,trigger,event.key==='ArrowUp');}});
    }
    root.lucide?.createIcons();
  }
  document.addEventListener('pointerdown',event=>{if(active&&!active.panel.contains(event.target)&&!active.trigger.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(active&&!active.panel.contains(event.target)&&!active.trigger.contains(event.target))close();});
  document.addEventListener('scroll',event=>{if(active&&!active.panel.contains(event.target))position();},true);
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
  root.ScopePickers={refresh,close};
})(window);
