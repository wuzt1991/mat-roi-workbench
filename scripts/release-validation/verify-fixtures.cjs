'use strict';
// Release validation only. Uses the exact production readers/exporter; never writes source workbooks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.env.MAT_VERIFY_ROOT||path.join(__dirname,'../..'));
const out=path.resolve(process.env.MAT_VERIFY_OUTPUT||__dirname);
const Reader=require(path.join(root,'server/xlsx-stream-reader.cjs'));
const {ImportSessionStore}=require(path.join(root,'server/import-session-store.cjs'));
const {exportProduct,templateParts}=require(path.join(root,'server/product-stream-export.cjs'));
const Recognition=require(path.join(root,'public/product-recognition.js'));
const Domain=require(path.join(root,'public/domain.js'));
const Excel=require(path.join(root,'public/assets/exceljs.min.js'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const template=path.join(root,'public/assets/product-template.xlsx');
const rules={materials:Domain.initialState().materials,sizes:Domain.initialState().sizes};
const report={time:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch},productionModules:{},templateSha256:sha(fs.readFileSync(template)),checks:[],limits:[]};
for(const name of ['server/xlsx-stream-reader.cjs','server/product-stream-export.cjs','server/import-session-store.cjs','public/product-recognition.js'])report.productionModules[name]=sha(fs.readFileSync(path.join(root,name)));
fs.mkdirSync(out,{recursive:true});
const persist=()=>fs.writeFileSync(path.join(out,'fixture-report.json'),JSON.stringify(report,null,2));
function newSession(name){const directory=path.join(out,name);assert.ok(!fs.existsSync(directory),'Use a fresh validation output directory');fs.mkdirSync(directory);new ImportSessionStore(directory,{create:true,meta:{rules,sessionId:name,ownerToken:'validation',workspaceId:'isolated-validation',storageEpoch:0}}).close();return directory;}
async function validateOutput(filename,expectedRows,expectedValues){
  const book=new Excel.Workbook();await book.xlsx.load(fs.readFileSync(filename));
  const sheet=book.worksheets[0];assert.equal(sheet.rowCount,expectedRows+1);assert.equal(sheet.columnCount,29);
  assert.deepEqual(sheet.getRow(1).values.slice(1),Recognition.OUTPUT_HEADERS);
  let formulaCount=0;const hash=crypto.createHash('sha256');
  for(let r=2;r<=sheet.rowCount;r++){
    const values=Array.from({length:29},(_,i)=>sheet.getCell(r,i+1).value??null);
    for(let c=1;c<=29;c++)if(sheet.getCell(r,c).formula)formulaCount++;
    for(const c of [16,17])assert.equal(values[c-1],null,'Barcode columns remain blank');
    for(const c of [18,19,28])if(values[c-1]!==null)assert.equal(typeof values[c-1],'string');
    if(expectedValues)assert.deepEqual(values,expectedValues[r-2]);
    hash.update(JSON.stringify(values)+'\n');
  }
  assert.equal(formulaCount,0);
  const baseParts=await templateParts(template),newParts=await templateParts(filename);
  for(const [name,bytes] of baseParts)if(name!=='xl/worksheets/sheet1.xml')assert.deepEqual(newParts.get(name),bytes);
  const xml=newParts.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(xml.includes(`ref="A1:AC${expectedRows+1}"`));
  return {businessRows:expectedRows,columns:29,formulaCount,exactValuesMatched:!!expectedValues,allNonSheetPartsPreserved:true,valuesSha256:hash.digest('hex'),artifactSha256:sha(fs.readFileSync(filename))};
}
async function realSource(filename){
  const before=sha(fs.readFileSync(filename)),session=newSession('huazhu-real-session');
  const inspect=await Reader.inspectWorkbook(filename,session);
  const imported=await Reader.importSheet(filename,session,{sheetId:inspect.sheets[0].sheetId,rules});
  assert.equal(imported.businessRows,60);
  const store=new ImportSessionStore(session);const initial=store.page(),issues={};
  for(const row of initial.rows)for(const issue of row.derived.issues)issues[issue.code]=(issues[issue.code]||0)+1;
  assert.equal(initial.counts.missingThickness,60);assert.equal(initial.counts.pending,60);
  await assert.rejects(exportProduct({sessionDirectory:session,templatePath:template,outputPath:path.join(out,'must-not-export.xlsx')}),e=>e.code==='SESSION_NOT_READY');
  // Explicit fixture decisions are not business advice: each material's existing default thickness is selected by hand.
  const fixtureSelections=[];
  for(const group of initial.groups){
    const example=initial.rows.find(r=>r.groupId===group.groupId),material=rules.materials.find(m=>m.id===example.derived.material.materialId);
    assert.ok(material);const rule=material.weightRules.find(r=>r.default&&!r.deleted)||material.weightRules.find(r=>!r.deleted);assert.ok(rule);
    const receipt=store.applyReview({ownerToken:'validation',expectedSessionRevision:store.getMeta('revision'),mutationId:'fixture-thickness-'+fixtureSelections.length,groupId:group.groupId,action:{type:'group-unify'},patch:{thickness:{mode:'value',materialId:material.id,ruleId:rule.id}}},rules);
    fixtureSelections.push({material:material.name,thickness:rule.thickness,selectedRows:receipt.changed});
  }
  const reviewed=store.page();assert.equal(reviewed.counts.ready,true);const expected=reviewed.rows.map(r=>r.derived.values);
  const sourceBook=new Excel.Workbook();await sourceBook.xlsx.load(fs.readFileSync(filename));
  const sourceSheet=sourceBook.worksheets[0],mapping=store.getMeta('mapping');
  const sourceFidelity=[];
  for(const [column,sourceColumn,label] of [[17,mapping.productId+1,'平台商品ID'],[18,mapping.specId+1,'平台规格ID']]){
    let sourceNonblank=0,lostOrChanged=0;
    for(let n=0;n<60;n++){const value=sourceSheet.getCell(n+2,sourceColumn).value;if(value!==null&&value!==undefined&&value!==''){sourceNonblank++;if(String(expected[n][column]??'')!==String(value))lostOrChanged++;}}
    sourceFidelity.push({field:label,sourceNonblank,lostOrChanged});
  }
  for(let n=0;n<60;n++)for(const [outputIndex,sourceKey] of [[1,'platform'],[2,'shop'],[3,'productName'],[4,'specName'],[17,'productId'],[18,'specId'],[19,'price'],[20,'status'],[21,'inventory']]){
    const source=sourceSheet.getCell(n+2,mapping[sourceKey]+1).value;
    assert.equal(String(expected[n][outputIndex]),String(source));
  }
  for(const values of expected){assert.equal(values[15],null);assert.equal(values[16],null);}
  store.close();const output=path.join(out,'huazhu-g62-converted.xlsx');await exportProduct({sessionDirectory:session,templatePath:template,outputPath:output});
  report.checks.push({name:'real-named-60-row-input',sourceFile:path.basename(filename),sourceSha256:before,sourceUnchanged:before===sha(fs.readFileSync(filename)),initialCounts:initial.counts,issues,fixtureSelections,sourceFidelity,blockedUntilReviewed:true,...await validateOutput(output,60,expected)});
  if(sourceFidelity.some(x=>x.lostOrChanged))report.sourceFidelityPassed=false;
  report.limits.push('Named desktop source has exactly 60 business rows; no historic source hash exists to prove byte-for-byte identity with the originally failed upload.');
  report.limits.push('Thickness selections above are isolated validation choices only; the original file contains no thickness evidence and remains unchanged.');
  persist();
}
async function boundary(n){
  const session=newSession('g62-'+n),store=new ImportSessionStore(session),mapping={platform:0,shop:1,productName:2,specName:3,productId:4,specId:5,price:6,status:7,inventory:8};store.setMeta('mapping',mapping);
  const records=[];for(let i=1;i<=n;i++){const values=['抖音','测试店','硅藻泥地垫',`${40+i}*60cm 3mm`,'00000000000000000001',`00000000000000000${i}`,20.12,'在售',0];const derived=Recognition.deriveTransferRow({rowId:i,sourceRow:i+1,values,mapping},{},{rules});records.push({rowId:i,sourceRow:i+1,sheetId:'rId1',values,sourceHash:sha(JSON.stringify(values)),platform:derived.platform,shop:derived.shop,productId:derived.productId,skuId:derived.skuId,groupId:derived.groupId,originalMissingThickness:false});}
  store.insertRawBatch(records);store.rebuildDerived(rules);
  store.applyReview({ownerToken:'validation',expectedSessionRevision:0,mutationId:'blank',rowIds:[1],action:{type:'row-edit'},patch:{material:{mode:'blank'},size:{mode:'blank'}}},rules);
  const expected=[];for(let page=1;page<=Math.ceil(n/100);page++)expected.push(...store.page({page}).rows.map(r=>r.derived.values));store.close();
  const output=path.join(out,`g62-${n}.xlsx`);await exportProduct({sessionDirectory:session,templatePath:template,outputPath:output});const result=await validateOutput(output,n,expected);
  for(const index of [5,6,7,8,9,10,11,12])assert.equal(expected[0][index],null);
  report.checks.push({name:'G62-'+n,blankMaterialSizeWeightCost:true,...result});persist();
}
(async()=>{if(process.env.MAT_VERIFY_REAL_SOURCE)await realSource(process.env.MAT_VERIFY_REAL_SOURCE);for(const n of [1,60,99,100,139])await boundary(n);report.passed=report.sourceFidelityPassed!==false;persist();console.log(JSON.stringify({report:path.join(out,'fixture-report.json'),checks:report.checks.map(x=>({name:x.name,rows:x.businessRows})),passed:report.passed}));if(!report.passed)process.exitCode=1;})().catch(error=>{report.passed=false;report.error={message:error.message,stack:error.stack};persist();console.error(error);process.exitCode=1;});
