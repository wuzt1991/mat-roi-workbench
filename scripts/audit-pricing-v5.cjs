'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),N=require('../public/pricing-inline-model.js');
const out=path.join(__dirname,'../outputs/pricing-prototype-v5');fs.mkdirSync(out,{recursive:true});
const KEY='mat-pricing-prototype-v1',url=process.env.PROTOTYPE_URL||'http://127.0.0.1:4189/pricing-prototype.html?v=5';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.AUDIT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const state=N.seed(),shop=state.shops[0];
  for(let i=2;i<=24;i++){const p=N.newPlan(state,shop.id,'测试计划 '+String(i).padStart(2,'0'));if(i!==23){p.settings.spend=i*10;p.settings.actualRoi=3;}state.plans.push(p);}
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await ctx.addInitScript(({KEY,state})=>localStorage.setItem(KEY,JSON.stringify(state)),{KEY,state});
  const saved=async()=>JSON.parse(await page.evaluate(k=>localStorage.getItem(k),KEY));
  const click=async(action)=>page.locator('[data-action="'+action+'"]').first().click();
  try{
    await page.goto(url);await page.locator('.plan-row').first().waitFor();
    assert.equal(await page.locator('.plan-row').count(),24);checks.push('24 个计划渲染和快速切换');
    await page.locator('[name=planQuery]').fill('测试计划 23');assert.equal(await page.locator('.plan-row').count(),1);await page.locator('.plan-open').click();assert.match(await page.locator('.plan-head h1').innerText(),/23/);checks.push('20+ 计划搜索与切换');
    await page.locator('[name=planQuery]').fill('');const active=(await saved()).shops[0].activePlanId,activeRow=page.locator('.plan-row[data-plan-id="'+active+'"]');
    await activeRow.hover();await activeRow.locator('[data-action=pin-plan]').click();assert.equal((await saved()).plans.find(p=>p.id===active).pinned,true);
    await activeRow.hover();await activeRow.locator('[data-action=move-plan][data-dir="1"]').click();checks.push('计划置顶与手动排序');
    const blank=(await saved()).plans.find(p=>p.id===active);assert.equal(blank.rows.length,0);assert.match(await page.locator('.assessment').innerText(),/暂不能判断/);assert.equal(await page.locator('.assessment .metric-value').count(),0);
    const pending=page.locator('.pending-links button').first();assert.equal(await pending.getAttribute('data-target'),'#field-spend');await pending.click();assert.equal(await page.locator('#field-spend').evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}),true);checks.push('缺失数据隐藏结论并定位待补字段');
    const first=(await saved()).plans[0].id;await page.locator('.plan-row[data-plan-id="'+first+'"] .plan-open').click();
    const before=await page.locator('.metric-value').first().innerText();await page.locator('[name=spend]').fill('180');await page.locator('[name=spend]').press('Tab');const after=await page.locator('.metric-value').first().innerText();assert.notEqual(after,before);checks.push('有效数据即时重算');
    await click('metrics');await page.locator('[name=metric-refundGmv]').check();await page.locator('[name=metric-order-refundGmv]').fill('1');await page.locator('#modal-form button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal((await saved()).prefs.metrics.includes('refundGmv'),true);
    await click('columns');await page.locator('[name=column-shipping]').check();await page.locator('[name=column-order-shipping]').fill('2');await page.locator('#modal-form button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});assert.match(await page.locator('.sku-table thead').first().innerText(),/运费/);
    await page.locator('.plan-row[data-plan-id="'+active+'"] .plan-open').click();assert.match(await page.locator('.assessment').innerText(),/暂不能判断/);assert.deepEqual((await saved()).prefs.metrics.includes('refundGmv'),true);checks.push('指标与 SKU 列偏好跨计划保存');
    await page.locator('.plan-row[data-plan-id="'+first+'"] .plan-open').click();const price=page.locator('[data-inline=manualPrice]').first();await price.fill('88');await price.press('Tab');let s=await saved();assert.equal(s.plans.find(p=>p.id===first).rows[0].manualPrice,88);await page.locator('[data-action=restore-price]').first().click();s=await saved();assert.equal(s.plans.find(p=>p.id===first).rows[0].priceMode,'auto');checks.push('单行改价与恢复策略价');
    const frozen=JSON.stringify(s.records);await page.locator('[data-nav=library]').click();await page.locator('[data-library-tab=materials]').click();await page.locator('[data-action=edit-material]').first().click();const cost=page.locator('#editor [name=cost-0]');await cost.fill(String(Number(await cost.inputValue())+1));await page.locator('#modal-form button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(JSON.stringify((await saved()).records),frozen);checks.push('公共资料更新不改写历史快照');
    await page.locator('[data-nav=sku]').click();
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});const dim=await page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dim.scroll<=dim.inner+1,JSON.stringify({width,dim}));await page.screenshot({path:path.join(out,'workspace-'+width+'.png'),fullPage:true});}
    checks.push('390、768、1440 无整页横向溢出并生成截图');assert.deepEqual(errors,[]);
    const report={passed:true,count:checks.length,checks,pageErrors:errors};fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
