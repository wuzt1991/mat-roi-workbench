(function(root){
  'use strict';
  const MAX_BYTES=20*1024*1024;
  const VERSION=2;
  const clone=value=>value===undefined?undefined:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));
  const token=()=>{try{if(root.crypto?.randomUUID)return root.crypto.randomUUID();}catch{}return `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;};
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f]/.test(value);
  const validRevision=value=>Number.isSafeInteger(value)&&value>=0;
  const validEpoch=value=>Number.isSafeInteger(value)&&value>=0;
  const safeFilename=value=>typeof value==='string'&&value.length<=255&&value.length>0&&!/[\\/\u0000-\u001f]/.test(value);
  class SessionDrafts {
    constructor({workspaceId,storageEpoch,sessionId,ownerToken,baseRevision=0,indexedDB=root.indexedDB,name='mat-workbench-form-drafts-v1',leaseMs=60000}){
      if(!validId(workspaceId)||!validEpoch(storageEpoch)||!validId(sessionId)||!validRevision(baseRevision))throw Error('草稿缺少有效工作区上下文。');
      Object.assign(this,{workspaceId,storageEpoch,sessionId,ownerToken:validId(ownerToken)?ownerToken:token(),baseRevision,indexedDB,name,leaseMs});this.memory=new Map();this.pending=new Set();this.error=null;this.closed=false;this.dbPromise=null;this.sessionMeta=null;
    }
    key(formId){return JSON.stringify(['draft',this.workspaceId,this.storageEpoch,this.sessionId,String(formId)]);}
    sessionKey(sessionId=this.sessionId,workspaceId=this.workspaceId,storageEpoch=this.storageEpoch){return JSON.stringify(['session',workspaceId,storageEpoch,sessionId]);}
    open(){
      if(this.closed)return Promise.reject(Error('草稿会话已关闭。'));
      if(!this.dbPromise)this.dbPromise=new Promise((resolve,reject)=>{
        if(!this.indexedDB)return reject(Error('本地草稿存储不可用，请导出草稿后再关闭。'));
        const request=this.indexedDB.open(this.name,VERSION);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts',{keyPath:'key'});if(!request.result.objectStoreNames.contains('sessions'))request.result.createObjectStore('sessions',{keyPath:'key'});};
        request.onerror=()=>reject(request.error||Error('无法打开草稿存储。'));
        request.onblocked=()=>reject(Error('草稿存储被其他窗口占用，请保留当前页面。'));
        request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      }).catch(error=>{this.dbPromise=null;throw error;});
      return this.dbPromise;
    }
    async transaction(storeName,mode,action){
      const db=await this.open();return new Promise((resolve,reject)=>{
        const transaction=db.transaction(storeName,mode),store=transaction.objectStore(storeName);let value,settled=false;
        transaction.oncomplete=()=>{if(!settled){settled=true;resolve(value);}};
        transaction.onerror=()=>reject(transaction.error||Error('草稿存储失败。'));
        transaction.onabort=()=>{if(!settled){settled=true;reject(transaction.error||Error('草稿保存已中止。'));}};
        try{const request=action(store);if(request)request.onsuccess=()=>{value=request.result;};}catch(error){try{transaction.abort();}catch{}if(!settled){settled=true;reject(error);}}
      });
    }
    track(task){this.pending.add(task);task.finally(()=>this.pending.delete(task)).catch(()=>{});return task;}
    validateSession(meta,{allowOwnerChange=false}={}){
      if(meta.workspaceId!==this.workspaceId||meta.storageEpoch!==this.storageEpoch)throw Object.assign(Error('工作区已恢复，旧会话不能继续使用。'),{code:'WORKSPACE_EPOCH_CHANGED'});
      if(!validId(meta.sessionId)||meta.sessionId!==this.sessionId)throw Error('文件会话标识无效。');
      if(!validId(meta.ownerToken))throw Error('文件会话所有者标识无效。');
      if(!validRevision(meta.revision))throw Error('文件会话版本无效。');
      if(meta.filename!==undefined&&meta.filename!==''&&!safeFilename(meta.filename))throw Error('文件会话文件名无效。');
      if(!allowOwnerChange&&meta.ownerToken!==this.ownerToken)throw Object.assign(Error('文件会话已由其他窗口占用，请明确接管。'),{code:'SESSION_OWNER_ACTIVE'});
      return meta;
    }
    sessionRecord(meta={}){
      const source={sessionId:this.sessionId,ownerToken:this.ownerToken,revision:this.baseRevision,workspaceId:this.workspaceId,storageEpoch:this.storageEpoch,...meta};
      this.validateSession(source,{allowOwnerChange:true});
      return {key:this.sessionKey(),kind:'file-session',fileKind:source.fileKind||source.kind||'',accepted:source.accepted!==false,version:1,sessionId:source.sessionId,ownerToken:source.ownerToken,revision:source.revision,workspaceId:source.workspaceId,storageEpoch:source.storageEpoch,filename:source.filename||'',updated:Date.now(),leaseUntil:Number.isFinite(source.leaseUntil)?source.leaseUntil:Date.now()+this.leaseMs};
    }
    /** Save the bounded identity needed to explicitly reopen a disk session. */
    async saveSession(meta={}){
      const existing=await this.getSession(this.sessionId);
      const record=this.sessionRecord(meta);
      if(existing&&existing.ownerToken!==record.ownerToken&&existing.leaseUntil>Date.now()&&!meta.takeover)throw Object.assign(Error('文件会话已由其他窗口占用，请明确接管。'),{code:'SESSION_OWNER_ACTIVE'});
      if(this.indexedDB)await this.transaction('sessions','readwrite',store=>store.put(record));this.ownerToken=record.ownerToken;this.baseRevision=record.revision;this.sessionMeta=record;return clone(record);
    }
    registerSession(meta={}){return this.saveSession(meta);}
    async getSession(sessionId=this.sessionId,{anyEpoch=false}={}){
      if(!validId(sessionId))throw Error('文件会话标识无效。');
      if(!this.indexedDB)return this.sessionMeta&&this.sessionMeta.sessionId===sessionId?clone(this.sessionMeta):null;
      if(!anyEpoch){const result=await this.transaction('sessions','readonly',store=>store.get(this.sessionKey(sessionId)));return result?clone(result):null;}
      const all=await this.transaction('sessions','readonly',store=>store.getAll());
      return (all||[]).filter(x=>x.workspaceId===this.workspaceId&&x.sessionId===sessionId).sort((a,b)=>b.updated-a.updated).map(clone);
    }
    /**
     * Explicitly reopen a file session. A live owner is never silently
     * replaced; takeover rotates ownerToken and invalidates old commands.
     */
    async restoreSession(sessionId=this.sessionId,{workspaceId=this.workspaceId,storageEpoch=this.storageEpoch,ownerToken:requestedOwnerToken,takeover=false,revision}={}){
      if(workspaceId!==this.workspaceId||storageEpoch!==this.storageEpoch)throw Object.assign(Error('工作区已恢复，旧会话不能继续使用。'),{code:'WORKSPACE_EPOCH_CHANGED'});
      if(sessionId!==this.sessionId)throw Error('只能恢复当前草稿会话。');
      const stored=await this.getSession(sessionId);if(!stored)return null;
      if(stored.storageEpoch!==storageEpoch)throw Object.assign(Error('该文件会话属于旧工作区版本，不能自动恢复。'),{code:'WORKSPACE_EPOCH_CHANGED'});
      const now=Date.now(),nextOwner=validId(requestedOwnerToken)?requestedOwnerToken:this.ownerToken,sameOwner=stored.ownerToken===nextOwner;
      if(!sameOwner&&stored.leaseUntil>now&&!takeover)throw Object.assign(Error('文件会话正在其他窗口使用，请明确接管后重试。'),{code:'SESSION_OWNER_ACTIVE'});
      const record={...stored,ownerToken:nextOwner,revision:revision===undefined?stored.revision:revision,updated:now,leaseUntil:now+this.leaseMs};
      if(!validRevision(record.revision))throw Error('文件会话版本无效。');
      if(this.indexedDB)await this.transaction('sessions','readwrite',store=>store.put(record));this.ownerToken=nextOwner;this.baseRevision=record.revision;this.sessionMeta=record;return clone(record);
    }
    async touchSession({revision=this.sessionMeta?.revision,filename=this.sessionMeta?.filename}={}){
      const current=await this.getSession(this.sessionId);if(!current)return null;
      if(current.ownerToken!==this.ownerToken)throw Object.assign(Error('文件会话所有权已失效，请重新接管。'),{code:'SESSION_OWNER_LOST'});
      if(!validRevision(revision))throw Error('文件会话版本无效。');
      const next={...current,revision,filename:filename||'',updated:Date.now(),leaseUntil:Date.now()+this.leaseMs};
      if(this.indexedDB)await this.transaction('sessions','readwrite',store=>store.put(next));this.sessionMeta=next;return clone(next);
    }
    async listSessions({includeOldEpoch=false}={}){
      if(!this.indexedDB)return this.sessionMeta?[clone(this.sessionMeta)]:[];
      const all=await this.transaction('sessions','readonly',store=>store.getAll());
      return (all||[]).filter(x=>x.workspaceId===this.workspaceId&&(includeOldEpoch||x.storageEpoch===this.storageEpoch)).sort((a,b)=>b.updated-a.updated).map(clone);
    }
    async discardSession({sessionId=this.sessionId,includeDrafts=true}={}){
      if(sessionId!==this.sessionId)throw Error('只能放弃当前草稿会话。');
      const current=await this.getSession(sessionId);if(current&&current.ownerToken!==this.ownerToken&&current.leaseUntil>Date.now())throw Object.assign(Error('文件会话正在其他窗口使用，请明确接管后再放弃。'),{code:'SESSION_OWNER_ACTIVE'});
      if(this.indexedDB){await this.transaction('sessions','readwrite',store=>store.delete(this.sessionKey()));if(includeDrafts){const records=await this.transaction('drafts','readonly',store=>store.getAll());const own=(records||[]).filter(x=>x.workspaceId===this.workspaceId&&x.storageEpoch===this.storageEpoch&&x.sessionId===sessionId);if(own.length)await this.transaction('drafts','readwrite',store=>{for(const record of own)store.delete(record.key);});}}
      this.sessionMeta=null;return true;
    }
    save(formId,value,{entityId=null,baseRevision=this.baseRevision}={}){
      const record={key:this.key(formId),formId:String(formId),workspaceId:this.workspaceId,storageEpoch:this.storageEpoch,sessionId:this.sessionId,baseRevision,entityId,value:clone(value),updated:Date.now()};
      this.memory.set(record.key,{record,persisted:false});
      const bytes=new TextEncoder().encode(JSON.stringify([...this.memory.values()].map(item=>item.record))).byteLength;
      if(bytes>MAX_BYTES){this.error=Error('草稿超过 20 MiB，请导出救援文件并缩小输入。');return Promise.reject(this.error);}
      const task=this.transaction('drafts','readwrite',store=>store.put(record)).then(()=>{if(this.memory.get(record.key)?.record===record)this.memory.set(record.key,{record,persisted:true});this.error=null;return record;},error=>{this.error=error;throw error;});
      return this.track(task);
    }
    async read(formId,{baseRevision=this.baseRevision,entityId}={}){
      const key=this.key(formId),record=this.memory.get(key)?.record||await this.transaction('drafts','readonly',store=>store.get(key));
      if(!record)return null;
      return {...clone(record),stale:record.baseRevision!==baseRevision||(entityId!==undefined&&record.entityId!==entityId)};
    }
    remove(formId){const key=this.key(formId);return this.track(this.transaction('drafts','readwrite',store=>store.delete(key)).then(()=>{this.memory.delete(key);this.error=null;},error=>{this.error=error;throw error;}));}
    async list(){
      const records=this.indexedDB?await this.transaction('drafts','readonly',store=>store.getAll()):[];
      const own=(records||[]).filter(record=>record.workspaceId===this.workspaceId&&record.storageEpoch===this.storageEpoch&&record.sessionId===this.sessionId),result=new Map(own.map(record=>[record.key,record]));
      for(const [key,{record}] of this.memory)result.set(key,record);
      return [...result.values()].map(record=>structuredClone(record));
    }
    async flush(){const results=await Promise.allSettled([...this.pending]);return !this.error&&results.every(result=>result.status==='fulfilled');}
    status(){return {pending:this.pending.size,preserved:!this.pending.size&&!this.error&&[...this.memory.values()].every(item=>item.persisted),hasDrafts:this.memory.size>0,error:this.error?.message||null,sessionId:this.sessionId,ownerToken:this.ownerToken,revision:this.baseRevision,workspaceId:this.workspaceId,storageEpoch:this.storageEpoch,filename:this.sessionMeta?.filename||'',session:this.sessionMeta?clone(this.sessionMeta):null};}
    exportJSON(){return JSON.stringify({kind:'mat-workbench-form-rescue',version:VERSION,workspaceId:this.workspaceId,storageEpoch:this.storageEpoch,sessionId:this.sessionId,drafts:[...this.memory.values()].map(item=>item.record),session:this.sessionMeta?clone(this.sessionMeta):null},null,2);}
    async close(){await this.flush();this.closed=true;try{(await this.dbPromise)?.close();}catch{}}
  }
  const api={SessionDrafts,MAX_BYTES};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkbenchDrafts=api;
})(typeof window!=='undefined'?window:globalThis);
