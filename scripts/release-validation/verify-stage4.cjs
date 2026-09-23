'use strict';
// Stage 4 recovery surface and native upgrade/rollback drill. All data is synthetic.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.MAT_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.MAT_VERIFY_OUTPUT||'outputs/stage4');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync(out,{recursive:true});
async function unavailable(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-stage4-ui-')),server=require('../../server/index.cjs').createServer({port:0,dataDir:dir});let browser;const checks=[];
 try{
  const url=await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  await page.route('**/product-transfer-ui.js',r=>r.abort());await page.goto(url);await page.locator('[data-action=product-view]').click();
  const initial=(await(await fetch(url+'/api/state')).json()).state;
  for(const theme of ['rays','day'])for(const width of [390,1440]){
   await page.evaluate(theme=>{UiAppearance.setMode(theme);UiAppearance.setMotion(false);},theme);await page.setViewportSize({width,height:844});
   await page.locator('.product-module-error').waitFor();assert.equal(await page.locator('[data-product-file],[data-product-edit]').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   const retry=page.locator('[data-action=reload-product-module]');await retry.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
   assert.equal(await retry.evaluate(e=>getComputedStyle(e).outlineStyle!=='none'),true);
   await page.screenshot({path:path.join(out,`missing-module-${theme}-${width}.png`)});checks.push(`缺失模块 ${theme}/${width}：错误提示、恢复入口、焦点及无横向溢出`);
  }
  await page.locator('.product-module-error [data-action=data-view]').click();await page.locator('[data-action=export]').first().waitFor();
  assert.deepEqual((await(await fetch(url+'/api/state')).json()).state,initial);
  await page.locator('[data-action=product-view]').click();await page.unroute('**/product-transfer-ui.js');
  await page.locator('[data-action=reload-product-module]').focus();await page.keyboard.press('Enter');
  await page.locator('[data-action=product-view]').waitFor();await page.locator('[data-action=product-view]').click();await page.locator('[data-pv4-file]').waitFor();
  assert.deepEqual((await(await fetch(url+'/api/state')).json()).state,initial);checks.push('缺失模块期间备份入口可用；键盘重新加载恢复正式流程且工作区相同');
  fs.writeFileSync(path.join(out,'unavailable.json'),JSON.stringify({passed:true,checks,isolatedData:true},null,2));
 }finally{await browser?.close();await server.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
async function upgrade(){
 const candidate=process.env.MAT_STAGE4_INSTALLED,previous=process.env.MAT_STAGE4_PREVIOUS;
 if(!candidate&&!previous)return;
 assert.ok(candidate&&previous,'Both native executables are required');assert.equal(process.platform,'darwin','This drill covers native macOS only');
 const W=require('../../public/workbook.js'),M=require('../../public/domain.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mat-stage4-upgrade-')),url='http://127.0.0.1:4194';let child,browser,page;
 const checks=[],errors=[],network=[],payloads=[previous,candidate].map(executable=>({executable,sha256:hash(path.resolve(path.dirname(executable),'../Resources/app.asar'))}));
 async function stop(){if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});child=null;}await browser?.close();browser=null;}
 async function start(executable){
  const env={...process.env,MAT_DATA_DIR:dir,MAT_PORT:'4194'};delete env.ELECTRON_RUN_AS_NODE;
  child=require('node:child_process').spawn(executable,['--remote-debugging-port=9234'],{env,stdio:['ignore','ignore','pipe']});child.stderr.on('data',data=>fs.appendFileSync(path.join(out,'native-startup.log'),data));
  const end=Date.now()+45000;while(true){try{const health=await(await fetch(url+'/api/health')).json();assert.equal(health.dataDir,dir);break;}catch(e){if(Date.now()>end)throw e;await new Promise(r=>setTimeout(r,200));}}
  browser=await chromium.connectOverCDP('http://127.0.0.1:9234');page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>network.push({url:r.url(),error:r.failure()?.errorText}));
  await page.waitForURL(url+'/**',{waitUntil:'domcontentloaded'});await page.locator('[data-action=entry]').waitFor();
 }
 const read=async()=> (await(await fetch(url+'/api/state')).json());
 try{
  // Let the accepted installed version create the isolated database, then seed it through its restore API.
  await start(previous);const original=await read(),seed=M.seed();seed.records=[];seed.plans[0].params.spend=100;seed.plans[0].params.actualRoi=5;M.confirmRecord(seed,{frame:M.makeFrame(seed,seed.plans[0]),date:'2026-09-01'});
  const response=await fetch(url+'/api/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1'},body:JSON.stringify({state:seed,expectedRevision:original.revision,operationId:'stage4-seed'})});assert.equal(response.ok,true,await response.text());
  const oldSaved=await read();assert.deepEqual(oldSaved.state,seed);await stop();checks.push('1.2.10 在隔离目录创建数据库和冻结账目');
  await start(candidate);assert.deepEqual((await read()).state,seed);const before=await read(),next=M.clone(before.state);next.plans[0].note='阶段 4 升级后写入';
  const put=await fetch(url+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-Workbench':'1'},body:JSON.stringify({state:next,revision:before.revision,workspaceId:before.workspaceId,storageEpoch:before.storageEpoch})});assert.equal(put.ok,true,await put.text());
  await page.reload();await page.locator('[data-action=entry]').waitFor();await page.locator('[data-action=export]').first().click();const downloading=page.waitForEvent('download');await page.locator('[data-action=confirm-export]').click();const backup=path.join(out,'stage4-upgrade-backup.xlsx');await(await downloading).saveAs(backup);assert.deepEqual(await W.importWorkbook(fs.readFileSync(backup)),next);
  await page.locator('#backup-input').setInputFiles(backup);await page.locator('[data-restore-mode][value=replace]').check();await page.locator('[data-action=confirm-restore]').click();
  await page.locator('#dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#save-status')?.dataset.status==='saved');
  const restored=await read();assert.deepEqual(restored.state,next);assert.ok(restored.storageEpoch>before.storageEpoch);await stop();checks.push('1.2.13 读取旧库、保存、导出 Excel、替换恢复并推进存储代次');
  await start(previous);const rolled=await read();assert.deepEqual(rolled.state,next);assert.deepEqual(rolled.state.records,seed.records);await stop();checks.push('实际 1.2.10 程序回读候选最新数据库，冻结账目与所有业务字段一致');
  assert.deepEqual(errors,[]);for(const p of payloads)assert.equal(hash(path.resolve(path.dirname(p.executable),'../Resources/app.asar')),p.sha256);
  fs.writeFileSync(path.join(out,'native-upgrade-rollback.json'),JSON.stringify({passed:true,platform:process.platform,isolatedData:true,checks,payloads,backupSha256:hash(backup),browserErrors:errors},null,2));
 }catch(e){fs.writeFileSync(path.join(out,'upgrade-failure.json'),JSON.stringify({error:String(e),checks,errors,network,url:page?.url()},null,2));if(page)await page.screenshot({path:path.join(out,'upgrade-failure.png'),timeout:5000}).catch(()=>{});throw e;}
 finally{await stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
(async()=>{await unavailable();await upgrade();console.log('Stage 4 checks passed');})().catch(e=>{console.error(e);process.exitCode=1;});
