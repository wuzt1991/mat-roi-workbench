'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Excel=require('../public/assets/exceljs.min.js');
const Recognition=require('../public/product-recognition.js');
const Domain=require('../public/domain.js');
const {ImportSessionStore}=require('../server/import-session-store.cjs');
const Reader=require('../server/xlsx-stream-reader.cjs');
const {exportProduct}=require('../server/product-stream-export.cjs');
const {normalizeCandidateSheets,normalizeMapping}=require('../server/file-service.cjs');

const rules=()=>({materials:Domain.initialState().materials});
async function source(filename,rows=3){const book=new Excel.Workbook(),sheet=book.addWorksheet('商品');sheet.addRow(['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存']);for(let i=0;i<rows;i++)sheet.addRow(['抖音','店铺','硅藻泥地垫',`${40+i}*60cm 3mm`,`000${i}`,`sku-${i}`,20,'在售',10]);fs.writeFileSync(filename,Buffer.from(await book.xlsx.writeBuffer()));}
async function sourceWithRepeatedHeader(filename){const book=new Excel.Workbook(),sheet=book.addWorksheet('销售'),header=['店铺','','平台订单号','主条码','货品名称','提取尺寸','修改数量','','货品数量','快递单号','','','货品名称','货品名称'],repeated=['店铺','0','平台订单号','主条码','货品名称','','货品数量','#VALUE!','货品数量','快递单号','#N/A','','货品名称','货品名称'];sheet.addRow(header);sheet.addRow(['A','','o1','sku-1','地垫','','1','','1']);sheet.addRow(['旺店通2.2','#N/A','','','','','','#VALUE!','','','#N/A']);sheet.addRow(repeated);sheet.addRow(['A','','o2','sku-2','地垫','','2','','2']);fs.writeFileSync(filename,Buffer.from(await book.xlsx.writeBuffer()));}

test('销售工作表候选项暴露列索引并将表单索引标准化为整数',()=>{
  const sheets=normalizeCandidateSheets([{sheetId:'rId1',name:'1-12',header:{headers:['店铺','主条码','货品数量'],mapping:{shop:0,specId:1,sales:2}}}]);
  assert.deepEqual(sheets,[{id:'rId1',sheetId:'rId1',name:'1-12',columns:[{id:0,name:'店铺'},{id:1,name:'主条码'},{id:2,name:'货品数量'}],headers:['店铺','主条码','货品数量'],mapping:{shop:0,specId:1,sales:2},header:{headers:['店铺','主条码','货品数量'],mapping:{shop:0,specId:1,sales:2}}}]);
  assert.deepEqual(normalizeMapping({shop:'0',specId:'1',sales:'8',note:'A'}),{shop:0,specId:1,sales:8,note:'A'});
});

test('流式读取跳过工作表中间完全重复的表头',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-repeat-header-')),filename=path.join(directory,'source.xlsx'),session=path.join(directory,'session');fs.mkdirSync(session);await sourceWithRepeatedHeader(filename);const store=new ImportSessionStore(session,{create:true,meta:{sessionId:'s',ownerToken:'o',workspaceId:'w',storageEpoch:0,rules:rules()}});store.close();const inspection=await Reader.inspectWorkbook(filename,session),imported=await Reader.importSheet(filename,session,{sheetId:inspection.sheets[0].sheetId,mapping:{shop:0,specId:3,productName:4,specName:4,sales:8},rules:rules(),derive:false});assert.equal(imported.businessRows,2);const reopened=new ImportSessionStore(session);assert.equal(reopened.db.prepare('SELECT count(*) n FROM raw_rows').get().n,2);reopened.close();fs.rmSync(directory,{recursive:true,force:true});
});

