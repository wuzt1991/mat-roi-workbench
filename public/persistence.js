(function(root){
  'use strict';
  const equal=(a,b)=>{
    if(Object.is(a,b))return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
  };
  class SaveQueue {
    constructor({revision=0,workspaceId=null,storageEpoch=null,send,read,refresh,cache,status=()=>{},delay=400}) {
      Object.assign(this,{revision,workspaceId,storageEpoch,send,read:read||refresh,cache,status,delay});
      this.pending=null;this.sending=false;this.blocked=false;this.timer=null;this.lastError=null;this.failedSent=null;this.cacheFailed=false;this.generation=0;this.disposed=false;this.paused=false;
    }
    enqueue(state,reason='save') {
      if(this.disposed)throw Error('保存队列已结束。');
      if(this.paused)throw Error('正在恢复工作区，暂不能编辑。');
      if(reason!=='save')throw Object.assign(Error('整库恢复须使用独立恢复接口。'),{code:'INVALID_SAVE_REASON'});
      this.pending={state:structuredClone(state),reason:'save'};this.remember();
      this.status(this.blocked?'conflict':'pending',this.lastError);clearTimeout(this.timer);
      if(!this.blocked)this.timer=setTimeout(()=>this.flush(),this.delay);
    }
    cacheOperation(action){
      const generation=this.generation;
      this.cachePromise=(this.cachePromise||Promise.resolve()).then(async()=>{
        if(this.disposed||generation!==this.generation)return;
        try{await action();this.cacheFailed=false;}catch(error){this.cacheFailed=true;this.cacheError=error;}
      });
      return this.cachePromise;
    }
    remember(){
      if(!this.pending)return Promise.resolve();
      const payload={workspaceId:this.workspaceId,storageEpoch:this.storageEpoch,baseRevision:this.revision,...this.pending,sentState:this.failedSent?.state,updated:Date.now()};
      return this.cacheOperation(()=>this.cache?.write(payload));
    }
    contextMatches(result){return (!this.workspaceId||!result.workspaceId||this.workspaceId===result.workspaceId)&&(this.storageEpoch===null||result.storageEpoch===undefined||this.storageEpoch===result.storageEpoch);}
    async acknowledge(sent,result,generation){
      if(this.disposed||generation!==this.generation)return false;
      if(!Number.isSafeInteger(result?.revision)||result.revision<=this.revision||!this.contextMatches(result))throw Object.assign(Error('保存响应与当前工作区不一致，请重新载入。'),{status:409,code:'WORKSPACE_CONTEXT_CHANGED'});
      this.revision=result.revision;this.lastError=null;this.failedSent=null;
      if(result.workspaceId)this.workspaceId=result.workspaceId;if(result.storageEpoch!==undefined)this.storageEpoch=result.storageEpoch;
      if(this.pending===sent){
        this.pending=null;
        await this.cacheOperation(()=>!this.pending?this.cache?.clear():undefined);
        if(!this.disposed&&generation===this.generation&&!this.pending)this.status('saved');
      }else await this.remember();
      return true;
    }
    async reconcile(generation){
      if(!this.failedSent||!this.read)return true;
      const sent=this.failedSent,latest=await this.read();
      if(this.disposed||generation!==this.generation)return false;
      if(!this.contextMatches(latest))throw Object.assign(Error('工作区已恢复，请导出草稿后重新载入。'),{status:409,code:'WORKSPACE_CONTEXT_CHANGED'});
      if(latest.revision===sent.revision){this.failedSent=null;return true;}
      if(latest.revision===sent.revision+1&&equal(latest.state,sent.state))return this.acknowledge(sent.pending,latest,generation);
      throw Object.assign(Error('数据库已有其他更新。请导出本页草稿后重新载入，不能自动覆盖。'),{status:409,code:'REVISION_CONFLICT'});
    }
    async flush(){
      clearTimeout(this.timer);
      if(this.sending)return this.inFlight;
      if(this.disposed||this.paused||this.blocked)return !this.pending&&!this.failedSent;
      if(!this.pending)return true;
      this.sending=true;const generation=this.generation;
      this.inFlight=(async()=>{
        try{
          if(!await this.reconcile(generation))return false;
          while(this.pending&&!this.blocked&&!this.disposed&&!this.paused){
            const sent=this.pending,sentRevision=this.revision;this.status('saving');
            let result;
            try{result=await this.send(sent.state,sentRevision,'save',{workspaceId:this.workspaceId,storageEpoch:this.storageEpoch});}
            catch(error){if(!error.status||error.status>=500)this.failedSent={state:structuredClone(sent.state),pending:sent,revision:sentRevision};throw error;}
            if(!await this.acknowledge(sent,result,generation))return false;
          }
          return !this.pending;
        }catch(error){
          if(this.disposed||generation!==this.generation)return false;
          this.lastError=error;this.blocked=error.status===409;await this.remember();this.status(this.blocked?'conflict':'error',error);return false;
        }finally{this.sending=false;}
      })();
      return this.inFlight;
    }
    async pause(){const saved=await this.flush();if(saved)this.paused=true;return saved;}
    resume(){if(!this.disposed){this.paused=false;if(this.pending&&!this.blocked)this.timer=setTimeout(()=>this.flush(),this.delay);}}
    canQuit(){return !this.pending&&!this.sending&&!this.failedSent&&!this.paused;}
    dispose(){clearTimeout(this.timer);this.disposed=true;this.generation++;}
  }
  const api={SaveQueue,deepEqual:equal};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkbenchPersistence=api;
})(typeof window!=='undefined'?window:globalThis);
