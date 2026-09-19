'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store, StoreError } = require('./store.cjs');
const { version } = require('../package.json');
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function defaultDirectory() {
  return process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MatROIWorkbench') :
    process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'MatROIWorkbench') : path.join(os.homedir(), '.local', 'share', 'mat-roi-workbench');
}
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}
async function body(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new StoreError(413, '数据超过 20 MB，请拆分备份或联系维护人员。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new StoreError(400, '请求内容不是有效 JSON。'); }
}
function createServer({ dataDir = defaultDirectory(), port = 4173, storeOptions, fileServiceFactory } = {}) {
  const store = new Store(dataDir,storeOptions);
  let factory=fileServiceFactory;
  if(factory===undefined){try{factory=require('./file-service.cjs').createFileService;}catch(error){if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'./file-service.cjs'"))throw error;}}
  const fileService=factory?factory({store,dataDir}):null;
  let restoring=false,activeRequests=0,requestsDrained;
  const attachment=(response,name,raw)=>{response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+name+'"'});response.end(raw);};
  const requireJSON=request=>{if(!request.headers['content-type']?.startsWith('application/json')||request.headers['x-workbench']!=='1')throw new StoreError(415,'请求格式不支持。','UNSUPPORTED_CONTENT_TYPE');};
  const server = http.createServer(async (request, response) => {
    activeRequests++;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const origin = `http://127.0.0.1:${server.address()?.port}`;
    try {
      if (request.headers.host !== origin.slice(7)) throw new StoreError(403, '仅允许从本机工作台地址访问。');
      if (request.headers.origin && request.headers.origin !== origin) throw new StoreError(403, '请求来源无效。');
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new StoreError(403, '不允许跨站访问。');
      const url = new URL(request.url, origin);
      if (url.pathname === '/app-config.js' && ['GET','HEAD'].includes(request.method)) {
        response.writeHead(200, {'Content-Type':TYPES['.js']});
        return response.end(request.method==='HEAD'?undefined:'window.WorkbenchConfig=Object.freeze('+JSON.stringify({version,platform:process.platform,updatesSupported:process.platform==='win32'&&process.arch==='x64'})+');');
      }
      if (url.pathname === '/api/health') return json(response, 200, { app: 'mat-roi-workbench', version, dataDir:path.resolve(dataDir) });
      if (url.pathname === '/api/recovery/status' && request.method === 'GET') return json(response,200,store.recoveryStatus());
      if (url.pathname === '/api/recovery/current/raw' && request.method === 'GET') return attachment(response,'workspace-original.json',store.rawCurrent());
      if (url.pathname === '/api/state' && request.method === 'GET') return json(response, 200, store.read());
      if (url.pathname === '/api/state' && request.method === 'PUT') {
        requireJSON(request);
        if(restoring)throw new StoreError(409,'正在恢复工作区，请稍后重试。','RESTORE_IN_PROGRESS');
        const input = await body(request);
        if (input.reason!==undefined&&input.reason!=='save') throw new StoreError(400,'普通保存不允许迁移或整库恢复。','INVALID_SAVE_REASON');
        const meta=store.metadata();
        if((input.workspaceId!==undefined&&input.workspaceId!==meta.workspaceId)||(input.storageEpoch!==undefined&&input.storageEpoch!==meta.storageEpoch))throw new StoreError(409,'工作区已恢复，请刷新后重试。','WORKSPACE_CONTEXT_CHANGED');
        const save=()=>{if(restoring)throw new StoreError(409,'正在恢复工作区，请稍后重试。','RESTORE_IN_PROGRESS');return store.write(input.state,input.revision);};
        const result=fileService?.withWorkspaceWrite?await fileService.withWorkspaceWrite(save,input.state):save();
        return json(response,200,result);
      }
      if (url.pathname === '/api/restore' && request.method === 'POST') {
        requireJSON(request);
        const input=await body(request);
        if(restoring)throw new StoreError(409,'已有恢复操作正在处理，请稍后核对结果。','RESTORE_IN_PROGRESS');
        restoring=true;let result;
        try {
          await fileService?.beforeRestore?.();
          result=store.restore(input.state,input.expectedRevision,input.operationId);
          return json(response,200,result);
        } finally {
          try{await fileService?.afterRestore?.({committed:!!result,result});}finally{restoring=false;}
        }
      }
      if (/^\/api\/backups\/\d+\/raw$/.test(url.pathname) && request.method === 'GET') {const id=Number(url.pathname.split('/')[3]);return attachment(response,'recovery-'+id+'-original.json',store.backupRaw(id));}
      if (url.pathname === '/api/backups' && request.method === 'GET') return json(response, 200, { items: store.backups(), dataDir });
      if (/^\/api\/backups\/\d+$/.test(url.pathname) && request.method === 'GET') return json(response, 200, store.backup(Number(url.pathname.split('/').at(-1))));
      if(fileService&&await fileService.handle(request,response,url))return;
      if(url.pathname==='/api/file-jobs/status'&&request.method==='GET')return json(response,200,{busy:false,canQuit:!restoring,restoring});
      if (url.pathname.startsWith('/api/')) throw new StoreError(404, '接口不存在。');
      if (!['GET', 'HEAD'].includes(request.method)) throw new StoreError(405, '操作不支持。');
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(PUBLIC, '.' + relative);
      if (!filename.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(filename)]) throw new StoreError(404, '文件不存在。');
      let bytes; try { bytes = fs.readFileSync(filename); } catch { throw new StoreError(404, '文件不存在。'); }
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(filename)] });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) { if(!response.headersSent)json(response,error.status||500,{error:error.status?error.message:'保存服务发生错误，请重试。已有数据保留。',code:error.code||'INTERNAL_ERROR'});else response.destroy(); }
    finally {if(--activeRequests===0)requestsDrained?.();}
  });
  server.requestTimeout = 15000;
  let resourcesClosed,shutdown;
  function closeResources(){
    if(!resourcesClosed)resourcesClosed=Promise.resolve().then(async()=>{
      // HTTP may finish before an asynchronous request finalizer (for example restore).
      if(activeRequests)await new Promise(resolve=>{requestsDrained=resolve;});
      try{await fileService?.close?.();}finally{store.close();}
    });
    return resourcesClosed;
  }
  // Keep direct server.close() compatible; callers needing cleanup completion use close().
  server.on('close',()=>{closeResources().catch(()=>{});});
  function close(){
    if(!shutdown)shutdown=new Promise((resolve,reject)=>{
      server.close(error=>{if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);else resolve();});
    }).finally(closeResources);
    return shutdown;
  }
  return { server,store,fileService,close,canQuit:()=>!restoring&&(fileService?.canQuit?.()??true), listen: () => new Promise((resolve, reject) => {
    if(shutdown||resourcesClosed)return reject(new Error('保存服务已经关闭。'));
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(`http://127.0.0.1:${server.address().port}`); });
  }) };
}
if (require.main === module) {
  const running = createServer({ port: Number(process.env.MAT_PORT || 4173), dataDir: process.env.MAT_DATA_DIR || defaultDirectory() });
  running.listen().then(url => console.log(`地垫工作台 v${version}：${url}\n数据目录：${path.dirname(running.store.filename)}`)).catch(error => { console.error(error.message); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {running.close().catch(error=>{console.error(error.message);process.exitCode=1;});});
}
module.exports = { createServer, defaultDirectory };
