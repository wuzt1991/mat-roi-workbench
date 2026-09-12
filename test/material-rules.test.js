const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public/domain.js');
const P=require('../public/product-transfer.js');

test('材料子规则按厚度和变体唯一，默认规则参与计划成本重量',()=>{
  const material=M.normalizeMaterial({id:'mat-x',name:'测试材料',price:10,active:true,history:[],weightRules:[
    {id:'r1',thickness:3,variant:'',coefficient:.9,costPerSqm:10,default:true},
    {id:'r2',thickness:3,variant:'',coefficient:1,costPerSqm:12,default:false}
  ]});
  assert.equal(material.weightRules.length,1);
  const s=M.initialState();s.materials=[material];s.plans=[];
  const p={id:'p1',shopId:s.shops[0].id,name:'规则测试',materialId:'mat-x',shippingId:s.shippingTemplates[0].id,params:{...M.defaults,spend:'',actualRoi:''},items:[] ,deleted:false};
  const size=s.sizes[0];p.items=[{sizeId:size.id,price:20,share:100,weight:''}];s.plans=[p];
  const r=M.calculate(s,p);assert.equal(r.rows[0].material,.12*10);assert.equal(r.rows[0].weight,.12*.9);
});

test('商品转表使用公共材料子规则的变体成本',()=>{
  const source=[['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],['淘宝','店','包边水晶绒地垫','80*120 包边','1001','2001','39.9','在售','5']];
  const result=P.transformRows(source,{rules:{materials:{'水晶绒':{weightPerSqm:.65,costPerSqm:8}},keywords:['水晶绒'],weightRules:[{material:'水晶绒',variant:'包边',coefficient:.7,costPerSqm:9,default:false},{material:'水晶绒',coefficient:.65,costPerSqm:8,default:true}]}});
  assert.equal(result.summary.ready,true);assert.equal(result.rows[0].values[12],.96*9);assert.equal(result.rows[0].values[11],.96*.7);assert.equal(result.rows[0].values[27],'2001');
});

test('标题同时出现仿亚麻和硅藻泥时优先识别硅藻泥',()=>{
  const rules={
    materials:{'硅藻泥':{weightPerSqm:.9,costPerSqm:9.5},'亚麻':{weightPerSqm:.96,costPerSqm:15}},
    keywords:['仿亚麻','硅藻泥'],
    weightRules:[
      {material:'硅藻泥',thickness:3,coefficient:.9,costPerSqm:9.5,default:true},
      {material:'亚麻',thickness:3.5,coefficient:.96,costPerSqm:15,default:true}
    ]
  };
  const identified=P.identifyMaterial('仿亚麻硅藻泥地垫','80*120 3mm',rules);
  assert.equal(identified.ok,true);
  assert.equal(identified.name,'硅藻泥');
  const result=P.transformRows([
    ['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    ['淘宝','店','仿亚麻硅藻泥地垫','80*120 3mm','1001','2001','39.9','在售','5']
  ],{rules});
  assert.equal(result.summary.ready,true);
  assert.equal(result.rows[0].values[4],'80*120 3mm【硅藻泥】');
  assert.equal(result.rows[0].values[23],'80*120 3mm【硅藻泥】');
});

test('常规运费无目的地时使用普通省份最高价及五公斤续重',()=>{
  const t=M.regionalShippingTemplate();
  assert.equal(M.shippingCost(t,.3).value,1.45);assert.equal(M.shippingCost(t,.5).value,1.65);assert.equal(M.shippingCost(t,1).value,1.95);assert.equal(M.shippingCost(t,5).value,7.7);assert.equal(M.shippingCost(t,5.1).value,14.4);
});

test('已使用材料软删除后计划引用仍保留，新计划跳过停用材料',()=>{
  const s=M.initialState();
  const used=s.materials[0];
  used.active=false;
  const current=s.plans[0];
  assert.equal(current.materialId,used.id);
  const persisted=M.migrate(s);
  assert.equal(persisted.materials.find(m=>m.id===used.id).active,false);
  const next=M.newPlan(s,current.shopId,'新计划');
  assert.notEqual(next.materialId,used.id);
  assert.equal(s.materials.some(m=>m.id===used.id&&!m.active),true);
});

test('新计划不会默认选择缺少有效厚度规则的材料',()=>{
  const s=M.initialState();
  s.materials.unshift({id:'mat-unconfigured',name:'未配置材料',price:12,active:true,history:[],weightRules:[]});
  const p=M.newPlan(s,s.activeShop,'规则计划');
  assert.notEqual(p.materialId,'mat-unconfigured');
});

test('商品转表可按平台商品 ID 批量应用同组材质复核',()=>{
  const source=[
    ['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    ['淘宝','店','未知商品','40*60','same-product','sku-1','39.9','在售','5'],
    ['淘宝','店','未知商品','50*80','same-product','sku-2','49.9','在售','6']
  ];
  const result=P.transformRows(source);
  const reviewed=P.applyBatchReviews(result,{2:{material:'硅藻泥'},});
  assert.equal(reviewed.summary.ready,true);
  assert.equal(reviewed.exceptions.length,0);
  assert.equal(reviewed.rows[0].values[5],'硅藻泥');
  assert.equal(reviewed.rows[1].values[5],'硅藻泥');
  assert.equal(reviewed.rows[0].values[18],'sku-1');
  assert.equal(reviewed.rows[1].values[18],'sku-2');
  assert.match(reviewed.rows[1].values[4],/【硅藻泥】$/);
});

test('同商品组内材质复核冲突时保留异常',()=>{
  const source=[
    ['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    ['淘宝','店','未知商品','40*60','same-product','sku-1','39.9','在售','5'],
    ['淘宝','店','未知商品','50*80','same-product','sku-2','49.9','在售','6']
  ];
  const result=P.transformRows(source);
  const reviewed=P.applyBatchReviews(result,{2:{material:'硅藻泥'},3:{material:'亚麻'}});
  assert.equal(reviewed.summary.ready,false);
  assert.equal(reviewed.exceptions.length,2);
  assert.ok(reviewed.exceptions.every(x=>x.issues.some(i=>i.code==='REVIEW_CONFLICT')));
});

test('缺少平台商品 ID 的异常行不参与批量复核',()=>{
  const source=[
    ['平台','店铺','平台商品名称','平台规格名称','平台商品ID','平台规格ID','平台售价','售卖状态','平台库存'],
    ['淘宝','店','未知商品','40*60','','sku-1','39.9','在售','5'],
    ['淘宝','店','未知商品','50*80','','sku-2','49.9','在售','6']
  ];
  const result=P.transformRows(source);
  const reviewed=P.applyBatchReviews(result,{2:{material:'硅藻泥'}});
  assert.equal(reviewed.summary.ready,false);
  assert.equal(reviewed.exceptions.length,2);
});
