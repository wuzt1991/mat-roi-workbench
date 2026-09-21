'use strict';

const Recognition=require('../public/product-recognition.js');
const Sales=require('../public/sales-import.js');
const MAX=1e12,MAX_GROUPS=10000;
const fail=message=>{throw Object.assign(Error(message),{status:422,code:'SALES_SIZE_IMPORT'});};
const sizeKey=(w,h)=>[Number(w),Number(h)].every(n=>Number.isFinite(n)&&n>0&&n<=10000)?[Number(Number(w).toFixed(6)),Number(Number(h).toFixed(6))].sort((a,b)=>a-b).join('×'):'';

function ensure(store){
  store.db.exec(`CREATE TABLE IF NOT EXISTS sales_size_groups(
    group_key TEXT PRIMARY KEY, source_key TEXT NOT NULL, row_id INTEGER NOT NULL,
    size_key TEXT NOT NULL, quantity INTEGER NOT NULL, source_count INTEGER NOT NULL,
    example TEXT NOT NULL, issue TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sales_size_source ON sales_size_groups(source_key,row_id);`);
}

// Stream source rows into a bounded summary; pattern names and SKU IDs do not form the size key.
function aggregate(store,mapping,{basis='orders',canceled=()=>false,progress=()=>{}}={}){
  ensure(store);store.setMeta('salesSizeReady',false);store.db.exec('DELETE FROM sales_size_groups');
  if(!Number.isInteger(mapping.specName)||!Number.isInteger(mapping.sales))fail('请选择商品 SKU 标题列和数量列。');
  const page=store.db.prepare('SELECT row_id,source_row,raw_json FROM raw_rows WHERE row_id>? ORDER BY row_id LIMIT 1000');
  const put=store.db.prepare(`INSERT INTO sales_size_groups VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(group_key) DO UPDATE SET quantity=quantity+excluded.quantity,source_count=source_count+1`);
  const periods=new Set();let after=0,total=0,sourceRows=0;
  while(true){
    if(canceled())throw Object.assign(Error('任务已取消'),{code:'CANCELED'});
    const batch=page.all(after);if(!batch.length)break;
    store.transaction(()=>{
      for(const row of batch){
        const raw=JSON.parse(row.raw_json),get=key=>Number.isInteger(mapping[key])?Recognition.text(raw[mapping[key]]):'';
        const rawValue=get('sales'),value=/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(rawValue)?rawValue.replace(/,/g,''):'';
        if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>MAX)fail(`第 ${row.source_row} 行数量必须是非负整数，且不超过一万亿。`);
        total+=Number(value);if(!Number.isSafeInteger(total)||total>MAX)fail('销售合计超过一万亿。');
        const title=get('specName'),parsed=Recognition.parseDimensions(title),size=parsed.status==='value'?sizeKey(parsed.width,parsed.length):'';
        const source=JSON.stringify([get('platform'),get('shop'),get('productId')]);
        const key=JSON.stringify([source,size||`@row:${row.row_id}`]);
        put.run(key,source,row.row_id,size,Number(value),1,title.slice(0,300),size?'':parsed.reason==='multiple'?'标题包含多个尺寸，请选择对应规格':'未识别尺寸，请选择对应规格');
        const period=get('date');if(period&&periods.size<100)periods.add(period);
        after=row.row_id;sourceRows++;
      }
      if(Number(store.db.prepare('SELECT count(*) n FROM sales_size_groups').get().n)>MAX_GROUPS)fail('尺寸或待处理记录超过 10000 组，请按商品拆分报表。');
    });
    progress({phase:'aggregating-sales',rowsRead:sourceRows});
  }
  const result={sourceRows,totalQuantity:total,groups:Number(store.db.prepare('SELECT count(*) n FROM sales_size_groups').get().n)};
  store.updateMeta({salesSizeReady:true,salesSizeBasis:basis,salesSizePeriods:[...periods],salesSizeSummary:result});
  return result;
}

function candidate(store,meta={}){
  ensure(store);
  if(!store.getMeta('salesSizeReady'))fail('尺寸汇总尚未完成，请等待文件读取完成。');
  if(meta.basis!==store.getMeta('salesSizeBasis'))fail('统计口径已变化，请重新读取文件。');
  const plans=meta.items||[];
  if(!Array.isArray(plans)||plans.length>10000)fail('请先为当前计划添加商品规格。');
  const byId=new Map(),bySize=new Map();
  for(const item of plans){
    if(!item.id||byId.has(item.id))fail('当前计划规格编号缺失或重复。');
    const key=sizeKey(item.width,item.height),out={id:item.id,itemId:item.id,count:0,bind:false,productId:item.productId||'',skuId:item.skuId||'',excluded:false};
    byId.set(item.id,out);if(key)bySize.set(key,[...(bySize.get(key)||[]),item.id]);
  }
  const sources=store.db.prepare('SELECT source_key,sum(quantity) quantity,sum(source_count) sourceRows FROM sales_size_groups GROUP BY source_key ORDER BY source_key').all().map(s=>{
    const [platform,shop,product]=JSON.parse(s.source_key);
    return {key:s.source_key,label:[platform,shop,product?`商品 ${product}`:''].filter(Boolean).join(' · ')||'本表商品',quantity:s.quantity,sourceRows:s.sourceRows};
  });
  const source=meta.sourceKey|| (sources.length===1?sources[0].key:'');
  if(source&&!sources.some(s=>s.key===source))fail('所选商品来源已失效。');
  const bindings=new Map((meta.bindings||[]).map(b=>[String(b.rowId),b]));
  const matched=new Set(),groups=[];let total=0,unknown=0,excluded=0;
  if(source)for(const row of store.db.prepare('SELECT * FROM sales_size_groups WHERE source_key=? ORDER BY row_id').all(source)){
    const binding=bindings.get(String(row.row_id)),matches=bySize.get(row.size_key)||[];
    const itemId=binding?String(binding.itemId||''):matches.length===1?matches[0]:'';
    const skip=!!binding?.excluded,valid=byId.has(itemId);
    const issue=skip||valid?'':row.issue||(matches.length>1?'当前计划有多个同尺寸规格，请选择对应规格':'当前计划没有此尺寸，可一键添加、选择规格或排除');
    if(skip)excluded++;else if(!valid)unknown++;else{byId.get(itemId).count+=row.quantity;matched.add(itemId);total+=row.quantity;}
    const [width=0,height=0]=row.size_key.split('×').map(Number);
    groups.push({width,height,canAdd:!!row.size_key&&!skip&&!valid&&matches.length===0,rowId:row.row_id,size:row.size_key||'未识别尺寸',count:row.quantity,sourceCount:row.source_count,example:row.example,itemId:valid?itemId:'',excluded:skip,issue});
  }
  const items=[...byId.values()],missing=items.filter(i=>!matched.has(i.id)).map(i=>i.id);
  const ready=!!source&&unknown===0&&(missing.length===0||meta.missingPolicy==='zero')&&total>0;
  const shares=total>0?Sales.allocate(items.map(i=>({id:i.id,sales:i.count}))):new Map();
  for(const item of items)item.share=shares.get(item.id)??0;
  return {matchBy:'size',items,groups,sources,sourceKey:source,requiresSource:!source&&sources.length>1,
    total,unknown,excluded,missing,ready,periods:store.getMeta('salesSizePeriods',[]),basis:meta.basis,revision:store.getMeta('revision',0)};
}

module.exports={aggregate,candidate,sizeKey};
