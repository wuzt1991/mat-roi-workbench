'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {StringDecoder}=require('node:string_decoder');
const yauzl=require('yauzl');
const sax=require('sax');
const Recognition=require('../public/product-recognition.js');
const {ImportSessionStore,SessionError}=require('./import-session-store.cjs');

const LIMITS={sourceBytes:100*1024*1024,entries:4096,totalUncompressed:1024*1024*1024,sharedStrings:256*1024*1024,selectedSheet:896*1024*1024,smallPart:8*1024*1024,rows:500000,columns:200,cellUtf16:32767,rowJson:2*1024*1024,chunkRows:1000,chunkBytes:2*1024*1024};
const openZip=filename=>new Promise((resolve,reject)=>yauzl.open(filename,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(error,zip)=>error?reject(error):resolve(zip)));
const entries=zip=>new Promise((resolve,reject)=>{const result=[];zip.on('entry',entry=>{result.push(entry);zip.readEntry();});zip.once('error',reject);zip.once('end',()=>resolve(result));zip.readEntry();});
const entryStream=(zip,entry)=>new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)));
const local=name=>{const normalized=name.replace(/\\/g,'/');if(normalized.startsWith('/')||normalized.split('/').includes('..')||normalized.includes('\0'))throw new SessionError(422,'Excel 包含不安全的路径。','INVALID_ZIP_PATH');return normalized;};
function checkCanceled(canceled){if(canceled?.())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});}

