'use strict';
// No network or upload unless --publish is explicitly passed. Credentials are CI-only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {WINDOWS_UPDATE_URL}=require('../common/update-config.cjs');
const hash=(data,algorithm,encoding)=>crypto.createHash(algorithm).update(data).digest(encoding);
function inspect(directory){
 const metadata=fs.readFileSync(path.join(directory,'latest.yml'));
 const yaml=metadata.toString('utf8'),field=name=>new RegExp('^'+name+':\\s*(.+)$','m').exec(yaml)?.[1].trim().replace(/^['"]|['"]$/g,'');
 const name=field('path'),version=field('version');
 assert.match(version||'',/^\d+\.\d+\.\d+$/);assert.ok(name&&path.basename(name)===name&&!/[\\\r\n]/.test(name)&&name.endsWith('.exe'),'Invalid installer filename');
 const bytes=fs.readFileSync(path.join(directory,name)),blockmap=fs.readFileSync(path.join(directory,name+'.blockmap'));
 assert.equal(hash(bytes,'sha512','base64'),field('sha512'),'Installer SHA-512 mismatch');
 const listed=/^\s+- url:\s*(.+)$/m.exec(yaml)?.[1]?.trim().replace(/^['"]|['"]$/g,'');assert.equal(listed,name,'Metadata URL mismatch');
 assert.equal(Number(/^\s+size:\s*(\d+)$/m.exec(yaml)?.[1]),bytes.length,'Installer size mismatch');assert.ok(blockmap.length>0,'Missing blockmap');
 return {version,name,assets:[{name,bytes},{name:name+'.blockmap',bytes:blockmap}],metadata};
}
async function publish(bundle,{env=process.env,request=fetch}={}){
 const key=env.OSS_ACCESS_KEY_ID,secret=env.OSS_ACCESS_KEY_SECRET;
 if(!key||!secret)throw Error('OSS CI credentials are not configured');
 const base=new URL(WINDOWS_UPDATE_URL),bucket=base.hostname.split('.')[0];
 async function signed(method,name,bytes,extra={}){
  const date=new Date().toUTCString(),md5=bytes?hash(bytes,'md5','base64'):'',type=bytes?'application/octet-stream':'';
  const ossHeaders=env.OSS_SECURITY_TOKEN?{'x-oss-security-token':env.OSS_SECURITY_TOKEN}:{};
  const canonical=Object.keys(ossHeaders).sort().map(k=>k+':'+ossHeaders[k]+'\n').join('');
  const resource='/'+bucket+base.pathname+name;
  const signature=crypto.createHmac('sha1',secret).update([method,md5,type,date,canonical+resource].join('\n')).digest('base64');
  const response=await request(new URL(encodeURIComponent(name),base),{method,headers:{Date:date,Authorization:'OSS '+key+':'+signature,...ossHeaders,...(bytes?{'Content-MD5':md5,'Content-Type':type}:{}),...extra},body:bytes,signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw Error('OSS '+method+' '+name+' failed ('+response.status+')');
  return response;
 }
 // Do not expose a manifest until both immutable version assets are present and verified.
 for(const asset of bundle.assets){
  await signed('PUT',asset.name,asset.bytes,{'Cache-Control':'public, max-age=31536000, immutable'});
  const remote=await signed('HEAD',asset.name);
  assert.equal(Number(remote.headers.get('content-length')),asset.bytes.length,'Uploaded size mismatch');
  assert.equal(remote.headers.get('etag')?.replace(/"/g,'').toLowerCase(),hash(asset.bytes,'md5','hex'),'Uploaded checksum mismatch');
 }
 await signed('PUT','latest.yml',bundle.metadata,{'Cache-Control':'no-cache, max-age=0'});
 const remote=await signed('GET','latest.yml');assert.deepEqual(Buffer.from(await remote.arrayBuffer()),bundle.metadata,'Published manifest mismatch');
 return {version:bundle.version,installer:bundle.name,published:true};
}
if(require.main===module)(async()=>{
 const directory=process.argv.find((v,i)=>i>1&&!v.startsWith('--'))||'candidate',bundle=inspect(directory);
 console.log(JSON.stringify(process.argv.includes('--publish')?await publish(bundle):{verified:true,published:false,version:bundle.version,installer:bundle.name}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={inspect,publish};
