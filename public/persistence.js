(function(root){
  'use strict';
  class SaveQueue {
    constructor({ revision=0, send, cache, status=()=>{}, delay=400 }) {
      Object.assign(this,{revision,send,cache,status,delay});
      this.pending=null;this.sending=false;this.blocked=false;this.timer=null;this.lastError=null;
    }
    enqueue(state,reason='save') {
      const previousReason=this.pending?.reason;
      this.pending={state:structuredClone(state),reason:reason==='save'&&previousReason==='restore'?'restore':reason};
      this.remember();
      this.status(this.blocked?'conflict':'pending',this.lastError);
      clearTimeout(this.timer);
      if(!this.blocked)this.timer=setTimeout(()=>this.flush(),this.delay);
    }
    remember(){try{this.cache?.write({baseRevision:this.revision,...this.pending,updated:Date.now()});this.cacheFailed=false;}catch{this.cacheFailed=true;}}
    async flush(){
      clearTimeout(this.timer);
      if(this.sending)return this.inFlight;
      if(!this.pending||this.blocked)return !this.pending;
      this.sending=true;
      this.inFlight=(async()=>{
        try{
          while(this.pending&&!this.blocked){
            const sent=this.pending;this.status('saving');
            const result=await this.send(sent.state,this.revision,sent.reason);
            this.revision=result.revision;this.lastError=null;
            if(this.pending===sent){this.pending=null;try{this.cache?.clear();}catch{}this.status('saved');}
            else{this.remember();}
          }
          return true;
        }catch(error){
          this.lastError=error;this.blocked=error.status===409;this.remember();
          this.status(this.blocked?'conflict':'error',error);return false;
        }finally{this.sending=false;}
      })();
      return this.inFlight;
    }
    dispose(){clearTimeout(this.timer);}
  }
  const api={SaveQueue};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkbenchPersistence=api;
})(typeof window!=='undefined'?window:{});
