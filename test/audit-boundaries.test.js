const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const M=require('../public/domain.js');
const P=require('../public/product-transfer.js');
const W=require('../public/workbook.js');
const Excel=require('../public/assets/exceljs.min.js');
const {createServer}=require('../server/index.cjs');

test('P2 ERP 字节和行数上限在解析/转换前拒绝，边界允许',async()=>{
  assert.doesNotThrow(()=>P.checkFileSize({byteLength:P.MAX_FILE_BYTES}));
  await assert.rejects(()=>P.readWorkbookRows({byteLength:P.MAX_FILE_BYTES+1},'source'),e=>e.code==='IMPORT_LIMIT');
  const headers=['店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'];
  const row=['店','硅藻泥','40x60','p','s',20,'在售',5];
  const source=[headers,...Array.from({length:P.MAX_ROWS},()=>row)];assert.equal(P.transformRows(source).rows.length,P.MAX_ROWS);
  source.push(row);assert.throws(()=>P.transformRows(source),e=>e.code==='IMPORT_LIMIT');
});
test('P1 v3 原始 Excel 仍通过旧版可读表校验，新导出使用实际成本口径',async()=>{
  const s=M.initialState(),p=s.plans[0];p.params.refundRates={unshipped:3,shippedOnly:4,returnRefund:5,firstHour:''};
  const old=new Excel.Workbook();for(const [name,rows] of W.tables(s,3))old.addWorksheet(name).addRows(rows);
  const hidden=old.addWorksheet('恢复数据');hidden.addRow(['MAT-ROI-XLSX',3]);hidden.addRow([0,JSON.stringify(s)]);
  const restored=await W.importWorkbook(await old.xlsx.writeBuffer());assert.deepEqual(restored,s);
  assert.equal(Object.fromEntries(W.tables(restored))['计划'][1][7],12);
});
test('P1 版本配置脚本与 package.json 同源，包含实际平台限制',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roi-config-test-')),running=createServer({dataDir:dir,port:0});
  t.after(async()=>{await new Promise(resolve=>{running.server.close(resolve);running.server.closeAllConnections();});fs.rmSync(dir,{recursive:true,force:true});});
  const url=await running.listen(),response=await fetch(url+'/app-config.js');assert.equal(response.status,200);
  const context={window:{}};vm.runInNewContext(await response.text(),context);assert.equal(context.window.WorkbenchConfig.version,require('../package.json').version);assert.equal(context.window.WorkbenchConfig.updatesSupported,process.platform==='win32'&&process.arch==='x64');
});
test('P0 选择历史报价、免费成本和非法价格的行为一致',()=>{
  const s=M.initialState(),p=s.plans[0];p.materialId=s.materials.find(m=>m.name==='硅藻泥').id;p.items=[{sizeId:s.sizes[1].id,price:20,share:100,weight:''}];
  const f=M.makeFrame(s,p);M.setFrameMaterialPrice(f,0);assert.equal(M.calculate(f,f.plan).rows[0].material,0);
  M.setFrameMaterialPrice(f,-1);assert.equal(M.calculate(f,f.plan).valid,false);
});
test('P0 毫米尺寸不会遮蔽后续材料厚度规则',()=>{
  const rules=P.normalizeRules({weightRules:[{material:'硅藻泥',thickness:3,coefficient:.9,costPerSqm:9.5,default:true},{material:'硅藻泥',thickness:5,coefficient:1.3,costPerSqm:11.2}]});
  assert.equal(P.resolveWeightRule('硅藻泥','400x600mm 硅藻泥 5mm',rules).coefficient,1.3);
});
test('P1 手动选择的重量列迁移后仍保留',()=>{
  const s=M.initialState();s.prefs.skuColumns=['price','share','weight','material','cost','roi'];assert.deepEqual(M.migrate(s).prefs.skuColumns,s.prefs.skuColumns);
});
test('P1 同名运费模板导出各自费率，不重复拼接其他模板',()=>{
  const s=M.initialState();s.shippingTemplates.push({id:'a',name:'同名运费',type:'fixed',fee:1,active:true},{id:'b',name:'同名运费',type:'fixed',fee:2,active:true});
  const rows=Object.fromEntries(W.tables(s))['运费模板'].filter(r=>r[0]==='同名运费');assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r[4]),[1,2]);
});
test('P0 未改价入账也将已选厚度报价冻结到材料单价',()=>{
  const s=M.initialState(),p=s.plans[0],m=s.materials.find(m=>m.name==='硅藻泥');p.materialId=m.id;p.materialRuleId=m.weightRules.find(r=>r.thickness===5).id;p.items=[{sizeId:s.sizes[1].id,price:30,share:100,weight:''}];p.params.spend=100;p.params.actualRoi=3;
  const h=M.confirmRecord(s,{frame:M.makeFrame(s,p),date:M.today()});assert.equal(h.frame.materials[0].price,11.2);assert.ok(M.validateBackup(s));assert.equal(m.price,9.5);
});
test('P0 尺寸仅以空白分隔时也尊重显式单位',()=>{
  for(const value of ['400毫米 600毫米','0.4 m 0.6 m','400 600 MM'])assert.equal(P.parseDimensions(value).area,.24);
});
