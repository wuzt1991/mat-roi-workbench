'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../server/index.cjs');
const M=require('../public/domain.js');
const P=require('../public/product-transfer.js');
const Excel=require('../public/assets/exceljs.min.js');

async function run(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roi-browser-audit-'));
  const output=process.env.AUDIT_OUTPUT_DIR||path.join(dir,'screenshots');fs.mkdirSync(output,{recursive:true});
  const running=createServer({dataDir:dir,port:0});
  const state=M.initialState(),p=state.plans[0];p.materialId=state.materials.find(m=>m.name==='硅藻泥').id;
  p.items=[{sizeId:state.sizes[1].id,price:30,share:100,weight:''}];p.params.spend=100;p.params.actualRoi=3;running.store.write(state,0);
  const url=await running.listen();let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.AUDIT_CHROME_PATH?{executablePath:process.env.AUDIT_CHROME_PATH}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const click=action=>page.locator(`[data-action="${action}"]`).first().click();
    await page.goto(url);await page.locator('[data-action="entry"]').waitFor();
    assert.ok((await page.locator('.topbar').innerText()).includes(require('../package.json').version));
    assert.equal(await page.locator('[data-action="check-updates"]').isDisabled(),true);
    await page.locator('[data-packaging-weight]').fill('100');await page.locator('[data-packaging-weight]').press('Tab');
    await click('weight');await page.locator('[data-field="weight"]').fill('500');await click('save-modal');await page.locator('#dialog').waitFor({state:'hidden'});
    await click('entry');await page.locator('[data-entry-price]').fill('109.50');
    await click('confirm-record');await page.locator('#dialog').waitFor({state:'hidden'});
    const saved=running.store.read().state,h=saved.records[0];assert.equal(h.frame.materials[0].price,109.5);assert.ok(Math.abs(M.calculate(h.frame,h.frame.plan).rows[0].material-26.28)<1e-9);
    await click('edit-current-material');await page.locator('[data-material-rule="0"][data-rule-key="thickness"]').fill('abc');await click('save-modal');
    assert.equal(await page.locator('[data-material-rule="0"][data-rule-key="thickness"]').getAttribute('aria-invalid'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.ruleKey),'thickness');
    page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').isVisible(),true);
    page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});
    await click('ledger-view');await page.locator('[data-filter="shopId"]').focus();await page.locator('[data-filter="shopId"]').selectOption(state.shops[0].id);assert.equal(await page.evaluate(()=>document.activeElement.dataset.filter),'shopId');
    await page.screenshot({path:path.join(output,'desktop-ledger.png'),fullPage:true});
    await click('product-view');
    const book=new Excel.Workbook(),sheet=book.addWorksheet('ERP');sheet.addRow(P.HEADERS);
    const row=Array(29).fill('');Object.assign(row,{0:1,1:'淘宝',2:'店',3:'水晶绒',4:'80x120 包边',17:'p',18:'s',19:'abc',20:'在售',21:5});sheet.addRow(row);
    await page.locator('[data-product-file]').setInputFiles({name:'erp.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
    await page.locator('[data-product-edit="price"]').waitFor();assert.equal(await page.locator('[data-product-edit="price"]').getAttribute('aria-invalid'),'true');
    await page.locator('[data-product-edit="price"]').fill('39.9');await click('product-review-row');assert.equal(await page.locator('[data-action="product-export"]').isEnabled(),true);
    await page.screenshot({path:path.join(output,'desktop-product.png'),fullPage:true});
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:900});
      for(const action of ['plan-view','ledger-view','library-view','product-view']){
        await click(action);const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));assert.ok(size.scroll<=size.viewport+1,`${action} width ${width}: ${JSON.stringify(size)}`);
        if(width===390||width===1440)await page.screenshot({path:path.join(output,`${width}-${action}.png`),fullPage:true});
      }
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['entry quote and frozen cost','manual total weight','field association and focus','Escape dirty confirmation','filter focus','price review','desktop tablet mobile layout'],screenshots:output},null,2));
  }finally{
    await browser?.close();await new Promise(resolve=>{running.server.close(resolve);running.server.closeAllConnections();});
    // Keep screenshots for inspection; the database is confined to this temporary directory.
    console.log('Isolated test directory: '+dir);
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
