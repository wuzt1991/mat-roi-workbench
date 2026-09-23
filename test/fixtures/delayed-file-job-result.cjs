'use strict';
const path=require('node:path'),send=process.send.bind(process);
process.send=(message,callback)=>{
 if(message.type==='result'||message.type==='error'){setTimeout(()=>send(message,callback),100);return false;}
 return send(message,callback);
};
require(path.join(process.env.MAT_VERIFY_ROOT||path.resolve(__dirname,'../..'),'server/file-job-child.cjs'));
