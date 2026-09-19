'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Readable}=require('node:stream'),{pipeline}=require('node:stream/promises'),crypto=require('node:crypto');
const root=path.resolve(process.env.MAT_VERIFY_ROOT||path.join(__dirname,'../..')),out=path.resolve(process.env.MAT_VERIFY_OUTPUT||path.join(__dirname,'large'));
const {createRequire}=require('node:module'),appRequire=createRequire(path.join(root,'package.json')),yazl=appRequire('yazl');
const Reader=require(path.join(root,'server/xlsx-stream-reader.cjs')),{ImportSessionStore}=require(path.join(root,'server/import-session-store.cjs'));
const {exportProduct,rowXml,templateParts}=require(path.join(root,'server/product-stream-export.cjs'));
const Recognition=require(path.join(root,'public/product-recognition.js')),Domain=require(path.join(root,'public/domain.js'));
const rules={materials:Domain.initialState().materials};
const mode=process.argv[2]||'build',count=Number(process.argv[3]||500000);
const source=path.join(out,`synthetic-${count}.xlsx`),session=path.join(out,`session-${count}`),output=path.join(out,`output-${count}.xlsx`),reportPath=path.join(out,`report-${count}.json`);
const report={time:new Date().toISOString(),node:process.version,platform:process.platform,count,mode,synthetic:true};
const persist=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
fs.mkdirSync(out,{recursive:true});
function fixtureValues(i){const values=Array(29).fill(null);Object.assign(values,{0:i,1:'抖音',2:'测试店',3:'硅藻泥地垫',4:'40*60cm 3mm',17:'00000000000000000001',18:`00000000000000${i}`,19:20,20:'在售',21:0});return values;}
async function build(){
  const parts=await templateParts(path.join(root,'public/assets/product-template.xlsx')),zip=new yazl.ZipFile(),done=pipeline(zip.outputStream,fs.createWriteStream(source));
  for(const [name,bytes] of parts)if(name!=='xl/worksheets/sheet1.xml')zip.addBuffer(bytes,name);
  zip.addReadStream(Readable.from((async function*(){yield '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';yield rowXml(Recognition.OUTPUT_HEADERS,1,{attributes:{},cells:[]});for(let i=1;i<=count;i++)yield rowXml(fixtureValues(i),i+1,{attributes:{},cells:[]});yield '</sheetData></worksheet>'})()),'xl/worksheets/sheet1.xml');zip.end();await done;
  console.log(JSON.stringify({built:source,bytes:fs.statSync(source).size}));
}
async function verify(){
  assert.ok(!fs.existsSync(session),'Run in a fresh session');fs.mkdirSync(session);new ImportSessionStore(session,{create:true,meta:{rules,sessionId:'boundary',ownerToken:'validation',workspaceId:'isolated',storageEpoch:0}}).close();
  let last=0;const progress=p=>{if(Date.now()-last>10000){last=Date.now();console.log(JSON.stringify({progress:p,rssMiB:process.memoryUsage().rss/1024**2}));}};
  const started=Date.now(),inspect=await Reader.inspectWorkbook(source,session,{progress});
  let imported;try{imported=await Reader.importSheet(source,session,{sheetId:inspect.sheets[0].sheetId,rules,progress});}catch(error){if(count===500001&&error.code==='ROW_LIMIT'){report.expectedLimitRejection=true;report.code=error.code;report.importMs=Date.now()-started;report.maxRssMiB=process.resourceUsage().maxRSS/1024;report.passed=true;persist();return;}throw error;}
  assert.equal(imported.businessRows,count);assert.ok(imported.ready);report.importMs=Date.now()-started;report.imported={businessRows:imported.businessRows,confirmed:imported.confirmed,ready:imported.ready};
  let store=new ImportSessionStore(session);const latencies=[];
  for(let i=0;i<30;i++){const t=performance.now(),page=store.page({page:Math.ceil(count/100)-(i%10)});latencies.push(performance.now()-t);assert.equal(page.rows.length,100);assert.equal(page.groups[0].total,count);assert.ok(Buffer.byteLength(JSON.stringify(page))<2*1024**2);}
  const expected=crypto.createHash('sha256');for(const row of store.db.prepare('SELECT derived_json FROM derived_rows ORDER BY row_id').iterate())expected.update(JSON.stringify(JSON.parse(row.derived_json).values)+'\n');
  report.expectedRowHash=expected.digest('hex');report.pageP95Ms=latencies.sort((a,b)=>a-b)[Math.ceil(latencies.length*.95)-1];assert.ok(report.pageP95Ms<=500,'Deep page p95 exceeds 500ms');store.close();
  const t=Date.now();await exportProduct({sessionDirectory:session,templatePath:path.join(root,'public/assets/product-template.xlsx'),outputPath:output,progress});report.exportMs=Date.now()-t;
  const readback=path.join(out,`readback-${count}`);fs.mkdirSync(readback);store=new ImportSessionStore(readback,{create:true,meta:{rules}});store.close();const inspected=await Reader.inspectWorkbook(output,readback);const returned=await Reader.importSheet(output,readback,{sheetId:inspected.sheets[0].sheetId,rules,derive:false,progress});assert.equal(returned.businessRows,count);
  store=new ImportSessionStore(readback);const actual=crypto.createHash('sha256');for(const row of store.db.prepare('SELECT raw_json FROM raw_rows ORDER BY row_id').iterate()){const values=JSON.parse(row.raw_json).map((x,i)=>x===''||x==null?null:([0,8,9,10,11,12,19,21].includes(i)?Number(x):x));actual.update(JSON.stringify(values)+'\n');}store.close();report.actualRowHash=actual.digest('hex');assert.equal(report.actualRowHash,report.expectedRowHash);
  report.maxRssMiB=process.resourceUsage().maxRSS/1024;report.totalMs=Date.now()-started;report.exceeds512MiBRssTarget=report.maxRssMiB>512;report.passed=true;persist();console.log(JSON.stringify(report));
}
(async()=>{if(mode==='build')await build();else await verify();})().catch(e=>{report.passed=false;report.error={code:e.code,message:e.message,stack:e.stack};report.maxRssMiB=process.resourceUsage().maxRSS/1024;persist();console.error(e);process.exitCode=1;});
