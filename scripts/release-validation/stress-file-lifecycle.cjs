'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const runs=100,concurrency=4,results=[];let next=0;
async function worker(){
 while(next<runs){
  const attempt=++next;
  const result=await new Promise(resolve=>{
   let output='';const child=spawn(process.execPath,['--test','test/file-service-lifecycle.test.cjs']);
   child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
   child.once('error',error=>resolve({attempt,code:-1,output:String(error)}));
   child.once('close',code=>resolve({attempt,code,output}));
  });
  results.push(result);
  if(result.code!==0)console.log('::error::'+JSON.stringify(result).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
  if(results.length%10===0)console.log(`Completed ${results.length}/${runs}`);
 }
}
Promise.all(Array.from({length:concurrency},worker)).then(()=>{
 const report={host:process.platform,node:process.version,runs:results.length,concurrency,failed:results.filter(r=>r.code!==0).length,results};
 const out=path.resolve(process.env.MAT_DIAGNOSTIC_OUTPUT||'outputs/windows-lifecycle-diagnostic.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
 console.log('::notice::'+JSON.stringify({host:report.host,node:report.node,runs:report.runs,concurrency,failed:report.failed}));
 process.exitCode=report.failed?1:0;
}).catch(error=>{console.error(error);process.exitCode=1;});
