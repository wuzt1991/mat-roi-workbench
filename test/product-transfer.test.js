const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const P=require('../public/product-transfer.js');
const Excel=require('../public/assets/exceljs.min.js');

const template=fs.readFileSync(path.join(__dirname,'../public/assets/product-template.xlsx'));
// Header order from 商品转表(1).xlsx, supplied on 2026-09-20.
const latestHeaders=['序号','平台','店铺','平台商品名称','平台规格名称','品牌','商品标签','尺寸','面积','宽','长','重量','成本','广告费','成交金额','主条码','规格辅助码','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存','规格类型','规格名称','货品编码','货品简称','货品名称','商家编码','规格简称'];
async function sourceWorkbook(count=139){
  const book=new Excel.Workbook(),sheet=book.addWorksheet('商品');sheet.addRow(P.HEADERS);
  for(let i=1;i<=count;i++){
    const row=Array(29).fill('');
    Object.assign(row,{0:i,1:'抖音',2:'测试店铺',3:'繁花仿亚麻硅藻泥脚垫',4:'碎花;40*60cm【升级吸水款】基础款',17:`product-${i}`,18:`sku-${i}`,19:19.98,20:'在售',21:9991});
    sheet.addRow(row);
  }
  return book.xlsx.writeBuffer();
}

test('商品转表识别表头、材质和尺寸，并生成 139 条静态数据',async()=>{
  const result=await P.analyze(template,await sourceWorkbook());
  assert.equal(result.headers.length,29);
  assert.equal(result.summary.sourceRows,139);
  assert.equal(result.summary.exceptionRows,0);
  assert.equal(result.rows[0].material,'硅藻泥');
  assert.match(result.rows[0].values[4],/【硅藻泥】$/);
  assert.equal(result.rows[0].values[23],result.rows[0].values[4]);
  assert.match(result.rows[0].values[26],/【硅藻泥】$/);
  assert.deepEqual(result.rows[0].dimensions,{ok:true,width:40,length:60,label:'40*60',area:.24,raw:result.rows[0].dimensions.raw});
  assert.equal(result.rows[0].values[11],.216);
  assert.equal(result.rows[0].values[12],2.352);
  assert.equal(typeof result.rows[0].values[17],'string');
  assert.equal(typeof result.rows[0].values[18],'string');
  assert.equal(result.rows[0].values[27],result.rows[0].values[18]);
  for(const row of result.rows){assert.equal(row.values[23],row.values[4]);assert.equal(row.values[26],row.values[23]);assert.equal(row.values[27],row.values[18]);}
});

test('商品转表导出复制模板样式并清除公式，输出 29 列和 139 条数据',async()=>{
  const result=await P.analyze(template,await sourceWorkbook());
  // Results saved before the new standard may still contain platform codes here.
  result.rows[0].values[15]='old-product-code';result.rows[0].values[16]='old-merchant-code';
  const bytes=await P.exportWorkbook(template,result);
  const book=new Excel.Workbook();await book.xlsx.load(bytes);const sheet=book.worksheets[0];
  assert.deepEqual(P.HEADERS,latestHeaders);
  assert.deepEqual(sheet.getRow(1).values.slice(1),latestHeaders);
  assert.equal(sheet.getCell('P2').value,'');assert.equal(sheet.getCell('Q2').value,'');
  assert.equal(sheet.getCell('AB2').value,'sku-1');
  assert.equal(result.rows[0].values[15],'old-product-code');
  assert.equal(sheet.columnCount,29);assert.equal(sheet.rowCount,140);
  assert.equal(sheet.getCell('R2').formula,undefined);assert.equal(sheet.getCell('S2').formula,undefined);
  assert.equal(sheet.getCell('R2').type,Excel.ValueType.String);assert.equal(sheet.getCell('S2').type,Excel.ValueType.String);assert.equal(sheet.getCell('AC140').value,'');
  assert.equal(sheet.getCell('F2').value,'硅藻泥');assert.equal(sheet.getCell('L2').value,.216);
});

for(const count of [1,60,99,100])test(`商品转表导出 ${count} 条规格时删除模板尾行且无残留公式`,async()=>{
  const result=await P.analyze(template,await sourceWorkbook(count));
  const book=new Excel.Workbook();await book.xlsx.load(await P.exportWorkbook(template,result));
  const original=new Excel.Workbook();await original.xlsx.load(template);
  const sheet=book.worksheets[0],source=original.worksheets[0];
  assert.equal(sheet.rowCount,count+1);
  assert.equal(sheet.columnCount,29);
  assert.equal(sheet.autoFilter,`A1:AC${count+1}`);
  for(let r=2;r<=count+1;r++){
    assert.deepEqual(sheet.getRow(r).values.slice(1),result.rows[r-2].values);
    sheet.getRow(r).eachCell(cell=>assert.equal(cell.formula,undefined));
    for(const c of [4,7,8,12,18,19,28])assert.deepEqual(sheet.getCell(r,c).style,source.getCell(r,c).style);
  }
});

