(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductTransferCommands=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const failure=(code,message)=>Object.assign(Error(message),{code});

  // One immutable command per user intent. Recovery only reads; only an explicit
  // subsequent submit can retry a command that is known not to have committed.
  function create({request,waitForJob,newId}){
    let pending=null,serial=0,inFlight=null;
    function reset(){serial++;pending=null;inFlight=null;}
    function uncertain(){return pending?.phase==='unknown';}
    async function probe(record){
      return request('mutationStatus',{sessionId:record.session.sessionId,kind:record.kind,command:record.command});
    }
    async function execute(record,token){
      const current=()=>{if(token!==serial)throw failure('STALE_CONTEXT','当前操作上下文已切换。');};
      const finish=result=>{current();pending=null;return result;};
      const wait=async result=>{current();return result?.jobId?waitForJob(result.jobId,record.session):result;};
      try{
        if(record.phase!=='new'){
          const status=await probe(record);current();
          if(status.state==='committed')return finish(status.result);
          if(status.state==='running')return finish(await wait(status));
          if(status.state==='conflict')throw failure('SESSION_CONFLICT','数据已变化，请保留输入并重新核对。');
          if(status.state!=='not-committed')throw failure('OUTCOME_UNKNOWN','上次操作结果待核对，请重试核对，勿重复修改。');
        }
        record.phase='unknown';
        const key=record.kind==='recompute'?'options':'command';
        const result=await request(record.kind,{sessionId:record.session.sessionId,[key]:record.command});
        return finish(await wait(result));
      }catch(error){
        current();
        if(error.status>=400&&error.status<500||error.code==='SESSION_CONFLICT'){pending=null;throw error;}
        try{
          const status=await probe(record);current();
          if(status.state==='committed')return finish(status.result);
          if(status.state==='running')return finish(await wait(status));
          if(status.state==='not-committed'){
            record.phase='retryable';
            throw failure('NOT_COMMITTED',error.message||'修改尚未保存，输入已保留。');
          }
          if(status.state==='conflict'){pending=null;throw failure('SESSION_CONFLICT','数据已变化，请保留输入并重新核对。');}
        }catch(recoveryError){
          if(['STALE_CONTEXT','NOT_COMMITTED','SESSION_CONFLICT'].includes(recoveryError.code))throw recoveryError;
        }
        record.phase='unknown';
        throw failure('OUTCOME_UNKNOWN','操作结果暂时无法确认，输入已保留。请重试核对原操作。');
      }
    }
    function run(kind,session,fields){
      const identity=JSON.stringify({kind,sessionId:session.sessionId,ownerToken:session.ownerToken,fields});
      if(pending&&pending.identity!==identity&&uncertain())return Promise.reject(failure('OUTCOME_UNKNOWN','请先核对上次操作，再修改内容。'));
      if(inFlight)return pending?.identity===identity?inFlight:Promise.reject(failure('OPERATION_BUSY','已有修改正在保存。'));
      if(!pending||pending.identity!==identity)pending={identity,kind,session,phase:'new',command:copy({mutationId:newId(),expectedSessionRevision:session.revision,ownerToken:session.ownerToken,...fields})};
      const token=serial,promise=execute(pending,token);inFlight=promise;
      return promise.finally(()=>{if(inFlight===promise)inFlight=null;});
    }
    async function reconcile(){
      const record=pending,token=serial;if(!record)return null;
      const status=await probe(record);if(token!==serial)throw failure('STALE_CONTEXT','当前操作上下文已切换。');
      if(status.state==='committed'){pending=null;return {committed:true,result:status.result};}
      if(status.state==='not-committed'){record.phase='retryable';return {committed:false};}
      if(status.state==='conflict'){pending=null;throw failure('SESSION_CONFLICT','数据已变化，请保留输入并重新核对。');}
      throw failure('OUTCOME_UNKNOWN',status.state==='running'?'操作仍在处理，请稍后再次核对。':'操作结果暂时无法确认，请稍后再次核对。');
    }
    return {run,reconcile,reset,uncertain,inspect:()=>pending&&copy({kind:pending.kind,phase:pending.phase,command:pending.command})};
  }
  return {create};
});
