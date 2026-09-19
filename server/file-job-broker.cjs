'use strict';

const path=require('node:path');
const crypto=require('node:crypto');
const {fork}=require('node:child_process');
const {SessionError}=require('./import-session-store.cjs');

class FileJobBroker{
  constructor({entry=path.join(__dirname,'file-job-child.cjs'),stallMs=60000,budgetMs=15*60*1000,onChange}={}){this.entry=entry;this.stallMs=stallMs;this.budgetMs=budgetMs;this.onChange=onChange;this.jobs=new Map();this.active=null;this.closed=false;}
  snapshot(job){if(!job)return null;const {child,timers,payload,...publicJob}=job;return JSON.parse(JSON.stringify(publicJob));}
  get(jobId){return this.snapshot(this.jobs.get(jobId));}
  list(){return [...this.jobs.values()].map(job=>this.snapshot(job));}
  canQuit(){return !this.active;}
  start(type,payload,context={}){
    if(this.closed)throw new SessionError(503,'文件服务正在关闭。','FILE_SERVICE_CLOSED');if(this.active)throw new SessionError(409,'已有文件任务正在进行，请完成或取消后重试。','FILE_JOB_BUSY');
    const jobId=crypto.randomUUID(),job={jobId,type,state:'running',sessionId:context.sessionId||null,workspaceId:context.workspaceId||null,storageEpoch:context.storageEpoch??null,generation:context.generation??null,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),progress:{phase:'starting'},result:null,error:null,payload,child:null,timers:{}};this.jobs.set(jobId,job);this.active=job;
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'},child=fork(this.entry,[],{env,stdio:['ignore','ignore','ignore','ipc']});job.child=child;let settled=false;
    const touch=()=>{job.updatedAt=new Date().toISOString();clearTimeout(job.timers.stall);job.timers.stall=setTimeout(()=>finish('failed',null,{code:'JOB_STALLED',message:'文件任务 60 秒没有任何进展。'}),this.stallMs);this.onChange?.(this.snapshot(job));};
    const finish=(state,result,error)=>{if(settled)return;settled=true;for(const timer of Object.values(job.timers))clearTimeout(timer);job.state=state;job.result=result||null;job.error=error||null;job.updatedAt=new Date().toISOString();this.onChange?.(this.snapshot(job));if(child.connected)child.disconnect();if(!child.killed)child.kill();};
    child.on('message',message=>{if(message?.jobId!==jobId)return;if(message.type==='progress'){job.progress=message.progress||{};touch();}else if(message.type==='result')finish('succeeded',message.result,null);else if(message.type==='error')finish(message.error?.code==='CANCELED'?'canceled':'failed',null,message.error);});
    child.once('error',error=>finish('failed',null,{code:error.code||'CHILD_ERROR',message:error.message}));child.once('exit',(code,signal)=>{if(!settled)finish(job.cancelRequested?'canceled':'failed',null,{code:job.cancelRequested?'CANCELED':'CHILD_EXIT',message:job.cancelRequested?'任务已取消':`文件子进程异常退出 (${code??signal})`});if(this.active===job)this.active=null;});child.once('close',()=>{if(this.active===job)this.active=null;});
    job.timers.budget=setTimeout(()=>finish('failed',null,{code:'JOB_BUDGET_EXCEEDED',message:'文件任务超过 15 分钟资源预算。'}),this.budgetMs);touch();child.send({type:'run',jobId,jobType:type,payload,context});return this.snapshot(job);
  }
  cancel(jobId){const job=this.jobs.get(jobId);if(!job)throw new SessionError(404,'文件任务不存在。','JOB_NOT_FOUND');if(['succeeded','failed','canceled'].includes(job.state))return this.snapshot(job);job.cancelRequested=true;job.child?.send({type:'cancel',jobId});job.progress={...job.progress,message:'正在取消'};job.timers.force=setTimeout(()=>{if(job.child&&!job.child.killed)job.child.kill('SIGKILL');},3000);return this.snapshot(job);}
  async waitForExit(jobId,{timeout=6000}={}){const child=this.jobs.get(jobId)?.child;if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);child.removeListener('exit',done);child.removeListener('close',done);resolve();};const timer=setTimeout(()=>{child.removeListener('exit',done);child.removeListener('close',done);reject(new SessionError(503,'文件子进程尚未退出，请稍后重试。','FILE_CHILD_STILL_RUNNING'));},timeout);child.once('exit',done);child.once('close',done);});}
  async stop(){this.closed=true;const job=this.active;if(job){this.cancel(job.jobId);await this.waitForExit(job.jobId);}}
}

module.exports={FileJobBroker};
