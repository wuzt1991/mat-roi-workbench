'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const yauzl=require('yauzl');
const yazl=require('yazl');
const sax=require('sax');
const Recognition=require('../public/product-recognition.js');
const {ImportSessionStore,SessionError}=require('./import-session-store.cjs');

const open=filename=>new Promise((resolve,reject)=>yauzl.open(filename,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(error,zip)=>error?reject(error):resolve(zip)));
const listEntries=zip=>new Promise((resolve,reject)=>{const result=[];zip.on('entry',entry=>{result.push(entry);zip.readEntry();});zip.once('error',reject);zip.once('end',()=>resolve(result));zip.readEntry();});
const stream=(zip,entry)=>new Promise((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error?reject(error):resolve(value)));
const read=async(zip,entry,limit=16*1024*1024)=>{if(entry.uncompressedSize>limit)throw new SessionError(422,'模板部件超过允许大小。','TEMPLATE_PART_LIMIT');const chunks=[];let size=0;for await(const chunk of await stream(zip,entry)){size+=chunk.length;if(size>limit)throw new SessionError(422,'模板部件超过允许大小。','TEMPLATE_PART_LIMIT');chunks.push(chunk);}return Buffer.concat(chunks);};
const xml=value=>String(value).replace(/_x[0-9a-f]{4}_/ig,match=>'_x005F_'+match.slice(1)).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
function column(index){let value='';for(let n=index+1;n;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value;}
function startTag(xmlText,name){const begin=xmlText.indexOf(`<${name}`);if(begin<0)return null;let quote='',end=begin;for(;end<xmlText.length;end++){const char=xmlText[end];if(quote){if(char===quote)quote='';}else if(char==='"'||char==="'")quote=char;else if(char==='>')break;}return {begin,end:end+1,text:xmlText.slice(begin,end+1)};}
function setAttribute(tag,name,value){const re=new RegExp(`(\\s${name}\\s*=\\s*)(["'])[^"']*\\2`);return re.test(tag)?tag.replace(re,`$1"${value}"`):tag.replace(/\/?>(\s*)$/,` ${name}="${value}">$1`);}
function replaceTagAttribute(xmlText,name,attribute,value){const tag=startTag(xmlText,name);if(!tag)return xmlText;return xmlText.slice(0,tag.begin)+setAttribute(tag.text,attribute,value)+xmlText.slice(tag.end);}
function rowStyles(sheetXml){
  const parser=sax.parser(true,{xmlns:false}),rows=[];let row=null;parser.onopentag=node=>{if(node.name==='row')row={attributes:{...node.attributes},cells:[]};else if(node.name==='c'&&row)row.cells.push({style:node.attributes.s||'',type:node.attributes.t||''});};parser.onclosetag=name=>{if(name==='row'&&row){rows.push(row);row=null;}};parser.write(sheetXml).close();if(rows.length<2)throw new SessionError(422,'模板缺少标题或样式行。','INVALID_TEMPLATE');return {header:rows[0],data:rows[1]};
}
function rowXml(values,rowNumber,model){
  const height=model.attributes.ht?` ht="${xml(model.attributes.ht)}" customHeight="1"`:'';let result=`<row r="${rowNumber}"${height}>`;
  for(let index=0;index<29;index++){const value=values[index],style=model.cells[index]?.style,ref=`${column(index)}${rowNumber}`,s=style!==''&&style!==undefined?` s="${xml(style)}"`:'';if(value===null||value===undefined||value===''){result+=`<c r="${ref}"${s}/>`;continue;}if(typeof value==='number'&&Number.isFinite(value)&&![17,18,27].includes(index))result+=`<c r="${ref}"${s}><v>${value}</v></c>`;else result+=`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}
  return result+'</row>';
}
async function templateParts(templatePath){
  const zip=await open(templatePath),entries=await listEntries(zip),parts=new Map();try{for(const entry of entries){if(entry.fileName.endsWith('/'))continue;if(/(^|\/)(calcChain\.xml|tables\/|drawings\/)/.test(entry.fileName))throw new SessionError(422,'商品模板包含未支持的关系部件。','UNSUPPORTED_TEMPLATE_RELATION');parts.set(entry.fileName,await read(zip,entry));}return parts;}finally{zip.close();}
}
function makeSheetStream(sheetText,store,generation,total,progress,canceled){
  const openTag=startTag(sheetText,'sheetData');if(!openTag)throw new SessionError(422,'模板工作表结构无效。','INVALID_TEMPLATE');const closeAt=sheetText.indexOf('</sheetData>',openTag.end);if(closeAt<0)throw new SessionError(422,'模板工作表结构无效。','INVALID_TEMPLATE');
  const styles=rowStyles(sheetText),endRow=total+1;let prefix=sheetText.slice(0,openTag.begin)+openTag.text,suffix=sheetText.slice(closeAt);prefix=replaceTagAttribute(prefix,'dimension','ref',`A1:AC${endRow}`);suffix=replaceTagAttribute(suffix,'autoFilter','ref',`A1:AC${endRow}`);
  return Readable.from((async function*(){yield prefix;yield rowXml(Recognition.OUTPUT_HEADERS,1,styles.header);const statement=store.db.prepare('SELECT derived_json FROM derived_rows WHERE generation=? AND row_id>? ORDER BY row_id LIMIT 1000');let after=0,written=0;while(true){if(canceled?.())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});const rows=statement.all(generation,after);if(!rows.length)break;for(const item of rows){const derived=JSON.parse(item.derived_json);yield rowXml(derived.values,++written+1,styles.data);after=derived.rowId;}progress?.({phase:'exporting',rowsCommitted:written,rowsTotal:total});}if(written!==total)throw new SessionError(500,'导出行数校验失败。','EXPORT_ROW_MISMATCH');yield suffix;})());
}
async function exportProduct({sessionDirectory,templatePath,outputPath,progress,canceled}){
  const store=new ImportSessionStore(sessionDirectory),meta=store.metadata(),generation=Number(meta.generation),counts=store.counts(generation);if(!counts.ready)throw new SessionError(422,'仍有未确认规格，禁止导出。','SESSION_NOT_READY');const parts=await templateParts(templatePath),sheetName='xl/worksheets/sheet1.xml',sheet=parts.get(sheetName);if(!sheet)throw new SessionError(422,'商品模板缺少工作表。','INVALID_TEMPLATE');
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});const temp=`${outputPath}.${crypto.randomUUID()}.part`,zip=new yazl.ZipFile(),done=pipeline(zip.outputStream,fs.createWriteStream(temp,{flags:'wx'}));try{for(const [name,bytes] of parts){if(name===sheetName)zip.addReadStream(makeSheetStream(bytes.toString('utf8'),store,generation,counts.total,progress,canceled),name);else zip.addBuffer(bytes,name);}zip.end();await done;if(canceled?.())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});fs.renameSync(temp,outputPath);return {artifactPath:outputPath,artifactName:'商品转表.xlsx',rows:counts.total,fingerprint:crypto.createHash('sha256').update([meta.sourceHash,meta.revision,generation,meta.rulesFingerprint].join('|')).digest('hex')};}catch(error){try{fs.unlinkSync(temp);}catch{}throw error;}finally{store.close();}
}

module.exports={exportProduct,rowXml,templateParts,replaceTagAttribute};