test('纯识别函数将伪亚麻保留为人工复核，厚度证据不丢失',()=>{const result=Recognition.deriveTransferRow({rowId:1,values:['抖音','店','伪亚麻硅藻泥地垫','40*60cm 3mm','p','s',20,'在售',1],mapping:{platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8}},{},{rules:rules()});assert.equal(result.material.status,'pending');assert.equal(result.material.reason,'pseudo-linen');assert.deepEqual(result.thickness.candidates,[3]);assert.equal(result.originalMissingThickness,false);});
test('尺寸识别排除型号、范围和三段噪音，重复同尺寸可去重',()=>{assert.equal(Recognition.parseDimensions('ABC40X60').status,'pending');assert.equal(Recognition.parseDimensions('40-60').status,'pending');assert.equal(Recognition.parseDimensions('40至60').status,'pending');assert.equal(Recognition.parseDimensions('40*60*3mm').status,'pending');assert.equal(Recognition.parseDimensions('40*60cm / 50*80cm').status,'pending');assert.equal(Recognition.parseDimensions('40*60cm，400mm*600mm').status,'value');});
test('规格中的伪亚麻也强制材质复核，尺寸库选择转为本行长宽',()=>{const state=Domain.initialState(),base={rowId:1,values:['抖音','店','硅藻泥地垫','伪亚麻 40*60cm 3mm','p','s',20,'在售',1],mapping:{platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8}},ruleSet={materials:state.materials,sizes:state.sizes};assert.equal(Recognition.deriveTransferRow(base,{},{rules:ruleSet}).material.status,'pending');const size=state.sizes.find(x=>Number(x.salesW)>0&&Number(x.salesH)>0),preview=Recognition.previewTransferRowPatch(base,{}, {size:{mode:'value',id:size.id}},{type:'row-edit'},ruleSet);assert.equal(preview.review.size.sizeId,size.id);assert.equal(preview.review.size.area,Number(size.salesW)*Number(size.salesH)/10000);});