async function catalog(filename){
  const stat=fs.statSync(filename);if(stat.size>LIMITS.sourceBytes)throw new SessionError(413,'文件超过 100 MiB。','SOURCE_TOO_LARGE');
  const zip=await openZip(filename),list=await entries(zip);if(list.length>LIMITS.entries){zip.close();throw new SessionError(413,'Excel 包内文件数量超限。','ZIP_ENTRY_LIMIT');}
  let total=0;const map=new Map();for(const entry of list){const name=local(entry.fileName);if(map.has(name)){zip.close();throw new SessionError(422,'Excel 包含重复文件。','DUPLICATE_ZIP_ENTRY');}if((entry.generalPurposeBitFlag&1)!==0){zip.close();throw new SessionError(422,'不支持加密 Excel。','ENCRYPTED_XLSX');}if(![0,8].includes(entry.compressionMethod)){zip.close();throw new SessionError(422,'Excel 使用了不支持的压缩方式。','UNSUPPORTED_COMPRESSION');}total+=entry.uncompressedSize;if(total>LIMITS.totalUncompressed){zip.close();throw new SessionError(413,'Excel 解压后内容超过 1 GiB。','ZIP_EXPANSION_LIMIT');}map.set(name,entry);}
  return {zip,list,map,total,sourceBytes:stat.size};
}
async function readEntry(zip,entry,limit){
  if(!entry)throw new SessionError(422,'Excel 结构不完整。','MISSING_XLSX_PART');if(entry.uncompressedSize>limit)throw new SessionError(413,'Excel 内部文件超限。','XLSX_PART_LIMIT');
  const chunks=[];let size=0,crc=0;for await(const chunk of await entryStream(zip,entry)){size+=chunk.length;if(size>limit)throw new SessionError(413,'Excel 内部文件实际大小超限。','XLSX_PART_LIMIT');crc=zlib.crc32(chunk,crc);chunks.push(chunk);}if((crc>>>0)!==(entry.crc32>>>0))throw new SessionError(422,'Excel 文件校验失败。','CRC_MISMATCH');return Buffer.concat(chunks);
}
function parseSmallXml(bytes,handlers){const parser=sax.parser(true,{xmlns:false,trim:false,normalize:false});Object.assign(parser,handlers);parser.write(bytes.toString('utf8')).close();}
function relationshipPath(target){const value=target.replace(/\\/g,'/');const full=value.startsWith('/')?value.slice(1):`xl/${value}`;return full.replace(/^xl\/\.\//,'xl/');}

async function workbookInfo(filename){
  const info=await catalog(filename);try{
    const workbook=await readEntry(info.zip,info.map.get('xl/workbook.xml'),LIMITS.smallPart),rels=await readEntry(info.zip,info.map.get('xl/_rels/workbook.xml.rels'),LIMITS.smallPart);const relationMap=new Map(),sheets=[];let date1904=false;
    parseSmallXml(rels,{onopentag(node){if(node.name==='Relationship')relationMap.set(node.attributes.Id,relationshipPath(node.attributes.Target));}});
    parseSmallXml(workbook,{onopentag(node){if(node.name==='workbookPr')date1904=node.attributes.date1904==='1'||node.attributes.date1904==='true';if(node.name==='sheet'){const id=node.attributes['r:id'],part=relationMap.get(id);if(part)sheets.push({sheetId:id,name:node.attributes.name,part});}}});
    if(!sheets.length)throw new SessionError(422,'Excel 中没有可用工作表。','NO_SHEETS');return {...info,sheets,date1904};
  }catch(error){info.zip.close();throw error;}
}

async function parseXmlStream(zip,entry,configure,{limit,progress,canceled,phase,stopWhen}={}){
  if(!entry)throw new SessionError(422,'Excel 结构不完整。','MISSING_XLSX_PART');if(entry.uncompressedSize>limit)throw new SessionError(413,'Excel 内部数据超限。','XLSX_PART_LIMIT');
  const parser=sax.parser(true,{xmlns:false,trim:false,normalize:false}),decoder=new StringDecoder('utf8');configure(parser);let read=0,crc=0,last=0;
  let partial=false;for await(const chunk of await entryStream(zip,entry)){checkCanceled(canceled);read+=chunk.length;if(read>limit)throw new SessionError(413,'Excel 内部数据实际大小超限。','XLSX_PART_LIMIT');crc=zlib.crc32(chunk,crc);parser.write(decoder.write(chunk));if(stopWhen?.()){partial=true;break;}if(read-last>=1024*1024){last=read;progress?.({phase,bytesRead:read,bytesTotal:entry.uncompressedSize});}}
  if(!partial){parser.write(decoder.end()).close();if((crc>>>0)!==(entry.crc32>>>0))throw new SessionError(422,'Excel 文件校验失败。','CRC_MISMATCH');progress?.({phase,bytesRead:read,bytesTotal:entry.uncompressedSize});}return {partial,bytesRead:read};
}

async function loadSharedStrings(info,store,options={}){
  const entry=info.map.get('xl/sharedStrings.xml');if(!entry)return 0;store.db.exec('DELETE FROM shared_strings');let id=0,value='',inText=false;
  store.db.exec('BEGIN');try{await parseXmlStream(info.zip,entry,parser=>{parser.ondoctype=()=>{throw new SessionError(422,'Excel XML 不允许 DTD。','DTD_NOT_ALLOWED');};parser.onopentag=node=>{if(node.name==='si')value='';if(node.name==='t')inText=true;};parser.ontext=chunk=>{if(inText)value+=chunk;};parser.oncdata=chunk=>{if(inText)value+=chunk;};parser.onclosetag=name=>{if(name==='t')inText=false;if(name==='si'){if(value.length>LIMITS.cellUtf16)throw new SessionError(422,'单元格文本超过 32767 个字符。','CELL_TOO_LONG');store.insertSharedString(id++,decodeExcelEscapes(value));if(id%1000===0)store.db.exec('COMMIT; BEGIN');}};},{limit:LIMITS.sharedStrings,progress:options.progress,canceled:options.canceled,phase:'shared-strings'});store.db.exec('COMMIT');return id;}catch(error){try{store.db.exec('ROLLBACK');}catch{}throw error;}
}
function decodeExcelEscapes(value){return value.replace(/_x005F_(_x[0-9A-Fa-f]{4}_)/g,'$1').replace(/_x([0-9A-Fa-f]{4})_/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));}
function columnIndex(ref){const match=/^([A-Z]+)\d+$/i.exec(ref||'');if(!match)return -1;let result=0;for(const char of match[1].toUpperCase())result=result*26+char.charCodeAt(0)-64;return result-1;}
function repeatedHeader(values,header){if(Recognition.detectHeader([values]))return true;const expected=header?.headers;if(!Array.isArray(expected))return false;let populated=0;for(let index=0,width=Math.max(values.length,expected.length);index<width;index++){const actual=Recognition.compact(values[index]),wanted=Recognition.compact(expected[index]);if(actual!==wanted)return false;if(wanted)populated++;}return populated>=3;}
function sectionMarker(values){if(!/^旺店通\d+(?:\.\d+)+$/i.test(Recognition.text(values[0])))return false;return values.slice(1).every(value=>{const item=Recognition.text(value);return item===''||/^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA)$/i.test(item);});}
function cellValue(cell,store){
  const raw=cell.raw,kind=cell.type;
  if(kind==='s'){const value=store.sharedString(Number(raw));if(value===undefined)throw new SessionError(422,'Excel 共享字符串引用无效。','SHARED_STRING_MISSING');return {value,type:'shared',lexical:raw};}
  if(kind==='inlineStr'||kind==='str')return {value:decodeExcelEscapes(cell.text||raw),type:kind,lexical:cell.text||raw};
  if(kind==='b')return {value:raw==='1',type:'boolean',lexical:raw};
  if(kind==='e')return {value:raw,type:'error',lexical:raw,error:true};
  if(cell.formula&&!raw)return {value:'',type:'formula-missing',lexical:'',formula:true,error:true};
  if(raw==='')return {value:'',type:'blank',lexical:''};
  return {value:raw,type:cell.formula?'formula-cache':'number',lexical:raw,formula:!!cell.formula};
}
async function scanSheet(info,sheet,store,{collectRows=false,recognize=true,headerLimit=40,mapping=null,selectedHeader=null,rowOffset=0,progress,canceled,onBatch}={}){
  const entry=info.map.get(sheet.part);if(!entry)throw new SessionError(422,'工作表数据缺失。','MISSING_SHEET');
  let currentRow=null,currentCell=null,inValue=false,inText=false,physical=0,business=0,maxColumn=0,batch=[],batchBytes=0,headerRows=[],headerSourceRows=[],header=selectedHeader,nextRowId=rowOffset+1;
  const flush=()=>{if(!batch.length)return;onBatch?.(batch);batch=[];batchBytes=0;};
  await parseXmlStream(info.zip,entry,parser=>{
    parser.ondoctype=()=>{throw new SessionError(422,'Excel XML 不允许 DTD。','DTD_NOT_ALLOWED');};
    parser.onopentag=node=>{if(node.name==='row'){physical++;currentRow=collectRows||headerRows.length<headerLimit?{sourceRow:Number(node.attributes.r)||physical,cells:[]}:null;}else if(node.name==='c'&&currentRow){currentCell={ref:node.attributes.r||'',type:node.attributes.t||'n',raw:'',text:'',formula:false};}else if(node.name==='v'&&currentCell)inValue=true;else if(node.name==='t'&&currentCell)inText=true;else if(node.name==='f'&&currentCell)currentCell.formula=true;};
    parser.ontext=value=>{if(inValue&&currentCell)currentCell.raw+=value;if(inText&&currentCell)currentCell.text+=value;};parser.oncdata=value=>{if(inText&&currentCell)currentCell.text+=value;};
    parser.onclosetag=name=>{if(name==='v')inValue=false;else if(name==='t')inText=false;else if(name==='c'&&currentCell){const index=columnIndex(currentCell.ref);if(index<0||index>=LIMITS.columns)throw new SessionError(422,'工作表超过 200 列。','COLUMN_LIMIT');maxColumn=Math.max(maxColumn,index+1);const parsed=cellValue(currentCell,store);if(String(parsed.value).length>LIMITS.cellUtf16)throw new SessionError(422,`第 ${currentRow.sourceRow} 行存在超长单元格。`,'CELL_TOO_LONG');currentRow.cells[index]=parsed;currentCell=null;}else if(name==='row'&&currentRow){const values=Array.from({length:Math.max(maxColumn,currentRow.cells.length)},(_,i)=>currentRow.cells[i]?.value??'');if(headerRows.length<headerLimit){headerRows.push(values);headerSourceRows.push(currentRow.sourceRow);}if(!header&&headerRows.length){const found=Recognition.detectHeader(headerRows);if(found)header={...found,sourceRow:headerSourceRows[found.rowIndex]};}if(collectRows&&header&&currentRow.sourceRow>(header.sourceRow??header.rowIndex+1)&&!values.every(v=>Recognition.text(v)==='')&&!repeatedHeader(values,header)&&!sectionMarker(values)){business++;if(rowOffset+business>LIMITS.rows)throw new SessionError(413,'选中的工作表合计超过 500000 条业务数据。','ROW_LIMIT');const activeMap=mapping||header.mapping,raw={rowId:nextRowId++,sheetId:sheet.sheetId,sourceRow:currentRow.sourceRow,values,mapping:activeMap};let platform='',shop='',productId='',skuId='',groupId='',originalMissingThickness=false;if(recognize){const derived=Recognition.deriveTransferRow(raw,{}, {rules:store.getMeta('rules',{}),mapping:activeMap});({platform,shop,productId,skuId,groupId,originalMissingThickness}=derived);}else{const get=field=>Number.isInteger(activeMap[field])?String(values[activeMap[field]]??''):'',rowId=raw.rowId;platform=get('platform');shop=get('shop');productId=get('productId');skuId=get('specId');groupId=Recognition.groupKey(platform,shop,productId,rowId);}const record={...raw,sourceHash:crypto.createHash('sha256').update(JSON.stringify(Object.keys(Recognition.FIELD_ALIASES).filter(key=>!['seq','sales','date'].includes(key)).map(key=>Number.isInteger(activeMap[key])?Recognition.text(values[activeMap[key]]):''))).digest('hex'),platform,shop,productId,skuId,groupId,originalMissingThickness};const bytes=Buffer.byteLength(JSON.stringify(record));if(bytes>LIMITS.rowJson)throw new SessionError(422,`第 ${currentRow.sourceRow} 行超过 2 MiB。`,'ROW_TOO_LARGE');if(batch.length>=LIMITS.chunkRows||batchBytes+bytes>LIMITS.chunkBytes)flush();batch.push(record);batchBytes+=bytes;}currentRow=null;}
    };
  },{limit:LIMITS.selectedSheet,progress:(event)=>progress?.({...event,rowsRead:business}),canceled,phase:'sheet',stopWhen:collectRows?null:()=>headerRows.length>=headerLimit});flush();const detected=selectedHeader||Recognition.detectHeader(headerRows);return {physicalRows:physical,businessRows:business,maxColumn,header:detected?{...detected,sourceRow:detected.sourceRow??headerSourceRows[detected.rowIndex]}:null,headerRows};
}

