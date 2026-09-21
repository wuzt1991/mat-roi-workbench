/* React Bits Lattice Loader, default 3 x 3 orbit, ported to the workbench DOM.
 * Original: https://reactbits.dev/c/micro/lattice-loader
 * Copyright (c) 2026 David Haz. See licenses/react-bits-lattice-loader.txt.
 * Keep the original CSS, cell order, delays and easing unchanged.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.LatticeLoader=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const cells=[0,1,2,7,null,3,6,5,4],marks=[2,3,5,7];
  const now=()=>root.performance?.now?.()??Date.now();
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=ds=>ds<600?`${(ds/10).toFixed(1)}s`:`${Math.floor(ds/600)}m ${((ds%600)/10).toFixed(1)}s`;
  function html({label='正在处理',startedAt=now()}={}){
    return `<span role="status" class="lattice-loader" data-status="working" data-shape="round" data-ll-started="${Number(startedAt)}"><span class="lattice-loader__grid" aria-hidden="true"><span class="lattice-loader__layer lattice-loader__run">${cells.map(unit=>`<span class="lattice-loader__cell" ${unit===null?'data-hole':`style="animation-delay:${unit*108}ms"`}></span>`).join('')}</span><span class="lattice-loader__layer lattice-loader__mark">${cells.map((_,i)=>`<span class="lattice-loader__cell" ${marks.includes(i)?'data-on':''}></span>`).join('')}</span></span><span class="lattice-loader__label" aria-hidden="true"><span class="lattice-loader__text" data-active>${escape(label)}</span><span class="lattice-loader__text">已完成</span><span class="lattice-loader__text">处理失败</span></span><span class="lattice-loader__timer" aria-hidden="true">${fmt(Math.max(0,Math.floor((now()-startedAt)/100)))}</span><span class="lattice-loader__sr">${escape(label)}，请稍候</span></span>`;
  }
  function create(){
    let interval=null;
    const stop=()=>{if(interval!==null)root.clearInterval(interval);interval=null;};
    function activate(scope){
      stop();
      const loaders=Array.from(scope?.querySelectorAll?.('.lattice-loader[data-status="working"]')||[]);
      if(!loaders.length)return;
      const paint=()=>{for(const node of loaders){const target=node.querySelector('.lattice-loader__timer');if(target)target.textContent=fmt(Math.max(0,Math.floor((now()-Number(node.dataset.llStarted))/100)));}};
      // The workbench replaces page markup on polling. Resume the original CSS
      // animation timeline instead of replaying its first frame on every render.
      for(const node of loaders){const elapsed=Math.max(0,now()-Number(node.dataset.llStarted));for(const cell of node.querySelectorAll('.lattice-loader__run .lattice-loader__cell'))for(const animation of cell.getAnimations())animation.currentTime=elapsed;}
      paint();interval=root.setInterval(paint,100);
    }
    return {html,activate,stop};
  }
  return {html,create,now};
});