test('会话库分页最多 100 行，批量保护已确认字段并可撤销',()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-session-')),store=new ImportSessionStore(directory,{create:true,meta:{sessionId:'s',ownerToken:'o',workspaceId:'w',storageEpoch:0,rules:rules(),rulesFingerprint:'x'}}),mapping={platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8};store.setMeta('mapping',mapping);const records=[];for(let i=1;i<=102;i++){const values=['抖音','店','硅藻泥地垫','40*60cm 3mm','p',`s${i}`,20,'在售',1],derived=Recognition.deriveTransferRow({rowId:i,sourceRow:i+1,values,mapping},{},{rules:rules()});records.push({rowId:i,sourceRow:i+1,sheetId:'r1',values,sourceHash:String(i),platform:derived.platform,shop:derived.shop,productId:derived.productId,skuId:derived.skuId,groupId:derived.groupId,originalMissingThickness:false});}store.insertRawBatch(records);store.rebuildDerived(rules());const first=store.page();assert.equal(first.rows.length,100);assert.equal(first.groups[0].total,102);const material=rules().materials.find(x=>x.name==='硅藻泥'),other=rules().materials.find(x=>x.name==='亚麻');const receipt=store.applyReview({mutationId:'m1',expectedSessionRevision:0,ownerToken:'o',groupId:first.groups[0].groupId,action:{type:'group-unify'},patch:{material:{mode:'value',materialId:other.id}}},rules());assert.equal(receipt.changed,102);assert.equal(store.page().rows[0].derived.material.materialId,other.id);const undone=store.undo({expectedSessionRevision:1,ownerToken:'o'},rules());assert.equal(undone.undone,102);assert.equal(store.page().rows[0].derived.material.materialId,material.id);store.close();fs.rmSync(directory,{recursive:true,force:true});});

test('销售汇总分页返回已保存的绑定与排除状态',()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-sales-page-')),store=new ImportSessionStore(directory,{create:true,meta:{sessionId:'s',kind:'sales',ownerToken:'o',workspaceId:'w',storageEpoch:0}}),record={rowId:1,sourceRow:2,sheetId:'r1',values:['抖音','店','商品','规格','p','sku','1'],sourceHash:'h',platform:'抖音',shop:'店',productId:'p',skuId:'sku',groupId:'g',originalMissingThickness:false};store.insertRawBatch([record]);store.db.prepare('INSERT INTO sales_aggregates VALUES(?,?,?,?,?,?,?)').run('抖音','店','p','sku','3',3,1);const saved=store.salesReview({ownerToken:'o',expectedSessionRevision:0,mutationId:'bind-1',rowIds:[1],patch:{itemId:'plan-item',excluded:false}});assert.equal(saved.changed,1);const page=store.salesPage();assert.equal(page.items[0].itemId,'plan-item');assert.equal(page.items[0].excluded,false);assert.equal(page.revision,1);store.close();fs.rmSync(directory,{recursive:true,force:true});});

test('流式读取、SQLite 复核与 29 列模板导出贯通',async()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-file-engine-')),filename=path.join(directory,'source.xlsx'),session=path.join(directory,'session'),output=path.join(directory,'out.xlsx');fs.mkdirSync(session);await source(filename);const store=new ImportSessionStore(session,{create:true,meta:{sessionId:'s',ownerToken:'o',workspaceId:'w',storageEpoch:0,rules:rules(),sourceHash:'hash'}});store.close();const inspection=await Reader.inspectWorkbook(filename,session);assert.equal(inspection.sheets.length,1);assert.ok(inspection.sheets[0].header);const imported=await Reader.importSheet(filename,session,{sheetId:inspection.sheets[0].sheetId,rules:rules()});assert.equal(imported.businessRows,3);const reopened=new ImportSessionStore(session);assert.equal(reopened.page().rows.length,3);assert.equal(reopened.counts().ready,true);reopened.close();const exported=await exportProduct({sessionDirectory:session,templatePath:path.join(__dirname,'../public/assets/product-template.xlsx'),outputPath:output});assert.equal(exported.rows,3);const book=new Excel.Workbook();await book.xlsx.load(fs.readFileSync(output));assert.equal(book.worksheets[0].rowCount,4);assert.equal(book.worksheets[0].columnCount,29);for(let row=2;row<=4;row++)book.worksheets[0].getRow(row).eachCell(cell=>assert.equal(cell.formula,undefined));fs.rmSync(directory,{recursive:true,force:true});});

test('完整 ERP 表优先平台字段，真正同名重复仍要求确认',()=>{
  const headers=['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存','货品名称','规格名称','货品编码','规格ID'];
  const mapping=Recognition.mapFields(headers);
  assert.equal(mapping.productName,2);assert.equal(mapping.specName,3);assert.equal(mapping.specId,5);
  assert.deepEqual(Recognition.mapFields(['商品名称','商品名称']).productName,{ambiguous:[0,1]});
});

test('转表保留旧版字段别名，并优先平台编码而不是空白内部编码',()=>{
  const headers=['编号','平台','店铺','商品名称','商品规格名称','商品ID','规格ID','价格','销售状态','库存','平台商品编码','商品编码','平台商家编码','商家编码'];
  const mapping=Recognition.mapFields(headers);
  const values=[7,'抖音','测试店','硅藻泥地垫','40*60cm 3mm','001','002',20,'在售',10,'0000123','','0000456',''];
  const result=Recognition.deriveTransferRow({rowId:1,values,mapping},{},{rules:rules()});
  assert.equal(result.status,'confirmed');
  assert.equal(result.values[0],7);
  assert.equal(result.values[15],'0000123');
  assert.equal(result.values[16],'0000456');
  assert.deepEqual(Recognition.mapFields(['平台商家编码','平台商家编码','商家编码']).merchantCode,{ambiguous:[0,1]});
  assert.equal(Recognition.mapFields(['商品编码','商家编码']).merchantCode,1);
});

test('平台商家编码经过 XLSX 导入和流式导出保持文本与前导零',async(t)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-platform-codes-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename=path.join(directory,'source.xlsx'),session=path.join(directory,'session'),output=path.join(directory,'out.xlsx');fs.mkdirSync(session);
  const source=new Excel.Workbook(),sheet=source.addWorksheet('商品');
  sheet.addRow(['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存','平台商品编码','商品编码','平台商家编码','商家编码']);
  sheet.addRow(['抖音','测试店','硅藻泥地垫','40*60cm 3mm','001','002',20,'在售',10,'0000123','','0000456','']);
  fs.writeFileSync(filename,Buffer.from(await source.xlsx.writeBuffer()));
  new ImportSessionStore(session,{create:true,meta:{sessionId:'codes',ownerToken:'test',rules:rules()}}).close();
  const inspection=await Reader.inspectWorkbook(filename,session);
  const imported=await Reader.importSheet(filename,session,{sheetId:inspection.sheets[0].sheetId,rules:rules()});assert.equal(imported.ready,true);
  await exportProduct({sessionDirectory:session,templatePath:path.join(__dirname,'../public/assets/product-template.xlsx'),outputPath:output});
  const exported=new Excel.Workbook();await exported.xlsx.load(fs.readFileSync(output));
  assert.equal(exported.worksheets[0].getCell('P2').value,'0000123');assert.equal(exported.worksheets[0].getCell('Q2').value,'0000456');
});

test('分页先筛选当前代的行号，再加载整行，跨页顺序与缺厚度交叉筛选一致',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-page-filter-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new ImportSessionStore(directory,{create:true,meta:{sessionId:'page',ownerToken:'test',rules:rules()}});t.after(()=>store.close());
  const mapping={platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8};store.setMeta('mapping',mapping);
  const records=[];for(let rowId=1;rowId<=240;rowId++){
    const values=['抖音','测试店','硅藻泥地垫',rowId%2?'40*60cm':'40*60cm 3mm','product',String(rowId),20,'在售',1];
    const d=Recognition.deriveTransferRow({rowId,sourceRow:rowId+1,values,mapping},{},{rules:rules()});
    records.push({rowId,sheetId:'r1',sourceRow:rowId+1,values,sourceHash:String(rowId),platform:d.platform,shop:d.shop,productId:d.productId,skuId:d.skuId,groupId:d.groupId,originalMissingThickness:d.originalMissingThickness});
  }
  store.insertRawBatch(records);store.rebuildDerived(rules());store.rebuildDerived(rules());
  const page=store.page({status:'pending',missingThickness:true,page:2});
  assert.equal(page.generation,2);assert.equal(page.total,120);assert.equal(page.rows.length,20);
  assert.deepEqual(page.rows.map(r=>r.rowId),Array.from({length:20},(_,i)=>201+i*2));
  assert.equal(page.groups[0].total,240);assert.equal(page.groups[0].hidden,220);assert.equal(page.counts.total,240);
  const empty=store.page({status:'confirmed',missingThickness:true});assert.equal(empty.total,0);assert.equal(empty.rows.length,0);assert.equal(empty.counts.total,240);
  assert.equal(store.page({status:'confirmed',page:2}).rows[0].rowId,202);
});

test('多表不同列序独立映射、统一行号，重开复核与导出不串列、不丢重复行',async(t)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mat-multi-sheet-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename=path.join(directory,'source.xlsx'),session=path.join(directory,'session'),output=path.join(directory,'out.xlsx');
  const headers=['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'];
  const values=['抖音','店铺','硅藻泥地垫','40*60cm 3mm','00001','00002',20,'在售',10];
  const book=new Excel.Workbook();book.addWorksheet('说明').addRow(['请读取商品明细']);const a=book.addWorksheet('商品 A');a.addRow(headers);a.addRow(values);a.addRow([...values.slice(0,5),'00003',21,'在售',11]);
  const b=book.addWorksheet('商品 B');b.getRow(5).values=headers.slice().reverse();b.getRow(6).values=values.slice().reverse();
  fs.writeFileSync(filename,Buffer.from(await book.xlsx.writeBuffer()));
  let store=new ImportSessionStore(session,{create:true,meta:{sessionId:'s',ownerToken:'o',rules:rules()}});store.close();
  const inspection=await Reader.inspectWorkbook(filename,session),selections=inspection.sheets.slice(1).map(s=>({sheetId:s.sheetId,header:s.header,mapping:s.header.mapping}));
  const imported=await Reader.importSheets(filename,session,{selections:selections.slice().reverse(),rules:rules()});
  assert.equal(imported.businessRows,3);assert.equal(imported.duplicateRows,1);
  store=new ImportSessionStore(session);t.after(()=>store.close());const page=store.page();
  assert.deepEqual(page.rows.map(r=>r.rowId),[1,2,3]);assert.deepEqual(page.rows.map(r=>r.sourceRow),[2,3,6]);assert.deepEqual(page.rows.map(r=>r.sheetName),['商品 A','商品 A','商品 B']);
  assert.deepEqual(page.rows.map(r=>r.derived.skuId),['00002','00003','00002']);assert.deepEqual(page.rows.map(r=>r.derived.values[19]),[20,21,20]);
  const mat=rules().materials.find(m=>m.name==='亚麻');store.applyReview({mutationId:'multi-edit',expectedSessionRevision:0,ownerToken:'o',rowIds:[3],action:{type:'row-edit'},patch:{material:{mode:'value',materialId:mat.id}}},rules());
  assert.equal(store.page().rows[2].derived.productName,'硅藻泥地垫');store.undo({expectedSessionRevision:1,ownerToken:'o'},rules());store.close();
  await exportProduct({sessionDirectory:session,templatePath:path.join(__dirname,'../public/assets/product-template.xlsx'),outputPath:output});
  const exported=new Excel.Workbook();await exported.xlsx.load(fs.readFileSync(output));assert.equal(exported.worksheets[0].rowCount,4);assert.equal(exported.worksheets[0].columnCount,29);assert.equal(exported.worksheets[0].getCell('S4').value,'00002');
});
