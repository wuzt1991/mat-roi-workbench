(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FileJobs=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const owners=new Map();
  async function responseValue(response){const type=response.headers.get('content-type')||'',value=type.includes('json')?await response.json():await response.text();if(!response.ok){const error=Error(value?.error||value||'请求失败');error.status=response.status;error.code=value?.code||'REQUEST_FAILED';throw error;}return value;}
  async function request(method,url,body,{owner,raw=false,signal}={}){const headers={'x-workbench':'1'},options={method,headers,signal};if(owner)headers['x-session-owner']=owner;if(body!==undefined){if(raw){headers['Content-Type']='application/octet-stream';options.body=body;}else{headers['Content-Type']='application/json';options.body=JSON.stringify(body);}}return responseValue(await fetch(url,options));}
  function owner(id,value){if(value)owners.set(id,value);return value||owners.get(id)||'';}
  async function create(kind,target={},rules){const result=await request('POST','/api/file-sessions',{kind,target,rules});owner(result.sessionId,result.ownerToken);return result;}
  const upload=(id,file,options={})=>request('PUT',`/api/file-sessions/${encodeURIComponent(id)}/source`,file,{raw:true,owner:options.ownerToken||owner(id),signal:options.signal});
  const status=id=>request('GET',`/api/file-sessions/${encodeURIComponent(id)}`);
  const sessions=()=>request('GET','/api/file-sessions');
  const selectSheet=(id,input)=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/select-sheet`,{...input,ownerToken:input.ownerToken||owner(id)});
  function rows(id,{status='all',missingThickness=false,page=1,pageSize=100,attention=false}={}){const query=new URLSearchParams({attention:attention?'1':'0',status,missingThickness:missingThickness?'1':'0',page:String(page),pageSize:String(pageSize)});return request('GET',`/api/file-sessions/${encodeURIComponent(id)}/rows?${query}`);}
  function salesAggregates(id,{page=1,pageSize=100}={}){const query=new URLSearchParams({page:String(page),pageSize:String(pageSize)});return request('GET',`/api/file-sessions/${encodeURIComponent(id)}/sales-aggregates?${query}`);}
  const salesCandidate=(id,input)=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/sales-candidate`,{...input,ownerToken:input.ownerToken||owner(id)});
  const salesReview=(id,input)=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/sales-reviews`,{...input,ownerToken:input.ownerToken||owner(id)});
  const salesReviews=salesReview;
  const review=(id,input)=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/reviews`,{...input,ownerToken:input.ownerToken||owner(id)});
  const undo=(id,input)=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/undo`,{...input,ownerToken:input.ownerToken||owner(id)});
  const startExport=(id,input={})=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/export`,{...input,ownerToken:input.ownerToken||owner(id)});
  const recompute=(id,input={})=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/recompute`,{...input,ownerToken:input.ownerToken||owner(id)});
  const rescue=(id,input={})=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/rescue`,{...input,ownerToken:input.ownerToken||owner(id)});
  const downloadUrl=(id,artifactId)=>`/api/file-sessions/${encodeURIComponent(id)}/download?artifactId=${encodeURIComponent(artifactId)}`;
  const cancel=jobId=>request('POST',`/api/file-jobs/${encodeURIComponent(jobId)}/cancel`,{});
  const discard=(id,input={})=>request('POST',`/api/file-sessions/${encodeURIComponent(id)}/discard`,{...input,ownerToken:input.ownerToken||owner(id)}).then(result=>(owners.delete(id),result));
  const startAuxiliary=(type,payload)=>request('POST','/api/file-jobs',{type,payload});
  const inspectBackup=(file,{signal}={})=>fetch('/api/file-jobs/inspect-backup/source',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-workbench':'1','x-file-name':encodeURIComponent(file.name||'backup.xlsx')},body:file,signal}).then(responseValue);
  const job=jobId=>request('GET',`/api/file-jobs/${encodeURIComponent(jobId)}`);
  const auxiliaryDownloadUrl=jobId=>`/api/file-jobs/${encodeURIComponent(jobId)}/download`;
  async function waitForJob(jobId,{signal,interval=250,onProgress}={}){while(true){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const value=await job(jobId);onProgress?.(value.progress,value);if(['succeeded','failed','canceled'].includes(value.state)){if(value.state==='succeeded')return value;const error=Error(value.error?.message||'文件任务未完成');error.code=value.error?.code||value.state.toUpperCase();throw error;}await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,interval);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});}}
  const reviews=review;
  return {create,upload,status,sessions,selectSheet,rows,salesAggregates,salesCandidate,salesReview,salesReviews,review,reviews,undo,startExport,recompute,rescue,downloadUrl,cancel,discard,startAuxiliary,inspectBackup,job,auxiliaryDownloadUrl,waitForJob,owner};
});
