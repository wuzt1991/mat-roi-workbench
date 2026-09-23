'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Controller=require('../public/product-transfer/controller.js'),Views=require('../public/product-transfer/views.js'),Model=require('../public/product-transfer/model.js');
const session={sessionId:'s',ownerToken:'o',revision:1};
const page=(revision=1)=>({page:1,totalPages:1,total:1,revision,rows:[],groups:[{groupId:'g',total:1,productName:'商品'}],counts:{total:1,pending:0},ready:true,thicknessConfigured:true});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('destroy invalidates an outstanding list response',async()=>{
 const pending=deferred(),c=Controller.create({request:()=>pending.promise});
 const restore=c.restoreSession(session);c.destroy();pending.resolve(page(9));await restore;
 assert.equal(c.state.session,null);assert.equal(c.state.page,null);
});
test('deactivated pending read cannot leave the next activation permanently busy',async()=>{
 const pending=deferred();let count=0;const c=Controller.create({request:()=>++count===1?pending.promise:Promise.resolve(page())});
 const restore=c.restoreSession(session);c.deactivate();assert.equal(c.isBusy(),false);pending.resolve(page(99));await restore;assert.equal(c.state.page,null);
 c.activate();await new Promise(r=>setImmediate(r));assert.equal(c.state.page.revision,1);assert.equal(c.isBusy(),false);c.destroy();
});
test('list and expanded SKU detail are published together; failed detail preserves the prior revision',async()=>{
 let fail=false;const c=Controller.create({request:async(a,p)=>{if(p.query.groupId){if(fail)throw Error('detail unavailable');return {...page(1),rows:[{rowId:1}]};}return page(fail?2:1);}});
 await c.restoreSession(session);c.state.manual=true;c.state.expandedGroupId='g';await c.refreshPage();
 const previous=c.state.page,rows=c.state.groupRows;fail=true;await c.refreshPage();
 assert.equal(c.state.page,previous);assert.equal(c.state.groupRows,rows);assert.equal(c.state.session.revision,1);assert.match(c.state.error,/detail unavailable/);c.destroy();
});
test('late undo completion cannot change a replacement session',async()=>{
 const pending=deferred(),c=Controller.create({request:async(a,p)=>a==='undo'?pending.promise:page(p.sessionId==='new'?7:1)});
 await c.restoreSession(session);c.state.undo={revision:1};const undo=c.undo();
 await c.restoreSession({sessionId:'new',ownerToken:'new-owner',revision:7});pending.resolve({revision:2,undone:1});await undo;
 assert.equal(c.state.session.sessionId,'new');assert.equal(c.state.session.revision,7);assert.equal(c.state.error,'');c.destroy();
});
test('rendering preserves setup drafts and performs no service call or preference write',async()=>{
 let calls=0,writes=0;const getState=()=>({materials:[]}),c=Controller.create({getState,request:async()=>{calls++;return {...page(),thicknessConfigured:false,materialSummary:{materials:[],unknown:0}};},ports:{writePreference:()=>writes++}});
 await c.restoreSession(session);c.state.uniformChoices={m:'chosen'};c.state.setupDirty=true;
 const before=JSON.stringify(c.state),count=calls,view=Views.create({state:c.state,getState,selectors:c,waitingHtml:()=>''});
 view.html();view.html();assert.equal(JSON.stringify(c.state),before);assert.equal(calls,count);assert.equal(writes,0);c.destroy();
});
test('row and whole-product intents contain only submitted fields and explicit scope',()=>{
 const row={derived:{material:{status:'value',materialId:'m'},thickness:{ruleId:'3'},size:{status:'value',width:40,length:60}}};
 assert.deepEqual(Model.rowPatch(row,{material:'m',rule:'5',width:'40',length:'60'}),{thickness:{mode:'value',materialId:'m',ruleId:'5'}});
 assert.deepEqual(Model.groupPatch({materialState:'m'},{material:'__keep__',thickness:'5'}),{thickness:{mode:'value',materialId:'m',ruleId:'5'}});
 assert.throws(()=>Model.rowPatch(row,{material:'m',rule:'3',width:'0',length:'60'}));
 assert.throws(()=>Model.groupPatch({materialState:'mixed'},{material:'m',thickness:'__keep__'}));
});
test('failed refresh retains the last view but blocks writes and exports until it is refreshed',async()=>{
 let fail=false,writes=0;const c=Controller.create({request:async(a)=>{if(a!=='rows')writes++;if(fail)throw Error('read failed');return page();}});
 await c.restoreSession(session);fail=true;await c.refreshPage();
 assert.equal(c.state.pageStale,true);assert.equal(await c.applyReview({type:'row-edit',rowIds:[1],patch:{size:{mode:'blank'}}}),null);await c.exportFile();assert.equal(writes,0);
 fail=false;await c.refreshPage();assert.equal(c.state.pageStale,false);c.destroy();
});
