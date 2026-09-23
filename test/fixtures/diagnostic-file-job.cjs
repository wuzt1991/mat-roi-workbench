'use strict';
// Test-only entry point: preserve SQLite details that the user-facing worker hides.
const path=require('node:path'),root=process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'../..');
const sessionModule=require(path.join(root,'server/import-session-store.cjs'));
const BaseStore=sessionModule.ImportSessionStore;
function detailed(error){
 if(error.code==='ERR_SQLITE_ERROR'&&!error.sqliteDetailsIncluded){
  error.sqliteDetailsIncluded=true;
  error.status=500;
  error.message=JSON.stringify({message:error.message,errcode:error.errcode,errstr:error.errstr,stack:error.stack});
 }
 return error;
}
class DiagnosticStore extends BaseStore{
 constructor(...args){try{super(...args);}catch(error){throw detailed(error);}}
}
for(const name of Object.getOwnPropertyNames(BaseStore.prototype)){
 if(name==='constructor'||typeof BaseStore.prototype[name]!=='function')continue;
 DiagnosticStore.prototype[name]=function(...args){try{return BaseStore.prototype[name].apply(this,args);}catch(error){throw detailed(error);}};
}
sessionModule.ImportSessionStore=DiagnosticStore;
require(path.join(root,'server/file-job-child.cjs'));
