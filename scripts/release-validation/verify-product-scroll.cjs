'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MAT_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'../..');
const out=process.env.MAT_VERIFY_OUTPUT||path.resolve('outputs/product-scroll');fs.mkdirSync(out,{recursive:true});
const {createServer}=require(path.join(root,'server/index.cjs'));
const source=process.env.MAT_PRODUCT_SCROLL_SOURCE;
async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-product-scroll-')),installed=process.env.MAT_SCROLL_INSTALLED;let server,child,browser,page,url;
 const label=process.env.MAT_VERIFY_LABEL||'source',checks=[];let lattice;
 try{
  if(installed){
   const {spawn}=require('node:child_process'),env={...process.env,MAT_DATA_DIR:directory,MAT_PORT:'4187'};delete env.ELECTRON_RUN_AS_NODE;
   child=spawn(installed,['--remote-debugging-port=9226'],{env,stdio:'ignore'});child.on('error',error=>{console.error(error);});url='http://127.0.0.1:4187';
   const deadline=Date.now()+45000;while(true){try{const health=await(await fetch(url+'/api/health')).json();assert.equal(health.dataDir,directory);break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
   browser=await chromium.connectOverCDP('http://127.0.0.1:9226');page=browser.contexts()[0].pages()[0];await page.waitForURL(url+'/**');await page.setViewportSize({width:1440,height:850});
  }else{server=createServer({port:0,dataDir:directory});url=await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:850}});}
  const workspace=async()=>await(await fetch(url+'/api/state')).json(),before=await workspace();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'&&message.text().includes('[workbench] file session draft'))errors.push(message.text());});
  await page.goto(url);await page.evaluate(()=>UiAppearance.setMotion(false));await page.locator('[data-action="product-view"]').click();
  const automatic=await require('./verify-product-auto.cjs').verifyProductAuto(page,out,label,root);lattice=automatic.lattice;
  const settled=()=>page.waitForFunction(()=>{const last=window.__scrollCheck||{},y=scrollY;window.__scrollCheck={y,n:last.y===y?(last.n||0)+1:0};return window.__scrollCheck.n>=6;});
  for(const mode of ['rays','day'])for(const width of [1440,1024,842,390]){
   await page.setViewportSize({width,height:850});await page.evaluate(mode=>{UiAppearance.setMode(mode);scrollTo(0,0);},mode);await page.locator('.pv6-product').first().scrollIntoViewIfNeeded();const box=await page.locator('.pv6-product').first().boundingBox();await page.mouse.move(box.x+Math.min(box.width/2,150),Math.min(600,box.y+40));const start=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,650);await page.waitForFunction(start=>scrollY>start+100,start);await settled();const lower=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,-300);try{await page.waitForFunction(lower=>scrollY<lower-80,lower,{timeout:3000});}catch{throw Error('Upward scrolling failed: '+JSON.stringify({mode,width,start,lower,after:await page.evaluate(()=>scrollY)}));}await settled();for(let i=0;i<40;i++){await page.mouse.wheel(0,2200);if(await page.evaluate(()=>scrollY+innerHeight>=document.documentElement.scrollHeight-2))break;}await page.waitForFunction(()=>scrollY+innerHeight>=document.documentElement.scrollHeight-2);assert.ok(await page.locator('.pv6-product').last().isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push({mode,width,down:true,up:true,lastRowReached:true,noHorizontalOverflow:true});if(width===1440)await page.screenshot({path:path.join(out,`scroll-bottom-${label}-${mode}.png`)});
  }
  await page.setViewportSize({width:1440,height:850});for(let n=2;n<=7;n++){await page.locator(`[data-pv4-page="${n}"]`).click();await page.waitForFunction(n=>!document.querySelector('.pv4-lattice-wait')&&document.querySelector('.pv4-pager').textContent.includes(`第 ${n} / 7 页`),n);}assert.equal(await page.locator('.pv6-product').count(),20);await page.reload();await page.locator('[data-action="product-view"]').click();await page.locator('[data-pv4-export]').waitFor();assert.match(await page.locator('.pv4-current-file').innerText(),/scroll-final-140/);assert.deepEqual(await workspace(),before);assert.deepEqual(errors,[]);
  const report={passed:true,lattice,automatic,root,host:process.platform,installedWindow:!!installed,sourceKind:source?'user-supplied':'synthetic',workbookRows:140,productPages:7,checks,paginationReached:true,sessionRestoredAfterReload:true,scrollDoesNotChangeSessionOrWorkspace:true,errors};fs.writeFileSync(path.join(out,`scroll-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){if(page)await page.screenshot({path:path.join(out,`scroll-failure-${label}.png`)});throw error;}finally{await browser?.close();if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,5000);});}await server?.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
