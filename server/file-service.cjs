'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const {FileJobBroker}=require('./file-job-broker.cjs');
const {ImportSessionStore,SessionError,digest}=require('./import-session-store.cjs');
const {LIMITS}=require('./xlsx-stream-reader.cjs');
const Recognition=require('../public/product-recognition.js');
const TEMPLATE=path.join(__dirname,'..','public','assets','product-template.xlsx');
const SESSION_TOTAL_LIMIT=8*1024*1024*1024,SESSION_LIMIT=2*1024*1024*1024,FREE_LIMIT=1024*1024*1024;
const ALLOWED_AUXILIARY=new Set(['export-backup','inspect-backup','export-listing']);
const json=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
const safeName=value=>String(value||'').replace(/[\r\n"\\/]/g,'_').slice(0,120)||'download';
async function readJson(request,limit=2*1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new SessionError(413,'请求内容超限。','REQUEST_TOO_LARGE');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new SessionError(400,'请求内容不是有效 JSON。','INVALID_JSON');}}
function context(store){const meta=store.metadata?.()||store.read?.()||{};return {workspaceId:meta.workspaceId,storageEpoch:meta.storageEpoch??0};}
function ruleSnapshot(state){return {materials:(state?.materials||[]).map(material=>({id:material.id,name:material.name,deleted:!!material.deleted,weightRules:(material.weightRules||[]).map(rule=>({id:rule.id,thickness:rule.thickness,variant:rule.variant,coefficient:rule.coefficient,costPerSqm:rule.costPerSqm,default:!!rule.default,deleted:!!rule.deleted}))})),sizes:(state?.sizes||[]).map(size=>({id:size.id,name:size.name,salesW:size.salesW,salesH:size.salesH,irregular:!!size.irregular,deleted:!!size.deleted}))};}
function normalizeMapping(mapping){if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))return {};return Object.fromEntries(Object.entries(mapping).map(([key,value])=>{const text=String(value??'').trim();return [key,/^\d+$/.test(text)?Number(text):value];}));}
function normalizeCandidateSheets(sheets){return (sheets||[]).map(sheet=>{const headers=Array.isArray(sheet.header?.headers)?sheet.header.headers:[],mapping=normalizeMapping(sheet.header?.mapping);return {id:sheet.sheetId,sheetId:sheet.sheetId,name:sheet.name,columns:headers.map((name,index)=>({id:index,name})),headers,mapping,header:{...(sheet.header||{}),headers,mapping}};});}
function directoryBytes(directory){let total=0;if(!fs.existsSync(directory))return 0;for(const item of fs.readdirSync(directory,{withFileTypes:true})){const filename=path.join(directory,item.name);try{if(item.isDirectory())total+=directoryBytes(filename);else total+=fs.statSync(filename).size;}catch{}}return total;}

