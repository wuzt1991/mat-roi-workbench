'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MAT_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'../..');
const out=process.env.MAT_VERIFY_OUTPUT||path.resolve('outputs/product-scroll');fs.mkdirSync(out,{recursive:true});
const {createServer}=require(path.join(root,'server/index.cjs'));
const source=process.env.MAT_PRODUCT_SCROLL_SOURCE;
async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-product-scroll-')),installed=process.env.MAT_SCROLL_INSTALLED;let server,child,browser,page,url;
 const label=process.env.MAT_VERIFY_LABEL||'source',checks=[];
 try{
  if(installed){
   const {spawn}=require('node:child_process'),env={...process.env,MAT_DATA_DIR:directory,MAT_PORT:'4187'};delete env.ELECTRON_RUN_AS_NODE;
   child=spawn(installed,['--remote-debugging-port=9226'],{env,stdio:'ignore'});child.on('error',error=>{console.error(error);});url='http://127.0.0.1:4187';
   const deadline=Date.now()+45000;while(true){try{const health=await(await fetch(url+'/api/health')).json();assert.equal(health.dataDir,directory);break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
   browser=await chromium.connectOverCDP('http://127.0.0.1:9226');page=browser.contexts()[0].pages()[0];await page.waitForURL(url+'/**');await page.setViewportSize({width:1440,height:850});
  }else{server=createServer({port:0,dataDir:directory});url=await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:850}});}
  const workspace=async()=>await(await fetch(url+'/api/state')).json(),before=await workspace();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.evaluate(()=>UiAppearance.setMotion(false));await page.locator('[data-action="product-view"]').click();
  const importFile=async file=>{await page.locator('[data-pv4-file]').setInputFiles(file);await page.locator('[data-pv4-use]').click();await page.locator('.pv4-table tbody tr').first().waitFor();};
  const Excel=require(path.join(root,'public/assets/exceljs.min.js'));let sourceBytes;
  if(source)sourceBytes=fs.readFileSync(source);else{
   const sample=new Excel.Workbook(),sheet=sample.addWorksheet('ERP');sheet.addRow(require(path.join(root,'public/product-recognition.js')).OUTPUT_HEADERS);
   for(let i=0;i<60;i++){const row=Array(29).fill('');Object.assign(row,{0:i+1,1:'测试平台',2:'自动生成样本店铺',3:'吸水防滑地垫 测试图案 '+(i%12),4:['40×60cm','45×70cm','50×80cm','60×90cm','80×100cm'][i%5]+' 硅藻泥 加厚',17:'00000000000000000001',18:'0000000000000000'+i,19:15.8,20:'在售',21:999999});sheet.addRow(row);}sourceBytes=Buffer.from(await sample.xlsx.writeBuffer());
  }
  await importFile({name:'scroll-60-rows.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:sourceBytes});
  const measure=()=>page.evaluate(()=>{const e=document.querySelector('.pv4-table-scroll');return {top:scrollY,left:e.scrollLeft,height:e.clientHeight,scrollHeight:e.scrollHeight,overscrollY:getComputedStyle(e).overscrollBehaviorY};});
  const hoverTable=async()=>{const box=await page.locator('.pv4-table-scroll').boundingBox();await page.mouse.move(Math.max(350,box.x+60),Math.max(200,Math.min(700,box.y+160)));};
  assert.match(await page.locator('.pv4-actions').innerText(),/本页 60 条/);
  const sessionRows=async()=>page.evaluate(async()=>{const list=await(await fetch('/api/file-sessions')).json();const session=list.items.filter(i=>i.kind==='product').at(-1);return (await(await fetch(`/api/file-sessions/${session.sessionId}/rows`)).json()).rows;});
  const rowsBefore=await sessionRows();
  for(const mode of ['rays','day'])for(const width of [1440,1024,842,390]){
   await page.setViewportSize({width,height:850});await page.evaluate(mode=>{UiAppearance.setMode(mode);scrollTo(0,0);},mode);
   await page.locator('.pv4-table').scrollIntoViewIfNeeded();await page.evaluate(()=>scrollTo(0,Math.max(0,document.querySelector('.pv4-table-scroll').getBoundingClientRect().top+scrollY-300)));
   const box=await page.locator('.pv4-table-scroll').boundingBox();await page.mouse.move(box.x+60,Math.min(650,box.y+150));
   const start=await measure();await page.mouse.wheel(0,650);
   try{await page.waitForFunction(y=>scrollY>y+100,start.top,{timeout:2000});}catch{throw Error('Table swallowed downward wheel: '+JSON.stringify({mode,width,start,after:await measure()}));}
   const lower=await measure();await page.mouse.wheel(0,-300);await page.waitForFunction(y=>scrollY<y-80,lower.top);
   const tinyStart=await measure();for(let i=0;i<10;i++)await page.mouse.wheel(0,30);await page.waitForFunction(y=>scrollY>y+100,tinyStart.top);
   if(width<1200){const x0=(await measure()).left;await page.mouse.wheel(450,0);await page.waitForFunction(x=>document.querySelector('.pv4-table-scroll').scrollLeft>x+100,x0);}
   // Reach the last row by input scrolling, never by scrollIntoView.
   for(let i=0;i<30;i++){await page.mouse.wheel(0,1400);if(await page.evaluate(()=>scrollY+innerHeight>=document.documentElement.scrollHeight-2))break;}
   await page.waitForFunction(()=>scrollY+innerHeight>=document.documentElement.scrollHeight-2);
   assert.ok(await page.locator('.pv4-table tbody tr').last().isVisible());
   const last=await page.locator('.pv4-table tbody tr').last().boundingBox();assert.ok(last.y<850&&last.y+last.height>0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push({mode,width,down:true,up:true,continuousSmallDeltas:true,horizontal:width<1200,lastRowReached:true});
   if(width===1440)await page.screenshot({path:path.join(out,`scroll-bottom-${label}-${mode}.png`)});
  }
  assert.deepEqual(await sessionRows(),rowsBefore);assert.deepEqual(await workspace(),before);
  // Expand the actual workbook to two pages; scrolling must reach and operate the pager.
  const book=new Excel.Workbook();await book.xlsx.load(sourceBytes);const sheet=book.worksheets[0],original=sheet.getRows(2,60).map(r=>r.values);
  for(let i=0;i<80;i++)sheet.addRow(original[i%original.length]);
  await page.setViewportSize({width:1440,height:850});await page.evaluate(()=>scrollTo(0,0));await importFile({name:'scroll-140-rows.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
  await page.locator('.pv4-table').scrollIntoViewIfNeeded();await hoverTable();for(let i=0;i<40;i++)await page.mouse.wheel(0,1800);
  await page.waitForFunction(()=>{const r=document.querySelector('.pv4-pager').getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});
  await page.locator('[data-pv4-page="2"]').click();await page.waitForFunction(()=>document.querySelector('.pv4-pager').textContent.includes('第 2 / 2 页'));assert.match(await page.locator('.pv4-actions').innerText(),/本页 40 条/);
  assert.deepEqual(await workspace(),before);assert.deepEqual(errors,[]);
  const report={passed:true,root,host:process.platform,installedWindow:!!installed,sourceKind:source?'user-supplied':'synthetic',workbookRows:60,twoPageFixtureRows:140,checks,paginationReached:true,scrollDoesNotChangeSessionOrWorkspace:true,errors};fs.writeFileSync(path.join(out,`scroll-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){if(page)await page.screenshot({path:path.join(out,`scroll-failure-${label}.png`)});throw error;}finally{await browser?.close();if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,5000);});}await server?.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
