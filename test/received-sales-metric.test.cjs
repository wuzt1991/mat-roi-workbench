'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/domain.js'),W=require('../public/workbook.js'),{appHarness}=require('./app-harness.cjs');
function sample(){const s=M.seed();s.records=[];s.active=s.plans[0].id;s.activeShop=s.plans[0].shopId;const p=s.plans[0];p.params.spend=1000;p.params.actualRoi=3;p.params.refundRates={unshipped:3,shippedOnly:2,returnRefund:5,firstHour:2};return {s,p};}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('实际到手销售金额是整单成交扣三类退款的总额，与总投入加利润一致',()=>{
 const {s,p}=sample();let result=M.calculate(s,p);assert.equal(result.valid,true);close(result.receivedSales,2700);close(result.receivedSales,result.profit+result.investment);assert.notEqual(result.receivedSales,result.revenue);
 p.params.refundRates={unshipped:10,shippedOnly:5,returnRefund:15,firstHour:9};result=M.calculate(s,p);close(result.receivedSales,2100);close(result.receivedSales,result.profit+result.investment);
 p.params.refundRates.firstHour='';p.params.fee=12;p.params.tax=8;close(M.calculate(s,p).receivedSales,2100);
});

test('实收显示区分缺失输入、零成交、全额退款和非法数据',()=>{
 const {s,p}=sample();p.params.spend='';assert.equal(M.calculate(s,p).receivedSales,null);p.params.spend=1000;p.params.actualRoi='';assert.equal(M.calculate(s,p).receivedSales,null);
 p.params.actualRoi=0;assert.equal(M.calculate(s,p).receivedSales,0);p.params.actualRoi=3;p.params.refundRates={unshipped:10,shippedOnly:20,returnRefund:70,firstHour:''};assert.equal(M.calculate(s,p).receivedSales,0);
 p.params.refundRates.returnRefund=80;assert.equal(M.calculate(s,p).receivedSales,null);
});

test('新指标可在显示设置中选择与保存，取消不改原设置',()=>{
 const {s}=sample(),h=appHarness(s),original=[...s.prefs.ids];h.ui.open('display',{ids:[...original]});assert.match(h.elements.get('#dialog').innerHTML,/data-metric-choice="receivedSales"/);
 h.ui.modal.ids=['receivedSales','gmv'];h.ui.close(true);assert.deepEqual(h.ui.state.prefs.ids,original);
 h.ui.open('display',{ids:['receivedSales','gmv']});h.ui.saveModal();assert.deepEqual([...h.ui.state.prefs.ids],['receivedSales','gmv']);assert.match(h.elements.get('#app').innerHTML,/实际到手销售金额/);assert.match(h.elements.get('#app').innerHTML,/¥2,700.00/);assert.ok(M.validateBackup(h.ui.state));
});

test('实收显示偏好可随备份往返，历史冻结结果不增加必填字段',async()=>{
 const {s,p}=sample();M.confirmRecord(s,{frame:M.makeFrame(s,p),date:'2026-09-20'});const records=JSON.stringify(s.records);s.prefs.ids=['receivedSales','gmv','profit','investment'];assert.ok(M.validateBackup(s));
 const restored=await W.importWorkbook(await W.exportWorkbook(s));assert.deepEqual(restored.prefs.ids,s.prefs.ids);assert.equal(JSON.stringify(restored.records),records);assert.equal(Object.hasOwn(restored.records[0].result,'receivedSales'),false);
 assert.ok(W.tables(s).find(([title])=>title==='显示设置')[1].some(row=>row.includes('实际到手销售金额')));
});