test('未解决异常禁止导出，复核后才解锁',async()=>{
  const rows=[['序号','平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],[1,'抖音','店','商品','未知规格','p','s',10,'在售',1]];
  const result=P.transformRows(rows);
  assert.equal(result.summary.ready,false);assert.ok(result.exceptions.length);
  const reviewed=P.applyReviews(result,{2:{material:'硅藻泥',width:40,length:60}});
  assert.equal(reviewed.summary.ready,true);assert.equal(reviewed.exceptions.length,0);
  assert.match(reviewed.rows[0].values[4],/【硅藻泥】$/);
  assert.equal(reviewed.rows[0].values[23],reviewed.rows[0].values[4]);
  assert.equal(reviewed.rows[0].values[26],reviewed.rows[0].values[4]);
});

test('同商品不同 SKU 的材质异常只生成一个商品级复核项',()=>{
  const rows=[
    ['序号','平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    [1,'抖音','店','同款商品','红色 40*60cm','product-1','sku-1',10,'在售',1],
    [2,'抖音','店','同款商品','蓝色 50*80cm','product-1','sku-2',20,'在售',2],
    [3,'抖音','店','另一商品','绿色 60*90cm','product-2','sku-3',30,'在售',3]
  ];
  const result=P.transformRows(rows),groups=P.exceptionGroups(result);
  assert.equal(result.exceptions.length,3);
  assert.equal(groups.products.length,2);
  const first=groups.products.find(group=>group.productId==='product-1');
  assert.equal(first.skuCount,2);
  assert.deepEqual(first.rowNumbers,[2,3]);
  assert.equal(groups.rows.length,0);
});

test('材质和尺寸同时异常时材质仍只出现在商品级复核',()=>{
  const rows=[
    ['序号','平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    [1,'抖音','店','同款商品','红色小号','product-1','sku-1',10,'在售',1],
    [2,'抖音','店','同款商品','蓝色 50*80cm','product-1','sku-2',20,'在售',2]
  ];
  const groups=P.exceptionGroups(P.transformRows(rows));
  assert.equal(groups.products.length,1);
  assert.equal(groups.products[0].skuCount,2);
  assert.equal(groups.rows.length,1);
  assert.deepEqual(groups.rows[0].exception.issues.map(issue=>issue.code),['DIMENSION']);
  assert.equal(groups.rows[0].materialEditable,false);
});

test('商品级材质复核一次应用到该商品全部 SKU',()=>{
  const rows=[
    ['序号','平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    [1,'抖音','店','同款商品','红色 40*60cm','product-1','sku-1',10,'在售',1],
    [2,'抖音','店','同款商品','蓝色 50*80cm','product-1','sku-2',20,'在售',2],
    [3,'抖音','店','另一商品','硅藻泥 60*90cm','product-2','sku-3',30,'在售',3]
  ];
  const result=P.transformRows(rows),reviewed=P.applyProductReview(result,'product-1',{material:'硅藻泥'});
  const target=reviewed.rows.filter(row=>row.values[17]==='product-1');
  assert.equal(target.length,2);
  assert.ok(target.every(row=>row.values[5]==='硅藻泥'));
  assert.ok(target.every(row=>/【硅藻泥】$/.test(row.values[4])));
  assert.ok(target.every(row=>Number.isFinite(row.values[11])&&Number.isFinite(row.values[12])));
  assert.equal(reviewed.summary.ready,true);
});

test('商品级复核改材质时替换旧后缀而不叠加',()=>{
  const rows=[
    ['序号','平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    [1,'抖音','店','硅藻泥商品','40*60cm','product-1','sku-1',10,'在售',1]
  ];
  const result=P.transformRows(rows),reviewed=P.applyProductReview(result,'product-1',{material:'亚麻'});
  assert.match(reviewed.rows[0].values[4],/【亚麻】$/);
  assert.doesNotMatch(reviewed.rows[0].values[4],/【硅藻泥】【亚麻】$/);
});

test('固定重量系数按材质与厚度命中，成本价不参与重量',()=>{
  const cases=[
    ['硅藻泥','硅藻泥 2.7mm',.83],['硅藻泥','硅藻泥 3mm',.9],['硅藻泥','硅藻泥 5mm',1.3],
    ['亚麻','亚麻 3.5mm',.96],['亚麻','亚麻 5mm',1.26],['水晶绒','包边水晶绒',.7],
    ['丝圈','丝圈',2.8],['皮革','皮革 3.5mm',1.3],['仿羊绒','仿羊绒',1.45],
    ['冰藤','冰藤 4.15mm',1.2],['冰丝','冰丝 带绑带 3.36mm',.95],['冰丝水洗底','冰丝水洗底 1.9mm',1],
    ['菠萝圈','菠萝圈',1.25],['天鹅绒','天鹅绒',.85],['金钻绒','金钻绒',.8],['圈绒','圈绒 8mm',2.6]
  ];
  for(const [material,source,coefficient] of cases){
    const rule=P.resolveWeightRule(material,source,P.defaultRules());
    assert.equal(rule.coefficient,coefficient,`${material} ${source}`);
  }
});
