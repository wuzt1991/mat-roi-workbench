'use strict';
const assert=require('node:assert/strict'),path=require('node:path');

// Hold a real upload at the network boundary to inspect an actual waiting state.
// The fixture remains synthetic and the request continues to the real file service.
async function verifyWaitingUpload(page,file,out,label){
 let release,ready,finished;const gate=new Promise(resolve=>{release=resolve;}),requested=new Promise(resolve=>{ready=resolve;});
 const pattern='**/api/file-sessions/*/source',handler=route=>{finished=(async()=>{ready();await gate;await route.continue();})();return finished;};
 await page.route(pattern,handler);
 try{
  await page.evaluate(()=>{UiAppearance.setMode('rays');UiAppearance.setMotion(true);});
  await page.locator('[data-pv4-file]').setInputFiles(file);await requested;
  const loader=page.locator('.pv4-lattice-wait .lattice-loader');await loader.waitFor();
  assert.equal(await page.locator('[data-pv4-file]').isDisabled(),true);
  const geometry=await loader.evaluate(el=>{
   const grid=el.querySelector('.lattice-loader__grid').getBoundingClientRect(),cells=[...el.querySelectorAll('.lattice-loader__run .lattice-loader__cell')];
   return {width:grid.width,height:grid.height,font:getComputedStyle(el).fontSize,cells:cells.map(cell=>{const c=getComputedStyle(cell);return {hole:cell.hasAttribute('data-hole'),width:c.width,height:c.height,radius:c.borderRadius,color:c.backgroundColor,delay:c.animationDelay,duration:c.animationDuration,easing:c.animationTimingFunction,name:c.animationName};})};
  });
  assert.equal(geometry.width,22);assert.equal(geometry.height,22);assert.equal(geometry.font,'14px');assert.equal(geometry.cells.length,9);
  const units=[0,1,2,7,null,3,6,5,4];
  geometry.cells.forEach((cell,i)=>{assert.equal(cell.width,'6px');assert.equal(cell.height,'6px');assert.equal(cell.radius,'50%');assert.equal(cell.color,'rgb(245, 245, 245)');assert.equal(cell.hole,units[i]===null);if(!cell.hole){assert.equal(Math.round(parseFloat(cell.delay)*1000),units[i]*108);assert.equal(cell.duration,'0.864s');assert.equal(cell.easing,'cubic-bezier(0.77, 0, 0.175, 1)');assert.equal(cell.name,'lattice-on');}});
  const started=await loader.getAttribute('data-ll-started');
  await page.waitForFunction(()=>parseFloat(document.querySelector('.lattice-loader__timer').textContent)>=0.3);
  await page.locator('[data-action="ledger-view"]').click();assert.equal(await loader.count(),0);
  // Slow first paint reproduces the pending-play drift observed on Windows.
  await page.evaluate(()=>window.addEventListener('click',()=>{const until=performance.now()+350;while(performance.now()<until){}},{once:true}));
  await page.locator('[data-action="product-view"]').click();await loader.waitFor();
  assert.equal(await loader.getAttribute('data-ll-started'),started);
  const elapsed=await loader.evaluate(el=>({timer:parseFloat(el.querySelector('.lattice-loader__timer').textContent),animations:[...el.querySelectorAll('.lattice-loader__run .lattice-loader__cell')].flatMap(cell=>cell.getAnimations().map(a=>({currentTime:a.currentTime,startTime:a.startTime,pending:a.pending}))),timeline:document.timeline.currentTime,started:Number(el.dataset.llStarted)}));
  assert.ok(elapsed.timer>=0.3);assert.equal(elapsed.animations.length,8);
  for(const animation of elapsed.animations){assert.equal(animation.pending,false,JSON.stringify(elapsed));assert.ok(Math.abs(animation.startTime-elapsed.started)<1,'Animation start must survive delayed paint: '+JSON.stringify(elapsed));assert.ok(Math.abs(animation.currentTime-(elapsed.timeline-elapsed.started))<1,'Animation timeline must survive page replacement: '+JSON.stringify(elapsed));}
  await page.locator('.pv4-lattice-wait').screenshot({path:path.join(out,`lattice-${label}-rays.png`)});
  await page.evaluate(()=>UiAppearance.setMode('day'));
  await page.locator('.pv4-lattice-wait').screenshot({path:path.join(out,`lattice-${label}-day.png`)});
  await page.setViewportSize({width:390,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>UiAppearance.setMotion(false));assert.equal(await loader.evaluate(el=>el.getAnimations({subtree:true}).length),0);
  assert.ok(await loader.isVisible());
  await page.setViewportSize({width:1440,height:850});
  return {passed:true,geometry,timerSurvivesRerender:true,animationSurvivesRerender:true,delayedPaintPreservesTimeline:true,disabledDuringUpload:true,dayAndRays:true,narrowWindow:true,motionPreferenceRespected:true};
 }finally{release();await finished;await page.unroute(pattern,handler);}
}
module.exports={verifyWaitingUpload};