function createFileService({store,dataDir}){
  const root=path.join(dataDir,'import-sessions');fs.mkdirSync(root,{recursive:true});let restoring=false,workspaceWrite=false;
  const discarding=new Set();
  function sessionDirectory(id){if(!/^[0-9a-f-]{36}$/.test(id))throw new SessionError(404,'文件会话不存在。','SESSION_NOT_FOUND');const directory=path.join(root,id);if(!fs.existsSync(directory))throw new SessionError(404,'文件会话不存在。','SESSION_NOT_FOUND');return directory;}
  function openSession(id){if(discarding.has(id))throw new SessionError(409,'文件会话正在放弃，请稍候。','SESSION_DISCARDING');return new ImportSessionStore(sessionDirectory(id));}
  function phaseFor(type){return type==='inspect'?'inspecting':type==='import'||type==='aggregate-sales'?'importing':type==='recompute'?'deriving':type==='apply-review'?'applying':'exporting';}
  function currentRules(){return ruleSnapshot(store.read().state);}
  function assertCurrent(meta){const ctx=context(store);if(meta.workspaceId!==ctx.workspaceId||Number(meta.storageEpoch)!==Number(ctx.storageEpoch))throw new SessionError(409,'工作区已恢复，请重新导入；原会话可保留或导出救援文件。','WORKSPACE_CONTEXT_CHANGED');if(restoring)throw new SessionError(409,'正在恢复工作区，文件任务暂停。','RESTORE_IN_PROGRESS');return meta;}
  function assertIdle(){if(broker.active)throw new SessionError(409,'已有文件任务正在进行，请完成或取消后重试。','FILE_JOB_BUSY');}
  function assertRules(meta){const rules=currentRules();if(digest(rules)!==meta.rulesFingerprint)throw new SessionError(409,'可复用规则已变更，请重新计算后复核。','RULES_CHANGED');return rules;}
  function onJobChange(job){
    if(!job.sessionId||job.state==='running')return;let session;try{session=openSession(job.sessionId);}catch{return;}try{session.setMeta('job',job);if(job.state==='succeeded'){
      if(job.type==='inspect')session.updateMeta({phase:'awaiting-selection',candidateSheets:normalizeCandidateSheets(job.result.sheets),inspection:{sourceBytes:job.result.sourceBytes,totalUncompressed:job.result.totalUncompressed,date1904:job.result.date1904},error:null});
      else if(['import','aggregate-sales','apply-review','recompute'].includes(job.type))session.updateMeta({phase:'reviewing',error:null,...(job.type==='recompute'?{artifact:null}:{})});
      else if(job.result?.artifactPath){const meta=session.metadata(),fingerprint=digest([meta.sourceHash,meta.revision,meta.generation,meta.rulesFingerprint]),artifact=session.registerArtifact(job.result.artifactPath,job.result.artifactName,fingerprint);session.updateMeta({phase:'reviewing',artifact,error:null});}
    }else if(['failed','canceled'].includes(job.state)){const prior=session.getMeta('generation',0)>0?'reviewing':job.state==='canceled'?'canceled':'failed';session.updateMeta({phase:prior,error:job.error});}
    }finally{session.close();}
  }
  const broker=new FileJobBroker({onChange:onJobChange});
  for(const item of fs.readdirSync(root,{withFileTypes:true})){if(!item.isDirectory())continue;try{const s=new ImportSessionStore(path.join(root,item.name)),meta=s.metadata();if(['inspecting','importing','deriving','applying','exporting'].includes(meta.phase))s.updateMeta({phase:'interrupted',error:{code:'INTERRUPTED',message:'上次文件任务在应用关闭时中断。'}});s.close();}catch{}}

  function startSessionJob(id,type,payload={},extra={}){
    if(restoring)throw new SessionError(409,'正在恢复工作区，文件任务暂停。','RESTORE_IN_PROGRESS');const directory=sessionDirectory(id),session=openSession(id);let meta;try{meta=session.metadata();if(type!=='export-rescue')assertCurrent(meta);}finally{session.close();}const sourcePath=path.join(directory,'source.xlsx'),outputDir=path.join(directory,'artifacts');fs.mkdirSync(outputDir,{recursive:true});const outputPath=path.join(outputDir,`${crypto.randomUUID()}.${type==='export-rescue'?'ndjson':'xlsx'}`),job=broker.start(type,payload,{sessionId:id,workspaceId:meta.workspaceId,storageEpoch:meta.storageEpoch,generation:meta.generation,revision:meta.revision,rulesFingerprint:meta.rulesFingerprint,sessionDirectory:directory,sourcePath,templatePath:TEMPLATE,outputPath,outputDir,...extra}),marker=openSession(id);try{marker.updateMeta({job,phase:phaseFor(type),error:null});}finally{marker.close();}return job;
  }
  async function upload(id,request,ownerToken){
    const directory=sessionDirectory(id),session=openSession(id);try{assertCurrent(session.assertContext({ownerToken}));if(request.headers['content-type']&&!request.headers['content-type'].startsWith('application/octet-stream'))throw new SessionError(415,'请以原始文件流上传 Excel。','UNSUPPORTED_CONTENT_TYPE');if(broker.active)throw new SessionError(409,'已有文件任务正在进行。','FILE_JOB_BUSY');const statfs=fs.statfsSync(root),free=Number(statfs.bavail)*Number(statfs.bsize);if(free<FREE_LIMIT)throw new SessionError(507,'磁盘剩余空间不足 1 GiB。','DISK_SPACE_LOW');if(directoryBytes(root)>SESSION_TOTAL_LIMIT)throw new SessionError(507,'文件会话已占用 8 GiB，请先放弃不需要的会话。','SESSION_QUOTA');const part=path.join(directory,`source.${crypto.randomUUID()}.part`),hash=crypto.createHash('sha256');let bytes=0;request.on('data',chunk=>{bytes+=chunk.length;hash.update(chunk);if(bytes>LIMITS.sourceBytes)request.destroy(new SessionError(413,'文件超过 100 MiB。','SOURCE_TOO_LARGE'));});try{await pipeline(request,fs.createWriteStream(part,{flags:'wx'}));}catch(error){try{fs.unlinkSync(part);}catch{}throw error;}if(bytes===0){fs.unlinkSync(part);throw new SessionError(422,'上传文件为空。','EMPTY_FILE');}if(directoryBytes(directory)>SESSION_LIMIT){fs.unlinkSync(part);throw new SessionError(507,'当前会话占用超过 2 GiB。','SESSION_QUOTA');}assertCurrent(session.metadata());assertIdle();const source=path.join(directory,'source.xlsx');fs.renameSync(part,source);session.updateMeta({phase:'inspecting',sourceHash:hash.digest('hex'),sourceBytes:bytes,candidateSheets:[],artifact:null,error:null});return startSessionJob(id,'inspect',{});}finally{session.close();}
  }
  function status(id){const session=openSession(id);try{const meta=session.metadata(),counts=session.counts(meta.generation||0),job=meta.job?.jobId?broker.get(meta.job.jobId)||meta.job:null,candidateSheets=meta.candidateSheets||[],ctx=context(store),originalWorkspaceContext=meta.workspaceId!==ctx.workspaceId||Number(meta.storageEpoch)!==Number(ctx.storageEpoch),rulesStale=meta.kind==='product'&&Number(meta.generation)>0&&!originalWorkspaceContext&&digest(currentRules())!==meta.rulesFingerprint;return {sessionId:id,kind:meta.kind,phase:meta.phase,revision:meta.revision,generation:meta.generation,workspaceId:meta.workspaceId,storageEpoch:meta.storageEpoch,candidateSheets,sheets:candidateSheets,inspection:meta.inspection||null,selectedSheets:meta.selectedSheets||[],duplicateRows:meta.duplicateRows||0,job,ready:counts.ready&&!rulesStale&&!originalWorkspaceContext,rulesStale,originalWorkspaceContext,counts,artifactId:meta.artifact?.artifactId||null,artifact:meta.artifact||null,error:meta.error||null};}finally{session.close();}}
  async function handle(request,response,url){
    const parts=url.pathname.split('/').filter(Boolean);if(parts[0]!=='api'||!['file-sessions','file-jobs'].includes(parts[1]))return false;
    if(parts[1]==='file-jobs'){
      if(parts.length===2&&request.method==='GET')return json(response,200,{busy:!!broker.active,canQuit:!restoring&&broker.canQuit(),restoring,active:broker.get(broker.active?.jobId)}),true;
      if(parts[2]==='inspect-backup'&&parts[3]==='source'&&request.method==='POST'){
        if(broker.active)throw new SessionError(409,'已有文件任务正在进行。','FILE_JOB_BUSY');const taskDir=path.join(root,`aux-${crypto.randomUUID()}`);fs.mkdirSync(taskDir,{recursive:true});const inputPath=path.join(taskDir,'backup.xlsx');let size=0;const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>15*1024*1024)return callback(new SessionError(413,'备份文件超过 15 MiB。','BACKUP_TOO_LARGE'));callback(null,chunk);}});try{await pipeline(request,limit,fs.createWriteStream(inputPath,{flags:'wx'}));}catch(error){try{fs.rmSync(taskDir,{recursive:true,force:true});}catch{}throw error;}if(!size){fs.rmSync(taskDir,{recursive:true,force:true});throw new SessionError(422,'备份文件为空。','EMPTY_FILE');}const ctx=context(store),job=broker.start('inspect-backup',{filename:decodeURIComponent(request.headers['x-file-name']||'backup.xlsx')},{...ctx,outputDir:taskDir,inputPath});return json(response,202,{jobId:job.jobId}),true;
      }
      if(parts.length===2&&request.method==='POST'){const input=await readJson(request,20*1024*1024);if(!ALLOWED_AUXILIARY.has(input.type))throw new SessionError(400,'该文件任务不允许。','UNKNOWN_FILE_JOB');const taskDir=path.join(root,`aux-${crypto.randomUUID()}`);fs.mkdirSync(taskDir,{recursive:true});const job=broker.start(input.type,input.payload||{},{workspaceId:context(store).workspaceId,storageEpoch:context(store).storageEpoch,outputDir:taskDir,outputPath:path.join(taskDir,`${crypto.randomUUID()}.xlsx`)});return json(response,202,{jobId:job.jobId}),true;}
      const jobId=parts[2],job=broker.get(jobId);if(!job)throw new SessionError(404,'文件任务不存在。','JOB_NOT_FOUND');
      if(parts.length===3&&request.method==='GET'){const ctx=context(store);if(job.type==='inspect-backup'&&(job.workspaceId!==ctx.workspaceId||job.storageEpoch!==ctx.storageEpoch))throw new SessionError(409,'工作区已恢复，请重新检查备份。','WORKSPACE_CONTEXT_CHANGED');return json(response,200,job),true;}
      if(parts[3]==='cancel'&&request.method==='POST')return json(response,202,broker.cancel(jobId)),true;
      if(parts[3]==='download'&&request.method==='GET'){const filename=job.result?.artifactPath;if(job.state!=='succeeded'||!filename||!fs.existsSync(filename))throw new SessionError(404,'可下载文件不存在。','ARTIFACT_NOT_FOUND');response.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(safeName(job.result.artifactName))}`,'Content-Length':fs.statSync(filename).size});fs.createReadStream(filename).pipe(response);return true;}
      throw new SessionError(405,'文件任务操作不支持。','METHOD_NOT_ALLOWED');
    }
    if(parts.length===2&&request.method==='GET'){const items=[];for(const item of fs.readdirSync(root,{withFileTypes:true})){if(!item.isDirectory()||!item.name.match(/^[0-9a-f-]{36}$/))continue;try{items.push(status(item.name));}catch{items.push({sessionId:item.name,phase:'failed',error:{code:'SESSION_DAMAGED',message:'会话数据库无法读取'}});}}return json(response,200,{items}),true;}
    if(parts.length===2&&request.method==='POST'){
      const input=await readJson(request),kind=input.kind;if(!['product','sales'].includes(kind))throw new SessionError(400,'文件会话类型无效。','INVALID_SESSION_KIND');const ctx=context(store),id=crypto.randomUUID(),ownerToken=crypto.randomUUID(),directory=path.join(root,id),rules=input.rules||currentRules();const session=new ImportSessionStore(directory,{create:true,meta:{sessionId:id,kind,ownerToken,workspaceId:ctx.workspaceId,storageEpoch:ctx.storageEpoch,target:input.target||null,rules,rulesFingerprint:digest(rules)}});session.close();return json(response,201,{sessionId:id,ownerToken,revision:0,...ctx}),true;
    }
    const id=parts[2];if(!id)throw new SessionError(404,'文件会话不存在。','SESSION_NOT_FOUND');
    if(parts.length===3&&request.method==='GET')return json(response,200,status(id)),true;
    if(parts[3]==='source'&&request.method==='PUT'){const job=await upload(id,request,request.headers['x-session-owner']);return json(response,202,{jobId:job.jobId,...status(id)}),true;}
    if(parts[3]==='select-sheet'&&request.method==='POST'){
      const input=await readJson(request),session=openSession(id);
      try{
        const meta=assertCurrent(session.assertContext(input));
        if(broker.active)throw new SessionError(409,'已有文件任务正在进行。','FILE_JOB_BUSY');
        if(Number(meta.generation)>0)throw new SessionError(409,'该会话已进入复核，请重新选择文件建立新导入。','IMPORT_ALREADY_PUBLISHED');
        const sheets=session.getMeta('candidateSheets',[]),sales=meta.kind==='sales';
        const choices=input.selections??[{sheetId:input.sheetId,mapping:input.mapping}];
        if(!Array.isArray(choices)||!choices.length||new Set(choices.map(x=>x?.sheetId)).size!==choices.length)throw new SessionError(422,'请选择工作表，且不能重复选择。','INVALID_SHEET_SELECTION');
        if(sales&&choices.length!==1)throw new SessionError(422,'销售导入每次请选择一个工作表。','INVALID_SHEET_SELECTION');
        const selections=choices.map(choice=>{
          const selected=sheets.find(x=>x.sheetId===choice?.sheetId);
          if(!selected)throw new SessionError(422,'选中的工作表不存在。','SHEET_NOT_FOUND');
          const mapping={...normalizeMapping(selected.mapping),...normalizeMapping(choice.mapping)};
          if(!sales&&Recognition.productMappingIssues(selected.header.headers,mapping).length)throw new SessionError(422,`请确认“${selected.name}”的商品字段。`,'PRODUCT_MAPPING_REQUIRED');
          if(sales&&!Number.isInteger(mapping.sales))throw new SessionError(422,'请明确选择数量列。','SALES_QUANTITY_REQUIRED');
          return {sheetId:selected.sheetId,mapping};
        });
        const rules=input.rules||currentRules(),type=sales?'aggregate-sales':'import';
        const payload=sales?{...selections[0],rules,period:input.period||null}:{selections,rules};
        const job=startSessionJob(id,type,payload);
        return json(response,202,{jobId:job.jobId}),true;
      }finally{session.close();}
    }
    if(parts[3]==='rows'&&request.method==='GET'){const session=openSession(id);try{const meta=assertCurrent(session.metadata()),rulesStale=digest(currentRules())!==meta.rulesFingerprint,page=session.page({status:url.searchParams.get('status')||'all',missingThickness:url.searchParams.get('missingThickness')==='1',page:url.searchParams.get('page')||1,pageSize:url.searchParams.get('pageSize')||100});return json(response,200,{...page,rulesStale,ready:page.ready&&!rulesStale}),true;}finally{session.close();}}
    if(parts[3]==='sales-aggregates'&&request.method==='GET'){const session=openSession(id);try{assertCurrent(session.metadata());if(session.getMeta('kind')!=='sales')throw new SessionError(422,'该会话不是销售导入。','INVALID_SESSION_KIND');return json(response,200,session.salesPage({page:url.searchParams.get('page')||1,pageSize:url.searchParams.get('pageSize')||100})),true;}finally{session.close();}}
    if(parts[3]==='sales-candidate'&&request.method==='POST'){const input=await readJson(request),session=openSession(id);try{assertCurrent(session.metadata());if(session.getMeta('kind')!=='sales')throw new SessionError(422,'该会话不是销售导入。','INVALID_SESSION_KIND');assertIdle();session.assertContext(input);return json(response,200,session.salesCandidate(input)),true;}finally{session.close();}}
    if(parts[3]==='sales-reviews'&&request.method==='POST'){const input=await readJson(request),session=openSession(id);try{assertCurrent(session.metadata());if(session.getMeta('kind')!=='sales')throw new SessionError(422,'该会话不是销售导入。','INVALID_SESSION_KIND');assertIdle();return json(response,200,session.salesReview(input)),true;}finally{session.close();}}
    if(parts[3]==='reviews'&&request.method==='POST'){
      const input=await readJson(request),session=openSession(id);try{
        assertCurrent(session.metadata());const replay=session.checkedReceipt(input);if(replay)return json(response,200,replay),true;
        const meta=session.assertContext(input),rules=assertRules(meta);assertIdle();
        if(session.targetRowCount(input)>1000){session.close();const job=startSessionJob(id,'apply-review',{command:input,rules});return json(response,202,{jobId:job.jobId}),true;}
        return json(response,200,session.applyReview(input,rules)),true;
      }finally{session.close();}
    }
    if(parts[3]==='undo'&&request.method==='POST'){const input=await readJson(request),session=openSession(id);try{const meta=assertCurrent(session.assertContext(input)),rules=assertRules(meta);assertIdle();return json(response,200,session.undo(input,rules)),true;}finally{session.close();}}
    if(parts[3]==='recompute'&&request.method==='POST'){
      const input=await readJson(request),session=openSession(id);try{const meta=assertCurrent(session.assertContext(input));assertIdle();if(meta.kind!=='product'||!meta.generation)throw new SessionError(422,'请先读取商品规格。','IMPORT_NOT_READY');const job=startSessionJob(id,'recompute',{rules:currentRules()});return json(response,202,{jobId:job.jobId}),true;}finally{session.close();}
    }
    if(parts[3]==='export'&&request.method==='POST'){const input=await readJson(request),session=openSession(id);try{const meta=assertCurrent(session.assertContext(input));assertRules(meta);assertIdle();if(!session.counts(meta.generation).ready)throw new SessionError(422,'仍有未确认规格，禁止导出。','SESSION_NOT_READY');const job=startSessionJob(id,'export-product',{});return json(response,202,{jobId:job.jobId}),true;}finally{session.close();}}
    if(parts[3]==='rescue'&&request.method==='POST'){const input=await readJson(request),session=openSession(id);try{session.assertContext(input);const job=startSessionJob(id,'export-rescue',{});return json(response,202,{jobId:job.jobId}),true;}finally{session.close();}}
    if(parts[3]==='download'&&request.method==='GET'){const artifactId=url.searchParams.get('artifactId'),session=openSession(id);try{const artifact=session.artifact(artifactId),meta=session.metadata();if(!artifact||!fs.existsSync(artifact.filename))throw new SessionError(404,'导出文件已失效。','ARTIFACT_NOT_FOUND');if(!artifact.name.endsWith('.ndjson')){assertCurrent(meta);assertRules(meta);}const expected=digest([meta.sourceHash,meta.revision,meta.generation,meta.rulesFingerprint]);if(artifact.fingerprint!==expected)throw new SessionError(409,'复核或规则已变更，请重新生成。','ARTIFACT_STALE');response.writeHead(200,{'Content-Type':artifact.name.endsWith('.ndjson')?'application/x-ndjson':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(safeName(artifact.name))}`,'Content-Length':fs.statSync(artifact.filename).size});fs.createReadStream(artifact.filename).pipe(response);return true;}finally{session.close();}}
    if(parts[3]==='discard'&&request.method==='POST'){const input=await readJson(request),session=openSession(id);try{session.assertContext(input);}finally{session.close();}discarding.add(id);try{const job=broker.active?.sessionId===id?broker.active:null;if(job){broker.cancel(job.jobId);await broker.waitForExit(job.jobId);}await fs.promises.rm(sessionDirectory(id),{recursive:true,force:true,maxRetries:3,retryDelay:100});return json(response,200,{discarded:true}),true;}finally{discarding.delete(id);}}
    throw new SessionError(405,'文件会话操作不支持。','METHOD_NOT_ALLOWED');
  }
  async function beforeRestore(){restoring=true;const job=broker.active;if(job){broker.cancel(job.jobId);await broker.waitForExit(job.jobId);}}
  async function afterRestore({committed}={}){try{if(committed){const ctx=context(store);for(const item of fs.readdirSync(root,{withFileTypes:true})){if(!item.isDirectory()||!item.name.match(/^[0-9a-f-]{36}$/))continue;try{const session=new ImportSessionStore(path.join(root,item.name));session.updateMeta({originalWorkspaceContext:true,currentStorageEpoch:ctx.storageEpoch});session.close();}catch{}}}}finally{restoring=false;}}
  async function withWorkspaceWrite(fn,state){if(workspaceWrite)throw new SessionError(409,'工作区正在提交关联规则。','WORKSPACE_WRITE_BUSY');workspaceWrite=true;try{if(broker.active&&state&&digest(ruleSnapshot(state))!==digest(currentRules()))throw new SessionError(409,'文件任务正在使用当前规则，请完成或取消后再修改规则。','FILE_JOB_BUSY');return await fn();}finally{workspaceWrite=false;}}
  return {handle,beforeRestore,afterRestore,canQuit:()=>!restoring&&broker.canQuit(),close:()=>broker.stop(),withWorkspaceWrite,startAuxiliaryJob:(type,payload,ctx)=>broker.start(type,payload,ctx),broker};
}

module.exports={createFileService,readJson,ruleSnapshot,normalizeCandidateSheets,normalizeMapping};