async function inspectWorkbook(filename,sessionDirectory,options={}){
  const info=await workbookInfo(filename),store=new ImportSessionStore(sessionDirectory);try{await loadSharedStrings(info,store,options);const candidates=[];for(const sheet of info.sheets){checkCanceled(options.canceled);const scan=await scanSheet(info,sheet,store,{headerLimit:40,progress:options.progress,canceled:options.canceled});candidates.push({...sheet,header:scan.header?{...scan.header,samples:scan.header.headers.map((_,i)=>scan.headerRows.slice(scan.header.rowIndex+1).map(row=>String(row[i]??'').slice(0,180)).filter(Boolean).slice(0,3))}:null,physicalRows:scan.physicalRows,maxColumn:scan.maxColumn});}return {sourceBytes:info.sourceBytes,totalUncompressed:info.total,date1904:info.date1904,sheets:candidates};}finally{store.close();info.zip.close();}
}
async function importSheets(filename,sessionDirectory,{selections,rules,derive=true,progress,canceled}={}){
  const info=await workbookInfo(filename),store=new ImportSessionStore(sessionDirectory);
  try{
    if(!Array.isArray(selections)||!selections.length)throw new SessionError(422,'请选择需要读取的工作表。','EMPTY_SHEET_SELECTION');
    const ids=selections.map(x=>x.sheetId);
    if(new Set(ids).size!==ids.length||ids.some(id=>!info.sheets.some(sheet=>sheet.sheetId===id)))throw new SessionError(422,'工作表选择重复或已失效。','INVALID_SHEET_SELECTION');
    const ordered=info.sheets.filter(sheet=>ids.includes(sheet.sheetId));
    // Resolve every header before clearing any prior import, then read all selected sheets as one candidate.
    await loadSharedStrings(info,store,{progress,canceled});
    const prepared=[];
    for(const sheet of ordered){
      checkCanceled(canceled);
      const choice=selections.find(x=>x.sheetId===sheet.sheetId),scan=await scanSheet(info,sheet,store,{progress,canceled});
      if(!scan.header)throw new SessionError(422,`“${sheet.name}”未找到有效表头。`,'HEADER_NOT_FOUND');
      const mapping=choice.mapping||scan.header.mapping;
      if(derive&&Recognition.productMappingIssues(scan.header.headers,mapping).length)throw new SessionError(422,`请确认“${sheet.name}”的商品字段。`,'PRODUCT_MAPPING_REQUIRED');
      prepared.push({sheet,header:scan.header,mapping});
    }
    store.resetImport({keepSharedStrings:true});
    const sheetMappings=Object.fromEntries(prepared.map(x=>[x.sheet.sheetId,x.mapping]));
    store.updateMeta({phase:'importing',rules,mapping:prepared[0].mapping,sheetMappings,selectedSheets:ordered.map(({sheetId,name})=>({sheetId,name})),sourceRows:0,duplicateRows:0});
    let total=0;const results=[];
    for(const {sheet,header,mapping} of prepared){
      checkCanceled(canceled);
      const report=value=>progress?.({...value,sheetId:sheet.sheetId,sheetName:sheet.name,message:`正在读取 ${sheet.name}`});
      const result=await scanSheet(info,sheet,store,{collectRows:true,recognize:derive,mapping,selectedHeader:header,rowOffset:total,progress:report,canceled,onBatch:rows=>{store.insertRawBatch(rows);report({phase:'importing',rowsCommitted:rows.at(-1)?.rowId||0});}});
      total+=result.businessRows;results.push({sheetId:sheet.sheetId,name:sheet.name,header:result.header,businessRows:result.businessRows});
    }
    checkCanceled(canceled);
    const duplicateRows=derive?Number(store.db.prepare("SELECT coalesce(sum(n-1),0) n FROM (SELECT count(*) n FROM raw_rows WHERE platform<>'' AND shop<>'' AND product_id<>'' AND sku_id<>'' GROUP BY source_hash HAVING count(*)>1)").get().n):0;
    store.updateMeta({header:results[0].header.headers,sourceRows:total,duplicateRows});
    const derived=derive?store.rebuildDerived(rules,{progress,canceled}):{generation:0,total,pending:0,confirmed:0,missingThickness:0,ready:false};
    return {businessRows:total,header:results[0].header,sheets:results,duplicateRows,...derived};
  }finally{store.close();info.zip.close();}
}
async function importSheet(filename,sessionDirectory,{sheetId,mapping,...options}={}){
  return importSheets(filename,sessionDirectory,{...options,selections:[{sheetId,mapping}]});
}

module.exports={LIMITS,catalog,workbookInfo,inspectWorkbook,importSheet,importSheets,scanSheet,loadSharedStrings,decodeExcelEscapes};
